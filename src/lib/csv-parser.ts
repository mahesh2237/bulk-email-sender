/**
 * Robust RFC 4180-compliant CSV parser with automatic delimiter detection
 * and email column identification.
 */

export interface ParsedCSVResult {
  headers: string[];
  rows: Record<string, string>[];
  detectedEmailColumn: string;
}

export function parseCSV(content: string): ParsedCSVResult {
  if (!content || !content.trim()) {
    return { headers: [], rows: [], detectedEmailColumn: "" };
  }

  // Auto-detect delimiter from the first few non-empty lines: comma, semicolon, or tab
  const sampleLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5);
  const delimiter = detectDelimiter(sampleLines);

  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++; // skip CRLF second char
      }
      currentRow.push(currentField.trim());
      if (currentRow.some((field) => field.length > 0)) {
        rawRows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }

  // push last field if pending
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => field.length > 0)) {
      rawRows.push(currentRow);
    }
  }

  if (rawRows.length === 0) {
    return { headers: [], rows: [], detectedEmailColumn: "" };
  }

  // First non-empty row is treated as headers
  const rawHeaders = rawRows[0];
  const headers = rawHeaders.map((h, idx) => {
    const cleaned = h.replace(/^["']|["']$/g, "").trim();
    return cleaned || `Column_${idx + 1}`;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < rawRows.length; r++) {
    const rowValues = rawRows[r];
    // Skip empty lines
    if (!rowValues.some((v) => v.length > 0)) continue;

    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const headerName = headers[c];
      rowObj[headerName] = (rowValues[c] ?? "").replace(/^["']|["']$/g, "").trim();
    }
    rows.push(rowObj);
  }

  // Detect email column:
  // Priority 1: header matches email keyword
  // Priority 2: column whose values mostly look like an email address
  let detectedEmailColumn = headers.find((h) =>
    /^(email|e-mail|recipient|to|contact_email)$/i.test(h)
  ) || "";

  if (!detectedEmailColumn) {
    detectedEmailColumn = headers.find((h) =>
      /email/i.test(h)
    ) || "";
  }

  if (!detectedEmailColumn && rows.length > 0) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const h of headers) {
      const validCount = rows.filter((r) => emailRegex.test(r[h] || "")).length;
      if (validCount > rows.length * 0.5) {
        detectedEmailColumn = h;
        break;
      }
    }
  }

  return {
    headers,
    rows,
    detectedEmailColumn: detectedEmailColumn || headers[0] || ""
  };
}

function detectDelimiter(lines: string[]): string {
  const delimiters = [",", ";", "\t"];
  const scores: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };

  for (const line of lines) {
    for (const delim of delimiters) {
      // count occurrences outside of quotes roughly
      const count = (line.match(new RegExp(`\\${delim}`, "g")) || []).length;
      scores[delim] += count;
    }
  }

  let bestDelim = ",";
  let maxScore = -1;
  for (const delim of delimiters) {
    if (scores[delim] > maxScore) {
      maxScore = scores[delim];
      bestDelim = delim;
    }
  }
  return bestDelim;
}

/**
 * Extracts all unique valid email addresses from any raw text input
 */
export function extractEmailsFromText(input: string): string[] {
  if (!input || !input.trim()) return [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = input.match(emailRegex) || [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const m of matches) {
    const clean = m.toLowerCase().trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      unique.push(clean);
    }
  }
  return unique;
}

/**
 * Parses raw pasted email input which could be:
 * 1. Plain email addresses separated by newlines, commas, spaces, or semicolons
 * 2. Tab-separated rows pasted from Google Sheets or Excel
 */
export function parsePastedContacts(input: string): ParsedCSVResult {
  if (!input || !input.trim()) {
    return { headers: [], rows: [], detectedEmailColumn: "" };
  }

  const trimmed = input.trim();

  // 1. If it looks like multi-column spreadsheet data with tabs
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0].includes("\t")) {
    const tsvAttempt = parseCSV(trimmed);
    if (tsvAttempt.rows.length > 0 && tsvAttempt.detectedEmailColumn && tsvAttempt.headers.length > 1) {
      return tsvAttempt;
    }
  }

  // 2. Extract clean email addresses directly (no bogus name guessing)
  const uniqueEmails = extractEmailsFromText(trimmed);
  const rows = uniqueEmails.map((email) => ({
    Email: email
  }));

  return {
    headers: ["Email"],
    rows,
    detectedEmailColumn: "Email"
  };
}


