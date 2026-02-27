/**
 * REST API entry point — router, route registration, and public endpoints.
 *
 * All route modules self-register via the registry when imported. The router
 * matches incoming requests against registered routes, authenticates, and
 * dispatches to the handler.
 */
import type { Env } from "../types.js";
import type { HttpMethod } from "./types.js";
import { session, getBookmark } from "../db.js";
import { matchRoute } from "./registry.js";
import { authenticateIdentity, json, jsonError } from "./middleware.js";
import { buildOpenApiSpec } from "./openapi.js";
import { renderScalarDocs } from "./docs.js";

// Import route modules — side effect: registers routes in the registry.
import { registerNamespaceRoutes } from "./routes/namespaces.js";
import { registerEntityRoutes } from "./routes/entities.js";
import { registerEntityCrudRoutes } from "./routes/entity-crud.js";
import { registerRelationRoutes } from "./routes/relations.js";
import { registerTraversalRoutes } from "./routes/traversal.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerMemoryQueryRoutes } from "./routes/memory-queries.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerTokenCrudRoutes } from "./routes/token-crud.js";
import { registerDemoRoutes } from "./routes/demo.js";

// Register all route modules once at module load time.
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerNamespaceRoutes();
  registerEntityRoutes();
  registerEntityCrudRoutes();
  registerRelationRoutes();
  registerTraversalRoutes();
  registerMemoryRoutes();
  registerMemoryQueryRoutes();
  registerConversationRoutes();
  registerMessageRoutes();
  registerSearchRoutes();
  registerAdminRoutes();
  registerWorkflowRoutes();
  registerTokenRoutes();
  registerTokenCrudRoutes();
  registerDemoRoutes();
}

/**
 * Handle an incoming /api/* request.
 * Called from access-handler.ts for any request whose pathname starts with /api/.
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  ensureRegistered();
  const url = new URL(request.url);
  const { pathname } = url;

  // Resolve CORS origin once per request
  const reqOrigin = request.headers.get("Origin");
  const allowedOrigin = await resolveOrigin(reqOrigin, url, env);

  // --- Public endpoints (no auth) ---

  if (pathname === "/api/openapi.json" && request.method === "GET") {
    const serverUrl = `${url.protocol}//${url.host}`;
    return applyCors(request, json(buildOpenApiSpec(serverUrl)), allowedOrigin);
  }

  if (pathname === "/api/docs" && request.method === "GET") {
    const specUrl = `${url.protocol}//${url.host}/api/openapi.json`;
    return applyCors(request, renderScalarDocs(specUrl), allowedOrigin);
  }

  // --- CORS preflight ---

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }

  // --- Route matching ---

  const matched = matchRoute(request.method as HttpMethod, pathname);
  if (!matched) {
    return applyCors(request, jsonError("Not found", 404), allowedOrigin);
  }

  const { route, params } = matched;

  // --- D1 session ---
  // Writes go to primary first; reads can hit any replica.
  // If the client sends a bookmark, anchor the session there instead.
  const bookmark = request.headers.get("X-D1-Bookmark");
  const constraint: D1SessionConstraint =
    request.method === "GET" ? "first-unconstrained" : "first-primary";
  const db = session(env.DB, bookmark ?? constraint);

  // --- Auth (skip for explicitly public routes) ---

  if (!route.public) {
    const result = await authenticateIdentity(request, env, {
      allowUnboundServiceToken: route.allowUnboundServiceToken,
    });
    if (result instanceof Response) return applyCors(request, result, allowedOrigin);

    const ctx = {
      env,
      db,
      email: result.email ?? "",
      auth: result,
      params,
      query: url.searchParams,
    };
    const response = await route.handler(ctx, request);
    return withBookmark(db, applyCors(request, response, allowedOrigin));
  }

  const ctx = {
    env,
    db,
    email: "",
    auth: { type: "human", email: "" } as const,
    params,
    query: url.searchParams,
  };
  const response = await route.handler(ctx, request);
  return withBookmark(db, applyCors(request, response, allowedOrigin));
}

// ---------------------------------------------------------------------------
// CORS — Origin allowlist from KV (key: "cors:origins", comma-separated)
// ---------------------------------------------------------------------------

const CORS_KEY = "cors:origins";
const CORS_CACHE_TTL = 5 * 60 * 1000; // 5 min in-memory cache
let corsCache: { origins: Set<string>; ts: number } | null = null;

async function getAllowedOrigins(env: Env): Promise<Set<string>> {
  if (corsCache && Date.now() - corsCache.ts < CORS_CACHE_TTL) return corsCache.origins;
  const raw = await env.CACHE.get(CORS_KEY);
  const origins = raw
    ? new Set(
        raw
          .split(",")
          .map((o) => o.trim().toLowerCase())
          .filter(Boolean),
      )
    : new Set<string>();
  corsCache = { origins, ts: Date.now() };
  return origins;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cf-Access-Jwt-Assertion, cf-access-token, CF-Access-Client-Id, X-D1-Bookmark",
    "Access-Control-Expose-Headers": "X-D1-Bookmark",
    "Access-Control-Max-Age": "86400",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

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

/**
 * Resolve whether to reflect the request Origin in CORS headers.
 * - Same-origin requests always allowed.
 * - Cross-origin requests allowed if Origin is in the KV allowlist.
 * - No Origin header → null (non-browser client, no CORS needed).
 */
async function resolveOrigin(reqOrigin: string | null, url: URL, env: Env): Promise<string | null> {
  if (!reqOrigin) return null; // Non-browser client
  const self = `${url.protocol}//${url.host}`;
  if (reqOrigin.toLowerCase() === self.toLowerCase()) return reqOrigin;
  const allowed = await getAllowedOrigins(env);
  if (allowed.has(reqOrigin.toLowerCase())) return reqOrigin;
  return null; // Cross-origin not in allowlist — omit ACAO header
}

async function applyCors(
  request: Request,
  response: Response,
  origin: string | null,
): Promise<Response> {
  const patched = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    patched.headers.set(k, v);
  }
  return maybeGzip(request, patched);
}

/** Attach the D1 session bookmark to the response for cross-request consistency. */
async function withBookmark(
  db: ReturnType<typeof session>,
  responsePromise: Promise<Response>,
): Promise<Response> {
  const response = await responsePromise;
  const bm = getBookmark(db);
  if (bm) {
    response.headers.set("X-D1-Bookmark", bm);
  }
  return response;
}
