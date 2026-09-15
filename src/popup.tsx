import React from "react";
import { useStorage } from "@plasmohq/storage/hook";
import { DEFAULT_CAMPAIGN } from "./lib/storage";
import type { CampaignState } from "./lib/types";
import "./styles/theme.css";

export default function Popup() {
  const [campaign] = useStorage<CampaignState>("active_campaign", DEFAULT_CAMPAIGN);
  const state = campaign || DEFAULT_CAMPAIGN;

  const openSidePanel = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId && chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        window.close();
      }
    } catch (e) {
      console.warn("Could not open side panel:", e);
    }
  };

  const openDashboard = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/dashboard.html") });
    window.close();
  };

  const openGmail = () => {
    chrome.tabs.create({ url: "https://mail.google.com/" });
    window.close();
  };

  return (
    <div style={{ width: "320px", padding: "16px", backgroundColor: "#ffffff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <div className="logo-icon">✉</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14px" }}>Mail Merge for Gmail</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Individual bulk email automation
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: "14px" }}>
        <div className="stat-box">
          <div className="stat-value">{state.stats.total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-box">
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {state.stats.sent}
          </div>
          <div className="stat-label">Sent</div>
        </div>
        <div className="stat-box">
          <div className="stat-value" style={{ color: "var(--text-muted)" }}>
            {state.stats.pending}
          </div>
          <div className="stat-label">Queue</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <button className="btn btn-primary" onClick={openSidePanel}>
          📑 Open Side Panel (Recommended)
        </button>
        <button className="btn btn-secondary" onClick={openDashboard}>
          📊 Open Full Dashboard
        </button>
        <button className="btn btn-secondary" onClick={openGmail}>
          📬 Go to Gmail
        </button>
      </div>
    </div>
  );
}
