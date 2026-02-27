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
import { preflightResponse, applyCors } from "./cors.js";
import { trackEvent } from "../analytics.js";

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

  // --- Public endpoints (no auth) ---

  if (pathname === "/api/openapi.json" && request.method === "GET") {
    const serverUrl = `${url.protocol}//${url.host}`;
    return applyCors(request, json(buildOpenApiSpec(serverUrl)));
  }

  if (pathname === "/api/docs" && request.method === "GET") {
    const specUrl = `${url.protocol}//${url.host}/api/openapi.json`;
    return applyCors(request, renderScalarDocs(specUrl));
  }

  // --- CORS preflight ---

  if (request.method === "OPTIONS") {
    return preflightResponse();
  }

  // --- Route matching ---

  const matched = matchRoute(request.method as HttpMethod, pathname);
  if (!matched) {
    return applyCors(request, jsonError("Not found", 404));
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

  const start = Date.now();
  let email = "";

  if (!route.public) {
    const result = await authenticateIdentity(request, env, {
      allowUnboundServiceToken: route.allowUnboundServiceToken,
    });
    if (result instanceof Response) return applyCors(request, result);
    email = result.email ?? "";

    const ctx = { env, db, email, auth: result, params, query: url.searchParams };
    const response = await route.handler(ctx, request);
    trackApi(env, request.method, route.pattern, email, start, response);
    return withBookmark(db, applyCors(request, response));
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
  trackApi(env, request.method, route.pattern, email, start, response);
  return withBookmark(db, applyCors(request, response));
}

/** Fire-and-forget analytics for an API request. */
function trackApi(
  env: Env,
  method: string,
  pattern: string,
  email: string,
  start: number,
  response: Response,
): void {
  const status = response.status < 400 ? "ok" : "error";
  const size = parseInt(response.headers.get("content-length") ?? "0", 10);
  trackEvent(env, {
    channel: "api",
    method,
    path: pattern,
    status,
    email,
    latencyMs: Date.now() - start,
    responseBytes: size,
  });
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
