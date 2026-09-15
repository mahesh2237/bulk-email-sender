import React, { useState, useEffect, useRef } from "react";
import { useStorage } from "@plasmohq/storage/hook";
import { parseCSV, parsePastedContacts, extractEmailsFromText } from "./lib/csv-parser";
import { extractTokens, renderTemplate } from "./lib/template-engine";
import { queueRunner } from "./lib/queue-runner";

import { DEFAULT_CAMPAIGN } from "./lib/storage";
import type { CampaignState, Recipient } from "./lib/types";
import "./styles/theme.css";

export default function SidePanel() {
  const [campaign, setCampaign] = useStorage<CampaignState>("active_campaign", DEFAULT_CAMPAIGN);
  const [activeTab, setActiveTab] = useState<"recipients" | "compose" | "queue">("recipients");
  const [importMode, setImportMode] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState<string>("");
  const [appendMode, setAppendMode] = useState<boolean>(false);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);


  // Safe fallback state if campaign is undefined
  const state: CampaignState = campaign || DEFAULT_CAMPAIGN;

  // Local state for immediate, smooth cursor-friendly typing
  const [localSubject, setLocalSubject] = useState<string>(state.subject);
  const [localBody, setLocalBody] = useState<string>(state.body);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<any>(null);

  // Sync local text when storage changes externally (e.g. campaign reset/load)
  useEffect(() => {
    if (campaign?.subject !== undefined && campaign.subject !== localSubject) {
      setLocalSubject(campaign.subject);
    }
  }, [campaign?.subject]);

  useEffect(() => {
    if (campaign?.body !== undefined && campaign.body !== localBody) {
      setLocalBody(campaign.body);
    }
  }, [campaign?.body]);

  const handleSubjectChange = (val: string) => {
    setLocalSubject(val);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setCampaign((prev) => (prev ? { ...prev, subject: val } : prev));
    }, 300);
  };

  const handleBodyChange = (val: string) => {
    setLocalBody(val);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setCampaign((prev) => (prev ? { ...prev, body: val } : prev));
    }, 300);
  };

  const handleBlurSubject = () => {
    setCampaign((prev) => (prev ? { ...prev, subject: localSubject } : prev));
  };

  const handleBlurBody = () => {
    setCampaign((prev) => (prev ? { ...prev, body: localBody } : prev));
  };

  // Sync preview index when recipients change
  useEffect(() => {
    if (previewIndex >= state.recipients.length && state.recipients.length > 0) {
      setPreviewIndex(0);
    }
  }, [state.recipients.length]);

  // Handle CSV file upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);

      if (parsed.rows.length === 0) {
        alert("No valid rows found in CSV file.");
        return;
      }

      const emailCol = parsed.detectedEmailColumn || parsed.headers[0];
      const newRecipients: Recipient[] = parsed.rows.map((row, idx) => ({
        id: `rec-${Date.now()}-${idx}`,
        email: row[emailCol] || `row_${idx + 1}@example.com`,
        data: row,
        status: "pending"
      }));

      setCampaign({
        ...state,
        recipients: newRecipients,
        columns: parsed.headers,
        settings: {
          ...state.settings,
          emailColumn: emailCol
        },
        stats: {
          total: newRecipients.length,
          sent: 0,
          failed: 0,
          pending: newRecipients.length
        },
        currentIndex: 0,
        status: "idle",
        logs: [
          {
            id: `log-${Date.now()}`,
            timestamp: Date.now(),
            type: "info",
            message: `Loaded ${newRecipients.length} recipients from CSV.`
          },
          ...state.logs
        ]
      });
    };
    reader.readAsText(file);
  };

  // Handle pasted emails or spreadsheet text
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
      id: `paste-${Date.now()}-${idx}`,
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
      status: "idle",
      logs: [
        {
          id: `log-${Date.now()}`,
          timestamp: Date.now(),
          type: "info",
          message: `Imported ${newRecipients.length} recipients via paste.`
        },
        ...state.logs
      ]
    });

    setPastedText("");
  };

  // Load sample demonstration contacts
  const loadDemoContacts = () => {
    const demoCSV = `Name,Email,Company,Role\nAlex Smith,alex.demo.recipient@gmail.com,Acme Labs,Product Lead\nSarah Jones,sarah.demo.recipient@gmail.com,InnoTech,Founder\nDavid Lee,david.demo.recipient@gmail.com,NextWave,Engineering VP`;
    const parsed = parseCSV(demoCSV);
    const newRecipients: Recipient[] = parsed.rows.map((row, idx) => ({
      id: `demo-${idx}`,
      email: row["Email"],
      data: row,
      status: "pending"
    }));

    setCampaign({
      ...state,
      recipients: newRecipients,
      columns: parsed.headers,
      settings: { ...state.settings, emailColumn: "Email" },
      stats: {
        total: newRecipients.length,
        sent: 0,
        failed: 0,
        pending: newRecipients.length
      },
      status: "idle",
      currentIndex: 0
    });
  };

  // Insert token chip into subject or body at current cursor position
  const insertToken = (token: string, target: "subject" | "body") => {
    const textToInsert = `{{${token}}}`;
    if (target === "subject") {
      const el = subjectInputRef.current;
      if (!el) {
        handleSubjectChange(localSubject + " " + textToInsert);
        return;
      }
      const start = el.selectionStart ?? localSubject.length;
      const end = el.selectionEnd ?? localSubject.length;
      const updated = localSubject.substring(0, start) + textToInsert + localSubject.substring(end);
      handleSubjectChange(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
      }, 0);
    } else {
      const el = bodyTextareaRef.current;
      if (!el) {
        handleBodyChange(localBody + " " + textToInsert);
        return;
      }
      const start = el.selectionStart ?? localBody.length;
      const end = el.selectionEnd ?? localBody.length;
      const updated = localBody.substring(0, start) + textToInsert + localBody.substring(end);
      handleBodyChange(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
      }, 0);
    }
  };

  // Queue actions
  const startCampaign = () => {
    setUiError(null);
    if (state.recipients.length === 0) {
      setUiError("Please import or paste at least one recipient in Tab 1 before starting.");
      setActiveTab("recipients");
      return;
    }
    const finalSub = localSubject.trim();
    const finalBody = localBody.trim();
    if (!finalSub || !finalBody) {
      setUiError("Please enter both a Subject line and Message Body in Tab 2 before sending.");
      setActiveTab("compose");
      return;
    }

    setActiveTab("queue");
    const updatedCampaign: CampaignState = {
      ...state,
      subject: finalSub,
      body: finalBody,
      status: "running"
    };

    setCampaign(updatedCampaign);

    // Run directly via queueRunner
    queueRunner.start(
      updatedCampaign,
      undefined,
      (newState) => {
        setCampaign(newState);
      }
    );
  };

  const pauseCampaign = () => {
    queueRunner.pause();
    setCampaign({ ...state, status: "paused" });
  };

  const stopCampaign = () => {
    queueRunner.stop();
    setCampaign({ ...state, status: "stopped" });
  };

  const retryFailed = () => {
    setUiError(null);
    const updated = { ...state };
    updated.recipients.forEach((r) => {
      if (r.status === "failed") {
        r.status = "pending";
        r.error = undefined;
      }
    });
    updated.stats.failed = 0;
    updated.stats.pending = updated.recipients.filter((r) => r.status === "pending").length;
    updated.status = "running";
    setCampaign(updated);
    queueRunner.start(
      updated,
      undefined,
      (newState) => setCampaign(newState)
    );
  };

  const openFullDashboard = () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  };

  const clearAll = () => {
    if (confirm("Clear current campaign and recipients?")) {
      setCampaign(DEFAULT_CAMPAIGN);
      setLocalSubject(DEFAULT_CAMPAIGN.subject);
      setLocalBody(DEFAULT_CAMPAIGN.body);
      setPreviewIndex(0);
    }
  };

  const currentPreviewRecipient = state.recipients[previewIndex];
  const evaluatedSubject = currentPreviewRecipient
    ? renderTemplate(localSubject, currentPreviewRecipient.data)
    : localSubject;
  const evaluatedBody = currentPreviewRecipient
    ? renderTemplate(localBody, currentPreviewRecipient.data)
    : localBody;

  const percent = state.stats.total > 0
    ? Math.round(((state.stats.sent + state.stats.failed) / state.stats.total) * 100)
    : 0;

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="logo-group">
          <div className="logo-icon">✉</div>
          <div>
            <div className="title">Mail Merge for Gmail</div>
            <div className="subtitle">Individual bulk email automation</div>
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={openFullDashboard}
          title="Open in full browser tab"
        >
          Full Tab ↗
        </button>
      </header>

      {/* Nav Tabs */}
      <nav className="tabs">
        <button
          className={`tab-btn ${activeTab === "recipients" ? "active" : ""}`}
          onClick={() => setActiveTab("recipients")}
        >
          1. Recipients ({state.recipients.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "compose" ? "active" : ""}`}
          onClick={() => setActiveTab("compose")}
        >
          2. Compose & Preview
        </button>
        <button
          className={`tab-btn ${activeTab === "queue" ? "active" : ""}`}
          onClick={() => setActiveTab("queue")}
        >
          3. Queue & Send
        </button>
      </nav>

      {/* Main Body */}
      <main className="content">
        {uiError && (
          <div
            style={{
              padding: "10px 14px",
              backgroundColor: "var(--danger-bg)",
              color: "var(--danger)",
              border: "1px solid #fca5a5",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <span>⚠️ {uiError}</span>
            <button
              style={{
                background: "none",
                border: "none",
                color: "var(--danger)",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "14px"
              }}
              onClick={() => setUiError(null)}
            >
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: RECIPIENTS */}
        {activeTab === "recipients" && (
          <>
            <div className="card">
              <div className="card-title">
                <span>Import Contacts</span>
                {state.recipients.length > 0 && (
                  <button className="btn btn-secondary btn-sm" onClick={clearAll}>
                    Clear List
                  </button>
                )}
              </div>

              {/* Mode Switcher: File Upload vs Paste */}
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  background: "#f1f5f9",
                  padding: "3px",
                  borderRadius: "8px",
                  marginBottom: "12px"
                }}
              >
                <button
                  className={`btn btn-sm ${importMode === "file" ? "btn-primary" : "btn-secondary"}`}
                  style={{ flex: 1, border: "none" }}
                  onClick={() => setImportMode("file")}
                >
                  📁 Upload CSV File
                </button>
                <button
                  className={`btn btn-sm ${importMode === "paste" ? "btn-primary" : "btn-secondary"}`}
                  style={{ flex: 1, border: "none" }}
                  onClick={() => setImportMode("paste")}
                >
                  📋 Paste Emails / Text
                </button>
              </div>

              {importMode === "file" ? (
                <div
                  className={`dropzone ${dragOver ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files?.[0]) {
                      handleFileUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => document.getElementById("csv-file-input")?.click()}
                >
                  <input
                    id="csv-file-input"
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />
                  <div style={{ fontSize: "24px", marginBottom: "4px" }}>📂</div>
                  <div style={{ fontWeight: 600 }}>Click to browse or drop CSV file here</div>
                  <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "4px" }}>
                    Supports CSV with Name, Email, and custom attributes
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>
                    Paste a list of email addresses (one per line, comma, or space separated). Names are not required:
                  </div>

                  <textarea
                    className="textarea"
                    style={{
                      minHeight: "120px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      lineHeight: "1.4"
                    }}
                    placeholder={"user1@example.com\nuser2@gmail.com\nuser3@company.com"}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                  />

                  {/* Live detected email counter */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "6px",
                      fontSize: "11px"
                    }}
                  >
                    {extractEmailsFromText(pastedText).length > 0 ? (
                      <span style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ {extractEmailsFromText(pastedText).length} email{extractEmailsFromText(pastedText).length === 1 ? "" : "s"} detected
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>
                        Tip: In templates, use <code>{"{{First Name|there}}"}</code> as a greeting fallback.
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
                          "contact1@example.com\ncontact2@example.com\ncontact3@example.com"
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
                      marginTop: "10px",
                      flexWrap: "wrap",
                      gap: "6px"
                    }}
                  >
                    <label
                      style={{
                        fontSize: "11px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        cursor: "pointer",
                        color: "var(--text-muted)"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={appendMode}
                        onChange={(e) => setAppendMode(e.target.checked)}
                      />
                      Append to existing ({state.recipients.length})
                    </label>

                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleImportPasted}
                      disabled={extractEmailsFromText(pastedText).length === 0}
                    >
                      + Import {extractEmailsFromText(pastedText).length > 0 ? `${extractEmailsFromText(pastedText).length} Emails` : "Emails"}
                    </button>
                  </div>
                </div>
              )}

              {state.recipients.length === 0 && (
                <div style={{ marginTop: "12px", textAlign: "center" }}>
                  <button className="btn btn-secondary btn-sm" onClick={loadDemoContacts}>
                    ⚡ Load Demo Contacts (3 samples)
                  </button>
                </div>
              )}
            </div>

            {state.columns.length > 1 && (
              <div className="card">
                <div className="card-title">Email Field Mapping</div>
                <div className="form-group">
                  <label className="form-label">Recipient Email Column</label>
                  <select
                    className="select"
                    value={state.settings.emailColumn}
                    onChange={(e) => {
                      const newCol = e.target.value;
                      const updatedRecipients = state.recipients.map((r) => ({
                        ...r,
                        email: r.data[newCol] || r.email
                      }));
                      setCampaign({
                        ...state,
                        settings: { ...state.settings, emailColumn: newCol },
                        recipients: updatedRecipients
                      });
                    }}
                  >
                    {state.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {state.recipients.length > 0 && (() => {
              const activeEmailCol = (state.settings.emailColumn || "email").toLowerCase();
              const extraColumns = state.columns.filter(
                (col) => col.toLowerCase() !== activeEmailCol
              );

              return (
                <div className="card">
                  <div className="card-title">
                    <span>Recipients Preview ({state.recipients.length})</span>
                  </div>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: "35px" }}>#</th>
                          <th style={{ width: "80px" }}>Status</th>
                          <th>Email</th>
                          {extraColumns.slice(0, 3).map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.recipients.map((rec, idx) => (
                          <tr key={rec.id}>
                            <td>{idx + 1}</td>
                            <td>
                              <span className={`badge badge-${rec.status}`}>{rec.status}</span>
                            </td>
                            <td>
                              <strong>{rec.email}</strong>
                            </td>
                            {extraColumns.slice(0, 3).map((col) => (
                              <td key={col}>{rec.data[col] || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
                    <button className="btn btn-primary" onClick={() => setActiveTab("compose")}>
                      Next: Compose Template →
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* TAB 2: COMPOSE & PREVIEW */}
        {activeTab === "compose" && (
          <>
            <div className="card">
              <div className="card-title">
                <span>Personalized Template</span>
              </div>

              {/* Variable Chips */}
              {state.columns.length > 0 && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>
                    Click token to insert into template:
                  </div>
                  <div className="chips-row">
                    {state.columns.map((col) => (
                      <button
                        key={col}
                        className="chip"
                        onClick={() => insertToken(col, "body")}
                        title={`Insert {{${col}}} into body`}
                      >
                        + {`{{${col}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Subject */}
              <div className="form-group">
                <label className="form-label">
                  <span>Subject Line</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    Supports {`{{variables}}`}
                  </span>
                </label>
                <input
                  ref={subjectInputRef}
                  type="text"
                  className="input"
                  placeholder="e.g. Quick question for {{First Name|there}}"
                  value={localSubject}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  onBlur={handleBlurSubject}
                />
              </div>

              {/* Body */}
              <div className="form-group">
                <label className="form-label">
                  <span>Email Message Body</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    Supports fallback: {`{{Name|Friend}}`}
                  </span>
                </label>
                <textarea
                  ref={bodyTextareaRef}
                  className="textarea"
                  style={{ minHeight: "140px" }}
                  placeholder="Hi {{First Name|there}},&#10;&#10;I wanted to connect regarding {{Company|your company}}...&#10;&#10;Best regards,"
                  value={localBody}
                  onChange={(e) => handleBodyChange(e.target.value)}
                  onBlur={handleBlurBody}
                />
              </div>
            </div>

            {/* Live Recipient Preview Card */}
            {state.recipients.length > 0 && (
              <div className="card" style={{ borderLeft: "3px solid var(--primary)" }}>
                <div className="card-title">
                  <span>Live Render Preview</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={previewIndex <= 0}
                      onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                    >
                      ‹
                    </button>
                    <span style={{ fontSize: "11px", fontWeight: 600 }}>
                      {previewIndex + 1} / {state.recipients.length}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={previewIndex >= state.recipients.length - 1}
                      onClick={() => setPreviewIndex((i) => Math.min(state.recipients.length - 1, i + 1))}
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: "11px", marginBottom: "6px" }}>
                  <strong>To:</strong> {currentPreviewRecipient?.email}
                </div>
                <div style={{ fontSize: "11px", marginBottom: "8px" }}>
                  <strong>Subject:</strong> {evaluatedSubject || "—"}
                </div>
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    whiteSpace: "pre-wrap",
                    fontSize: "12px",
                    maxHeight: "150px",
                    overflowY: "auto"
                  }}
                >
                  {evaluatedBody || "—"}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button className="btn btn-secondary" onClick={() => setActiveTab("recipients")}>
                ← Back to Recipients
              </button>
              <button className="btn btn-primary" onClick={() => setActiveTab("queue")}>
                Next: Queue & Send →
              </button>
            </div>
          </>
        )}

        {/* TAB 3: QUEUE & SEND */}
        {activeTab === "queue" && (
          <>
            {/* Stats Overview */}
            <div className="stats-grid">
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
                <div className="stat-value" style={{ color: "var(--danger)" }}>
                  {state.stats.failed}
                </div>
                <div className="stat-label">Failed</div>
              </div>
              <div className="stat-box">
                <div className="stat-value" style={{ color: "var(--text-muted)" }}>
                  {state.stats.pending}
                </div>
                <div className="stat-label">Pending</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span>
                  <strong>Status:</strong>{" "}
                  <span
                    style={{
                      textTransform: "uppercase",
                      fontWeight: 700,
                      color:
                        state.status === "running"
                          ? "var(--primary)"
                          : state.status === "completed"
                          ? "var(--success)"
                          : "var(--text-muted)"
                    }}
                  >
                    {state.status}
                  </span>
                </span>
                <span>{percent}% Completed</span>
              </div>
              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${percent}%` }} />
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                {state.status !== "running" ? (
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={startCampaign}
                    disabled={state.recipients.length === 0}
                  >
                    {state.stats.pending > 0
                      ? `▶ Start Bulk Send (${state.stats.pending})`
                      : `▶ Restart Bulk Send (${state.recipients.length})`}
                  </button>
                ) : (
                  <button className="btn btn-warning" style={{ flex: 1 }} onClick={pauseCampaign}>
                    ⏸ Pause Send
                  </button>
                )}

                {state.status === "running" && (
                  <button className="btn btn-danger" onClick={stopCampaign}>
                    ⏹ Stop
                  </button>
                )}

                {state.stats.failed > 0 && state.status !== "running" && (
                  <button className="btn btn-secondary" onClick={retryFailed}>
                    🔄 Retry Failed ({state.stats.failed})
                  </button>
                )}
              </div>
            </div>

            {/* Anti-Spam Safety Settings */}
            <div className="card">
              <div className="card-title">Anti-Spam Safety Controls</div>
              <div className="form-group">
                <label className="form-label">
                  <span>Delay between emails</span>
                  <span>
                    {state.settings.minDelaySeconds}s - {state.settings.maxDelaySeconds}s (randomized)
                  </span>
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="range"
                    min="3"
                    max="30"
                    value={state.settings.minDelaySeconds}
                    onChange={(e) => {
                      const min = Number(e.target.value);
                      const max = Math.max(min + 2, state.settings.maxDelaySeconds);
                      setCampaign({
                        ...state,
                        settings: { ...state.settings, minDelaySeconds: min, maxDelaySeconds: max }
                      });
                    }}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  🛡️ Random delays protect your Gmail sender reputation from spam filters and rate limits.
                </div>
              </div>
            </div>

            {/* Activity Logs */}
            <div className="card">
              <div className="card-title">Live Execution Logs</div>
              <div className="log-list">
                {state.logs.length === 0 ? (
                  <div style={{ color: "#64748b" }}>No activity logs yet.</div>
                ) : (
                  state.logs.map((l) => (
                    <div key={l.id} className="log-entry">
                      <span className="log-time">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`log-${l.type}`}>{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
