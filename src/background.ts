import { storage, getActiveCampaign, saveActiveCampaign } from "./lib/storage";
import { renderTemplate, formatEmailBodyToHTML } from "./lib/template-engine";
import type { CampaignState, CampaignLog } from "./lib/types";

// Configure side panel to open on extension icon click
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn("[BulkEmail] setPanelBehavior error:", err);
  });
}

// Helper to append log entries into the campaign state
function addLog(campaign: CampaignState, type: CampaignLog["type"], message: string) {
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
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Locate or open an active Gmail tab, bring it to focus, and ensure the content script is active
 */
async function getOrOpenGmailTab(campaign: CampaignState): Promise<chrome.tabs.Tab> {
  const allTabs = await chrome.tabs.query({});
  let gmailTab = allTabs.find((t) => t.url && t.url.includes("mail.google.com"));

  if (gmailTab && gmailTab.id) {
    // Focus tab
    await chrome.tabs.update(gmailTab.id, { active: true });
    if (gmailTab.windowId) {
      await chrome.windows.update(gmailTab.windowId, { focused: true }).catch(() => {});
    }

    // Ping to check if content script is active
    let isReady = false;
    try {
      const res = await chrome.tabs.sendMessage(gmailTab.id, { type: "CHECK_GMAIL_STATUS" });
      if (res && res.ready) isReady = true;
    } catch (e) {
      isReady = false;
    }

    // If content script is not yet active (e.g. Gmail was open before extension install/reload)
    if (!isReady) {
      addLog(campaign, "info", "Refreshing Gmail tab to connect extension automator...");
      await saveActiveCampaign(campaign);

      await chrome.tabs.reload(gmailTab.id);
      await new Promise<void>((resolve) => {
        const listener = (tid: number, info: chrome.tabs.TabChangeInfo) => {
          if (tid === gmailTab!.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 3500); // Allow Gmail app hydration
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 12000);
      });
    }

    return gmailTab;
  }

  // Open a new Gmail tab
  addLog(campaign, "info", "Opening Gmail tab...");
  await saveActiveCampaign(campaign);

  const newTab = await chrome.tabs.create({ url: "https://mail.google.com/", active: true });
  await new Promise<void>((resolve) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === newTab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 4000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 15000);
  });

  return newTab;
}

let isQueueRunning = false;

/**
 * Main queue runner
 */
