/**
 * CORS helpers.
 *
 * All API endpoints use a wildcard `Access-Control-Allow-Origin: *` policy.
 * Auth is entirely JWT-based (Cf-Access-Jwt-Assertion / CF_Authorization),
 * so CORS is not the security boundary. Cookie-based CSRF protection is
 * handled separately in middleware.ts via Origin/Referer/Sec-Fetch-Site checks.
 *
 * Wildcard CORS allows the server to be deployed on any host without needing
 * a per-deployment origin allowlist.
 */

/** Standard CORS headers applied to every API response. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cf-Access-Jwt-Assertion, cf-access-token, CF-Access-Client-Id, X-D1-Bookmark",
    "Access-Control-Expose-Headers": "X-D1-Bookmark",
    "Access-Control-Max-Age": "86400",
  };
}

/** CORS preflight response (204 No Content). */
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** Apply CORS headers + optional gzip to a response. */
export async function applyCors(request: Request, response: Response): Promise<Response> {
  const patched = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders())) {
    patched.headers.set(k, v);
  }
  return maybeGzip(request, patched);
}

// ---------------------------------------------------------------------------
// Gzip compression for large text responses
// ---------------------------------------------------------------------------

function supportsGzip(request: Request): boolean {
  return request.headers.get("Accept-Encoding")?.includes("gzip") ?? false;
}

async function maybeGzip(request: Request, response: Response): Promise<Response> {
  if (!supportsGzip(request)) return response;
  if (response.headers.has("Content-Encoding")) return response;
  const contentType = response.headers.get("content-type") ?? "";
  // Avoid manual gzip for JSON: some API clients expect transparent decode and
  // can surface compressed bytes directly for .json() parsing.
  if (!/^(text\/plain|text\/html)/.test(contentType)) return response;

  const text = await response.clone().text();
  // Keep CPU overhead low; Cloudflare edge compression also applies.
  if (text.length < 8192) return response;

  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();

  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.set("Vary", "Accept-Encoding");
  headers.delete("Content-Length");
  return new Response(stream.readable, { status: response.status, headers });
}
