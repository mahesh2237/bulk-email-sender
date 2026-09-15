/**
 * Template Engine for personalized email mail merge.
 * Supports:
 * - {{fieldName}}
 * - {{fieldName|default fallback}}
 * - Case-insensitive column matching
 */

export interface ExtractedToken {
  raw: string;
  field: string;
  fallback?: string;
}

export function extractTokens(template: string): ExtractedToken[] {
  const regex = /\{\{\s*([^}|]+?)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;
  const tokens: ExtractedToken[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const raw = match[0];
    const field = match[1].trim();
    const fallback = match[2] !== undefined ? match[2].trim() : undefined;

    if (!seen.has(raw)) {
      seen.add(raw);
      tokens.push({ raw, field, fallback });
    }
  }

  return tokens;
}

export function renderTemplate(template: string, data: Record<string, string>): string {
  if (!template) return "";

  // Normalize data keys for case-insensitive lookup
  const normalizedData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    normalizedData[key.toLowerCase().trim()] = value;
    // Also store alphanumeric-only version for fuzzy matching (e.g., "first_name" vs "firstname" vs "First Name")
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalizedData[cleanKey]) {
      normalizedData[cleanKey] = value;
    }
  }

  return template.replace(/\{\{\s*([^}|]+?)(?:\s*\|\s*([^}]*?))?\s*\}\}/g, (_, fieldName, fallback) => {
    const trimmedField = fieldName.trim().toLowerCase();
    const cleanField = trimmedField.replace(/[^a-z0-9]/g, "");

    const val = normalizedData[trimmedField] ?? normalizedData[cleanField];
    if (val !== undefined && val !== null && val.trim().length > 0) {
      return val;
    }

    if (fallback !== undefined) {
      return fallback.trim();
    }

    // If no value and no fallback, return empty or keep token
    return "";
  });
}

/**
 * Converts plain text newlines into HTML paragraphs/breaks for rich Gmail editor
 */
export function formatEmailBodyToHTML(body: string): string {
  if (!body) return "";
  // If already looks like HTML (has tags like <p>, <div>, <br>), keep as is
  if (/<(p|div|br|span|b|strong|i|em|ul|ol|li)[^>]*>/i.test(body)) {
    return body;
  }
  // Convert double newlines to paragraph wrappers, single newlines to <br>
  const paragraphs = body.split(/\n\s*\n/);
  return paragraphs
    .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>");
}