async function runCampaignQueue() {
  if (isQueueRunning) {
    console.log("[BulkEmail] Queue is already running.");
    return;
  }
  isQueueRunning = true;

  try {
    const campaign = await getActiveCampaign();
    campaign.status = "running";

    // If all recipients were already completed or failed, reset them to pending
    const hasPending = campaign.recipients.some((r) => r.status === "pending");
    if (!hasPending && campaign.recipients.length > 0) {
      campaign.recipients.forEach((r) => {
        r.status = "pending";
        r.error = undefined;
      });
      campaign.stats.pending = campaign.recipients.length;
      campaign.stats.sent = 0;
      campaign.stats.failed = 0;
      addLog(campaign, "info", "Reset recipients to pending for new run.");
    }

    addLog(campaign, "info", `Starting queue execution (${campaign.stats.pending} pending)...`);
    await saveActiveCampaign(campaign);

    while (true) {
      // Re-read campaign from storage to catch user Pause / Stop
      const current = await getActiveCampaign();
      if (current.status !== "running") {
        addLog(current, "info", `Queue stopped or paused.`);
        await saveActiveCampaign(current);
        break;
      }

      // Find next pending recipient
      const nextIndex = current.recipients.findIndex((r) => r.status === "pending");
      if (nextIndex === -1) {
        current.status = "completed";
        addLog(current, "success", `🎉 Campaign complete! Sent: ${current.stats.sent}, Failed: ${current.stats.failed}`);
        await saveActiveCampaign(current);
        break;
      }

      current.currentIndex = nextIndex;
      const recipient = current.recipients[nextIndex];
      recipient.status = "sending";
      addLog(current, "info", `Preparing email for: ${recipient.email} (${nextIndex + 1}/${current.recipients.length})`);
      await saveActiveCampaign(current);

      // Locate or open active Gmail tab
      let gmailTab: chrome.tabs.Tab;
      try {
        gmailTab = await getOrOpenGmailTab(current);
      } catch (tabErr: any) {
        recipient.status = "failed";
        recipient.error = `Could not connect to Gmail: ${tabErr.message}`;
        current.stats.failed++;
        current.stats.pending = Math.max(0, current.stats.pending - 1);
        addLog(current, "error", `Failed for ${recipient.email}: ${recipient.error}`);
        await saveActiveCampaign(current);
        continue;
      }

      if (!gmailTab.id) {
        recipient.status = "failed";
        recipient.error = "Gmail tab has no valid ID.";
        current.stats.failed++;
        current.stats.pending = Math.max(0, current.stats.pending - 1);
        await saveActiveCampaign(current);
        continue;
      }

      // Render personalized subject & body
      const personalizedSubject = renderTemplate(current.subject, recipient.data);
      const personalizedBody = renderTemplate(current.body, recipient.data);
      const personalizedBodyHTML = formatEmailBodyToHTML(personalizedBody);

      try {
        const response = await chrome.tabs.sendMessage(gmailTab.id, {
          type: "SEND_SINGLE_EMAIL",
          payload: {
            recipient: recipient.email,
            subject: personalizedSubject,
            body: personalizedBody,
            bodyHTML: personalizedBodyHTML
          }
        });

        if (response && response.success) {
          recipient.status = "sent";
          recipient.sentAt = Date.now();
          current.stats.sent++;
          current.stats.pending = Math.max(0, current.stats.pending - 1);
          addLog(current, "success", `✓ Sent to ${recipient.email}`);
        } else {
          const errorMsg = response?.error || "Send failed or timed out in Gmail.";
          recipient.status = "failed";
          recipient.error = errorMsg;
          current.stats.failed++;
          current.stats.pending = Math.max(0, current.stats.pending - 1);
          addLog(current, "error", `✗ Error for ${recipient.email}: ${errorMsg}`);

          if (current.settings.stopOnError) {
            current.status = "paused";
            addLog(current, "warning", `Paused due to 'Stop on Error' setting.`);
            await saveActiveCampaign(current);
            break;
          }
        }
      } catch (sendErr: any) {
        recipient.status = "failed";
        recipient.error = sendErr.message || String(sendErr);
        current.stats.failed++;
        current.stats.pending = Math.max(0, current.stats.pending - 1);
        addLog(current, "error", `✗ Dispatch error for ${recipient.email}: ${recipient.error}`);
      }

      await saveActiveCampaign(current);

      // Check if more recipients are waiting
      const hasMore = current.recipients.some((r) => r.status === "pending");
      if (hasMore) {
        const minDelay = Math.max(1, current.settings.minDelaySeconds || 4);
        const maxDelay = Math.max(minDelay, current.settings.maxDelaySeconds || 10);
        const delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

        addLog(current, "info", `Waiting ${delaySec}s safety throttle...`);
        await saveActiveCampaign(current);
        await sleep(delaySec * 1000);
      }
    }
  } finally {
    isQueueRunning = false;
  }
}

// Background message listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_CAMPAIGN") {
    (async () => {
      const campaign = await getActiveCampaign();
      if (message.payload) {
        if (message.payload.subject) campaign.subject = message.payload.subject;
        if (message.payload.body) campaign.body = message.payload.body;
      }
      campaign.status = "running";
      await saveActiveCampaign(campaign);
      runCampaignQueue();
      sendResponse({ status: "running" });
    })();
    return true;
  }

  if (message.type === "PAUSE_CAMPAIGN") {
    (async () => {
      const campaign = await getActiveCampaign();
      campaign.status = "paused";
      addLog(campaign, "info", "Campaign paused by user.");
      await saveActiveCampaign(campaign);
      sendResponse({ status: "paused" });
    })();
    return true;
  }

  if (message.type === "STOP_CAMPAIGN") {
    (async () => {
      const campaign = await getActiveCampaign();
      campaign.status = "stopped";
      addLog(campaign, "info", "Campaign stopped by user.");
      await saveActiveCampaign(campaign);
      sendResponse({ status: "stopped" });
    })();
    return true;
  }

  if (message.type === "RETRY_FAILED") {
    (async () => {
      const campaign = await getActiveCampaign();
      let resetCount = 0;
      campaign.recipients.forEach((r) => {
        if (r.status === "failed") {
          r.status = "pending";
          r.error = undefined;
          resetCount++;
        }
      });
      campaign.stats.failed = 0;
      campaign.stats.pending += resetCount;
      campaign.status = "running";
      addLog(campaign, "info", `Reset ${resetCount} failed recipients to pending and resumed.`);
      await saveActiveCampaign(campaign);
      runCampaignQueue();
      sendResponse({ status: "running" });
    })();
    return true;
  }

  if (message.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/dashboard.html") });
    sendResponse({ success: true });
    return true;
  }
});
