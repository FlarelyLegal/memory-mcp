/**
 * Content negotiation for API endpoints.
 *
 * If a browser requests an API endpoint (Accept: text/html preferred over
 * application/json), return a styled HTML page. API clients (curl with
 * explicit Accept: application/json, MCP, scripts) get JSON as before.
 */

/**
 * Returns true if the request prefers HTML over JSON.
 *
 * Heuristic: the Accept header contains "text/html" and it appears before
 * "application/json" (or JSON is absent). Browsers send
 * `text/html,application/xhtml+xml,...` by default. API clients either
 * omit Accept (treated as JSON) or explicitly request application/json.
 */
export function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  if (!accept) return false;
  const htmlPos = accept.indexOf("text/html");
  if (htmlPos === -1) return false;
  const jsonPos = accept.indexOf("application/json");
  // HTML present and JSON absent, or HTML appears first
  return jsonPos === -1 || htmlPos < jsonPos;
}
