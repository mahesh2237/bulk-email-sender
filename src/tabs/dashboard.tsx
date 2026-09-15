import React, { useState } from "react";
import { useStorage } from "@plasmohq/storage/hook";
import { parseCSV, parsePastedContacts, extractEmailsFromText } from "../lib/csv-parser";
import { renderTemplate } from "../lib/template-engine";

import { DEFAULT_CAMPAIGN } from "../lib/storage";
import type { CampaignState, Recipient } from "../lib/types";
import "../styles/theme.css";

export default function DashboardPage() {
  const [campaign, setCampaign] = useStorage<CampaignState>("active_campaign", DEFAULT_CAMPAIGN);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showPasteBox, setShowPasteBox] = useState<boolean>(false);
  const [pastedText, setPastedText] = useState<string>("");
  const [appendMode, setAppendMode] = useState<boolean>(true);


  const state: CampaignState = campaign || DEFAULT_CAMPAIGN;

  // Filtered recipients
  const filteredRecipients = state.recipients.filter((r) => {
    const matchesStatus = filterStatus === "all" || r.status === filterStatus;
    const matchesSearch =
      r.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      Object.values(r.data).some((val) => val.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  // Export results to CSV
  const exportToCSV = () => {
    if (state.recipients.length === 0) {
      alert("No recipients to export.");
      return;
    }

    const activeEmailCol = (state.settings.emailColumn || "email").toLowerCase();
    const extraCols = state.columns.filter((col) => col.toLowerCase() !== activeEmailCol);
    const headers = ["Email", "Status", "SentAt", "Error", ...extraCols];
    const rows = state.recipients.map((r) => {
      const sentTime = r.sentAt ? new Date(r.sentAt).toISOString() : "";
      const baseVals = [r.email, r.status, sentTime, r.error || ""];
      const customVals = extraCols.map((col) => `"${(r.data[col] || "").replace(/"/g, '""')}"`);
      return [...baseVals, ...customVals].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `campaign-results-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startCampaign = () => {
    chrome.runtime.sendMessage({ type: "START_CAMPAIGN" });
  };

  const pauseCampaign = () => {
    chrome.runtime.sendMessage({ type: "PAUSE_CAMPAIGN" });
  };

  const stopCampaign = () => {
    chrome.runtime.sendMessage({ type: "STOP_CAMPAIGN" });
  };

  const retryFailed = () => {
    chrome.runtime.sendMessage({ type: "RETRY_FAILED" });
  };

  const handleImportPasted = () => {
    if (!pastedText.trim()) {
      alert("Please paste some emails or contacts first.");
      return;
    }

    const parsed = parsePastedContacts(pastedText);
    if (parsed.rows.length === 0) {
      alert("No valid email addresses found in the pasted text.");
      return;
    }

    const emailCol = parsed.detectedEmailColumn || "Email";
    const newRecipients: Recipient[] = parsed.rows.map((row, idx) => ({
      id: `dash-paste-${Date.now()}-${idx}`,
      email: row[emailCol] || `row_${idx + 1}@example.com`,
      data: row,
      status: "pending"
    }));

    let finalRecipients = newRecipients;
    let finalColumns = parsed.headers;

    if (appendMode && state.recipients.length > 0) {
      const existing = new Set(state.recipients.map((r) => r.email.toLowerCase()));
      const uniqueNew = newRecipients.filter((r) => !existing.has(r.email.toLowerCase()));
      finalRecipients = [...state.recipients, ...uniqueNew];
      finalColumns = Array.from(new Set([...state.columns, ...parsed.headers]));
    }

    setCampaign({
      ...state,
      recipients: finalRecipients,
      columns: finalColumns,
      settings: {
        ...state.settings,
        emailColumn: emailCol
      },
      stats: {
        total: finalRecipients.length,
        sent: finalRecipients.filter((r) => r.status === "sent").length,
        failed: finalRecipients.filter((r) => r.status === "failed").length,
        pending: finalRecipients.filter((r) => r.status === "pending").length
      },
      currentIndex: 0,
      logs: [
        {
          id: `log-${Date.now()}`,
          timestamp: Date.now(),
          type: "info",
          message: `Added ${newRecipients.length} recipients via paste.`
        },
        ...state.logs
      ]
    });

    setPastedText("");
    setShowPasteBox(false);
  };

  const percent = state.stats.total > 0
    ? Math.round(((state.stats.sent + state.stats.failed) / state.stats.total) * 100)
    : 0;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "16px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="logo-icon" style={{ width: "36px", height: "36px", fontSize: "18px" }}>
            ✉
          </div>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700 }}>Bulk Email Campaign Dashboard</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              Send individual personalized emails via active Gmail web automation
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowPasteBox(!showPasteBox)}
          >
            {showPasteBox ? "✕ Close Paste Box" : "📋 + Paste Contacts"}
          </button>
          <button className="btn btn-secondary" onClick={exportToCSV}>
            📥 Export Report (CSV)
          </button>
          {state.status === "running" ? (
            <button className="btn btn-warning" onClick={pauseCampaign}>
              ⏸ Pause Campaign
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={state.stats.pending === 0}
              onClick={startCampaign}
            >
              ▶ Start Campaign
            </button>
          )}
        </div>
      </header>

      {/* Optional Paste Contacts Card */}
      {showPasteBox && (
        <div className="card" style={{ marginBottom: "24px", border: "2px solid var(--primary)" }}>
          <div className="card-title">
            <span>Paste Email Addresses</span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "normal" }}>
              Names not required — fallback greeting values will be used automatically
            </span>
          </div>

          <textarea
            className="textarea"
            style={{
              minHeight: "130px",
              fontFamily: "monospace",
              fontSize: "12px",
              lineHeight: "1.4"
            }}
            placeholder={"user1@example.com\nuser2@gmail.com\nuser3@company.com"}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "8px",
              fontSize: "12px"
            }}
          >
            {extractEmailsFromText(pastedText).length > 0 ? (
              <span style={{ color: "var(--success)", fontWeight: 600 }}>
                ✓ {extractEmailsFromText(pastedText).length} email{extractEmailsFromText(pastedText).length === 1 ? "" : "s"} detected
              </span>
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                Tip: Paste one per line, comma, or space separated.
              </span>
            )}

            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "var(--primary)",
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: "11px"
              }}
              onClick={() =>
                setPastedText(
                  "alex.test@gmail.com\nsarah.test@company.io\ndavid.test@tech.net"
                )
              }
            >
              Paste sample
            </button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "12px"
            }}
          >
            <label
              style={{
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer"
              }}
            >
              <input
                type="checkbox"
                checked={appendMode}
                onChange={(e) => setAppendMode(e.target.checked)}
              />
              Append to existing list (currently {state.recipients.length} recipients)
            </label>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPasteBox(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImportPasted}
                disabled={extractEmailsFromText(pastedText).length === 0}
              >
                + Import {extractEmailsFromText(pastedText).length > 0 ? `${extractEmailsFromText(pastedText).length} Emails` : "Emails"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="stats-grid" style={{ marginBottom: "20px" }}>
        <div className="stat-box" style={{ padding: "16px" }}>
          <div className="stat-value">{state.stats.total}</div>
          <div className="stat-label">Total Recipients</div>
        </div>
        <div className="stat-box" style={{ padding: "16px" }}>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {state.stats.sent}
          </div>
          <div className="stat-label">Successfully Sent</div>
        </div>
        <div className="stat-box" style={{ padding: "16px" }}>
          <div className="stat-value" style={{ color: "var(--danger)" }}>
            {state.stats.failed}
          </div>
          <div className="stat-label">Failed Deliveries</div>
        </div>
        <div className="stat-box" style={{ padding: "16px" }}>
          <div className="stat-value" style={{ color: "var(--text-muted)" }}>
            {state.stats.pending}
          </div>
          <div className="stat-label">Remaining In Queue</div>
        </div>
      </div>

      {/* Progress */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span>
            <strong>Queue Status:</strong>{" "}
            <span
              style={{
                textTransform: "uppercase",
                fontWeight: 700,
                color: state.status === "running" ? "var(--primary)" : "var(--text-muted)"
              }}
            >
              {state.status}
            </span>
          </span>
          <span>{percent}% Completed</span>
        </div>
        <div className="progress-container" style={{ height: "10px" }}>
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {/* Grid Layout: Template Overview & Table */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px" }}>
        {/* Left Column: Template & Settings */}
        <div>
          <div className="card" style={{ marginBottom: "20px" }}>
            <div className="card-title">Campaign Template</div>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>
                Subject:
              </div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "13px",
                  padding: "6px 8px",
                  background: "#f8fafc",
                  borderRadius: "4px",
                  marginTop: "4px"
                }}
              >
                {state.subject || "(Empty subject)"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>
                Body Preview:
              </div>
              <div
                style={{
                  fontSize: "12px",
                  padding: "8px",
                  background: "#f8fafc",
                  borderRadius: "4px",
                  marginTop: "4px",
                  whiteSpace: "pre-wrap",
                  maxHeight: "180px",
                  overflowY: "auto"
                }}
              >
                {state.body || "(Empty body)"}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Recent Activity Logs</div>
            <div className="log-list" style={{ maxHeight: "250px" }}>
              {state.logs.length === 0 ? (
                <div style={{ color: "#64748b" }}>No activity logs yet.</div>
              ) : (
                state.logs.map((l) => (
                  <div key={l.id} className="log-entry">
                    <span className="log-time">{new Date(l.timestamp).toLocaleTimeString()}</span>
                    <span className={`log-${l.type}`}>{l.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Full Recipient Table */}
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "8px"
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="text"
                className="input"
                placeholder="Search recipients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "220px" }}
              />
              <select
                className="select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{ width: "130px" }}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="sending">Sending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            {state.stats.failed > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={retryFailed}>
                🔄 Retry All Failed ({state.stats.failed})
              </button>
            )}
          </div>

          {(() => {
            const activeEmailCol = (state.settings.emailColumn || "email").toLowerCase();
            const extraColumns = state.columns.filter(
              (col) => col.toLowerCase() !== activeEmailCol
            );

            return (
              <div className="table-container" style={{ maxHeight: "500px" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "35px" }}>#</th>
                      <th style={{ width: "80px" }}>Status</th>
                      <th>Email</th>
                      {extraColumns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                      <th>Error Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecipients.length === 0 ? (
                      <tr>
                        <td colSpan={extraColumns.length + 4} style={{ textAlign: "center", padding: "24px" }}>
                          No matching recipients found.
                        </td>
                      </tr>
                    ) : (
                      filteredRecipients.map((rec, idx) => (
                        <tr key={rec.id}>
                          <td>{idx + 1}</td>
                          <td>
                            <span className={`badge badge-${rec.status}`}>{rec.status}</span>
                          </td>
                          <td>
                            <strong>{rec.email}</strong>
                          </td>
                          {extraColumns.map((col) => (
                            <td key={col}>{rec.data[col] || "—"}</td>
                          ))}
                          <td style={{ color: "var(--danger)", fontSize: "11px" }}>
                            {rec.error || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
