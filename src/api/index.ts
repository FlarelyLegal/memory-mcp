/**
 * REST API entry point — router, route registration, and public endpoints.
 *
 * All route modules self-register via the registry when imported. The router
 * matches incoming requests against registered routes, authenticates, and
 * dispatches to the handler.
 */
import type { Env } from "../types.js";
import type { HttpMethod } from "./types.js";
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
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerTokenCrudRoutes } from "./routes/token-crud.js";

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
  registerTokenRoutes();
  registerTokenCrudRoutes();
}

/**
 * Handle an incoming /api/* request.
 * Called from access-handler.ts for any request whose pathname starts with /api/.
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  ensureRegistered();
  const url = new URL(request.url);
  const { pathname } = url;

  // --- Public endpoints (no auth) ---

  if (pathname === "/api/openapi.json" && request.method === "GET") {
    const serverUrl = `${url.protocol}//${url.host}`;
    return json(buildOpenApiSpec(serverUrl));
  }

  if (pathname === "/api/docs" && request.method === "GET") {
    const specUrl = `${url.protocol}//${url.host}/api/openapi.json`;
    return renderScalarDocs(specUrl);
  }

  // --- CORS preflight ---

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // --- Route matching ---

  const matched = matchRoute(request.method as HttpMethod, pathname);
  if (!matched) {
    return jsonError("Not found", 404);
  }

  const { route, params } = matched;

  // --- Auth (skip for explicitly public routes) ---

  if (!route.public) {
    const result = await authenticateIdentity(request, env, {
      allowUnboundServiceToken: route.allowUnboundServiceToken,
    });
    if (result instanceof Response) return withCors(request, result);

    const ctx = { env, email: result.email ?? "", auth: result, params, query: url.searchParams };
    return withCors(request, await route.handler(ctx, request));
  }

  const ctx = {
    env,
    email: "",
    auth: { type: "human", email: "" } as const,
    params,
    query: url.searchParams,
  };
  return withCors(request, await route.handler(ctx, request));
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cf-Access-Jwt-Assertion, cf-access-token, CF-Access-Client-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function supportsGzip(request: Request): boolean {
  return request.headers.get("Accept-Encoding")?.includes("gzip") ?? false;
}

async function maybeGzip(request: Request, response: Response): Promise<Response> {
  if (!supportsGzip(request)) return response;
  if (response.headers.has("Content-Encoding")) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^(application\/json|text\/plain|text\/html)/.test(contentType)) return response;

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

async function withCors(request: Request, response: Response): Promise<Response> {
  const patched = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders())) {
    patched.headers.set(k, v);
  }
  return maybeGzip(request, patched);
}
