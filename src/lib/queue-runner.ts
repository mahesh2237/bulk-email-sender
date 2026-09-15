import { storage, getActiveCampaign, saveActiveCampaign } from "./storage";
import { renderTemplate, formatEmailBodyToHTML } from "./template-engine";
import type { CampaignState, CampaignLog, Recipient } from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LogCallback = (log: CampaignLog) => void;
export type StateCallback = (state: CampaignState) => void;

class QueueRunner {
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private shouldPause: boolean = false;

  public getStatus(): boolean {
    return this.isRunning;
  }

  public pause() {
    this.shouldPause = true;
  }

  public stop() {
    this.shouldStop = true;
  }

  private addLog(
    campaign: CampaignState,
    type: CampaignLog["type"],
    message: string,
    onLog?: LogCallback,
    onState?: StateCallback
  ) {
    const log: CampaignLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: Date.now(),
      type,
      message
    };
    campaign.logs.unshift(log);
    if (campaign.logs.length > 200) {
      campaign.logs = campaign.logs.slice(0, 200);
    }
    if (onLog) onLog(log);
    if (onState) onState({ ...campaign });
    saveActiveCampaign(campaign);
  }

  /**
   * Find or open an active Gmail tab and ensure the automator script is ready
   */
  public async getOrOpenGmailTab(
    campaign: CampaignState,
    onLog?: LogCallback,
    onState?: StateCallback
  ): Promise<chrome.tabs.Tab> {
    // 1. Try finding an open tab with mail.google.com
    let gmailTab: chrome.tabs.Tab | undefined;

    try {
      const tabs = await chrome.tabs.query({ url: "*://mail.google.com/*" });
      if (tabs.length > 0) gmailTab = tabs[0];
    } catch (e) {
      // Fallback query
    }

    if (!gmailTab) {
      const allTabs = await chrome.tabs.query({});
      gmailTab = allTabs.find((t) => t.url && t.url.includes("mail.google.com"));
    }

    // If existing tab found, focus it
    if (gmailTab && gmailTab.id) {
      this.addLog(campaign, "info", "Found open Gmail tab. Focusing...", onLog, onState);
      await chrome.tabs.update(gmailTab.id, { active: true });
      if (gmailTab.windowId) {
        await chrome.windows.update(gmailTab.windowId, { focused: true }).catch(() => {});
      }

      // Check if automator content script responds
      let ready = false;
      try {
        const ping = await chrome.tabs.sendMessage(gmailTab.id, { type: "CHECK_GMAIL_STATUS" });
        if (ping && ping.ready) ready = true;
      } catch (e) {
        ready = false;
      }

      if (!ready) {
        this.addLog(
          campaign,
          "warning",
          "Connecting extension to Gmail tab (reloading tab once)...",
          onLog,
          onState
        );
        await chrome.tabs.reload(gmailTab.id);

        await new Promise<void>((resolve) => {
          const listener = (tid: number, info: chrome.tabs.TabChangeInfo) => {
            if (tid === gmailTab!.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(resolve, 4000);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(resolve, 15000);
        });

        this.addLog(campaign, "info", "Gmail tab reconnected successfully.", onLog, onState);
      }

      return gmailTab;
    }

    // 2. Open new Gmail tab if none was found
    this.addLog(campaign, "info", "Opening mail.google.com in a new tab...", onLog, onState);
    const newTab = await chrome.tabs.create({ url: "https://mail.google.com/", active: true });

    await new Promise<void>((resolve) => {
      const listener = (tid: number, info: chrome.tabs.TabChangeInfo) => {
        if (tid === newTab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 4500); // Wait for Gmail app to initialize
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 18000);
    });

    this.addLog(campaign, "info", "Gmail loaded and ready.", onLog, onState);
    return newTab;
  }

  /**
   * Start executing the sending queue
   */
  public async start(
    currentCampaign: CampaignState,
    onLog?: LogCallback,
    onState?: StateCallback
  ) {
    if (this.isRunning) {
      console.warn("QueueRunner is already running.");
      return;
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.shouldPause = false;

    const campaign = { ...currentCampaign };
    campaign.status = "running";

    // Auto-reset if all were previously sent or failed
    const hasPending = campaign.recipients.some((r) => r.status === "pending");
    if (!hasPending && campaign.recipients.length > 0) {
      campaign.recipients.forEach((r) => {
        r.status = "pending";
        r.error = undefined;
      });
      campaign.stats.pending = campaign.recipients.length;
      campaign.stats.sent = 0;
      campaign.stats.failed = 0;
      this.addLog(campaign, "info", "Reset recipients to pending for new run.", onLog, onState);
    }

    this.addLog(
      campaign,
      "info",
      `🚀 Campaign started! Total: ${campaign.recipients.length}, Pending: ${campaign.stats.pending}`,
      onLog,
      onState
    );

    try {
      // Connect to Gmail tab once up-front
      const gmailTab = await this.getOrOpenGmailTab(campaign, onLog, onState);
      if (!gmailTab.id) {
        throw new Error("Could not acquire valid Gmail tab ID.");
      }

      while (true) {
        if (this.shouldStop) {
          campaign.status = "stopped";
          this.addLog(campaign, "warning", "⏹ Campaign stopped by user.", onLog, onState);
          break;
        }

        if (this.shouldPause) {
          campaign.status = "paused";
          this.addLog(campaign, "warning", "⏸ Campaign paused by user.", onLog, onState);
          break;
        }

        // Find next pending recipient
        const nextIndex = campaign.recipients.findIndex((r) => r.status === "pending");
        if (nextIndex === -1) {
          campaign.status = "completed";
          this.addLog(
            campaign,
            "success",
            `🎉 All emails processed! Successfully sent: ${campaign.stats.sent}, Failed: ${campaign.stats.failed}`,
            onLog,
            onState
          );
          break;
        }

        campaign.currentIndex = nextIndex;
        const recipient = campaign.recipients[nextIndex];
        recipient.status = "sending";
        this.addLog(
          campaign,
          "info",
          `[${nextIndex + 1}/${campaign.recipients.length}] Preparing email for ${recipient.email}...`,
          onLog,
          onState
        );

        // Render personalization
        const subject = renderTemplate(campaign.subject, recipient.data);
        const body = renderTemplate(campaign.body, recipient.data);
        const bodyHTML = formatEmailBodyToHTML(body);

        try {
          const response = await chrome.tabs.sendMessage(gmailTab.id, {
            type: "SEND_SINGLE_EMAIL",
            payload: {
              recipient: recipient.email,
              subject,
              body,
              bodyHTML
            }
          });

          if (response && response.success) {
            recipient.status = "sent";
            recipient.sentAt = Date.now();
            campaign.stats.sent++;
            campaign.stats.pending = Math.max(0, campaign.stats.pending - 1);
            this.addLog(campaign, "success", `✓ Successfully sent to ${recipient.email}`, onLog, onState);
          } else {
            const errText = response?.error || "Send action failed or timed out.";
            recipient.status = "failed";
            recipient.error = errText;
            campaign.stats.failed++;
            campaign.stats.pending = Math.max(0, campaign.stats.pending - 1);
            this.addLog(campaign, "error", `✗ Error for ${recipient.email}: ${errText}`, onLog, onState);

            if (campaign.settings.stopOnError) {
              campaign.status = "paused";
              this.addLog(campaign, "warning", "Campaign paused because 'Stop on Error' is enabled.", onLog, onState);
              break;
            }
          }
        } catch (sendErr: any) {
          const errText = sendErr?.message || String(sendErr);
          recipient.status = "failed";
          recipient.error = errText;
          campaign.stats.failed++;
          campaign.stats.pending = Math.max(0, campaign.stats.pending - 1);
          this.addLog(campaign, "error", `✗ Dispatch error for ${recipient.email}: ${errText}`, onLog, onState);
        }

        await saveActiveCampaign(campaign);
        if (onState) onState({ ...campaign });

        // Throttle delay before next email
        const hasMore = campaign.recipients.some((r) => r.status === "pending");
        if (hasMore && !this.shouldStop && !this.shouldPause) {
          const minDelay = Math.max(1, campaign.settings.minDelaySeconds || 4);
          const maxDelay = Math.max(minDelay, campaign.settings.maxDelaySeconds || 10);
          const delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

          this.addLog(campaign, "info", `⏳ Waiting ${delaySec}s safety delay before next recipient...`, onLog, onState);
          await sleep(delaySec * 1000);
        }
      }
    } catch (globalErr: any) {
      campaign.status = "stopped";
      this.addLog(campaign, "error", `Fatal queue error: ${globalErr.message}`, onLog, onState);
    } finally {
      this.isRunning = false;
      await saveActiveCampaign(campaign);
      if (onState) onState({ ...campaign });
    }
  }
}

export const queueRunner = new QueueRunner();
