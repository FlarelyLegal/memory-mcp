/**
 * Content negotiation for API endpoints.
 *
 * If a browser requests an API endpoint (Accept: text/html preferred over
 * application/json), return a styled HTML page. API clients (curl with
 * explicit Accept: application/json, MCP, scripts) get JSON as before.
 *
 * Parses quality values (q=) per RFC 7231 Section 5.3.1. Media types
 * without an explicit q default to 1.0.
 */

/** Parse a single media-range entry and return its quality weight. */
function parseQuality(entry: string): { type: string; q: number } {
  const parts = entry.split(";");
  const type = parts[0].trim().toLowerCase();
  let q = 1.0;
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i].trim();
    if (param.startsWith("q=")) {
      const parsed = parseFloat(param.slice(2));
      if (!Number.isNaN(parsed)) q = parsed;
    }
  }
  return { type, q };
}

/**
 * Returns true if the request prefers HTML over JSON.
 *
 * Compares the quality weights of text/html and application/json in the
 * Accept header. If text/html has a strictly higher q than application/json
 * (or JSON is absent), returns true. Missing Accept or missing text/html
 * returns false (default to JSON for API clients, curl, scripts, MCP).
 */
export function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  if (!accept) return false;

  const entries = accept.split(",").map(parseQuality);
  const html = entries.find((e) => e.type === "text/html");
  if (!html) return false;
  const json = entries.find((e) => e.type === "application/json");
  // HTML present and JSON absent -> prefer HTML
  if (!json) return true;
  // Compare quality weights -- HTML must be strictly higher
  return html.q > json.q;
}
