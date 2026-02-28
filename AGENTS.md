# AGENTS.md

## Agent instructions

### Project overview

Memory Graph MCP — a remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory (knowledge graphs, semantic search, conversation history, temporal decay). Single-package TypeScript project using npm.

Built on: **D1** (graph + memories + audit logs), **Vectorize** (semantic search), **Workers AI** (embeddings via `@cf/baai/bge-m3`), **AI Gateway** (observability + caching for all AI calls), **KV** (caching + OAuth state), **R2** (audit log archive), **Durable Objects** (stateful MCP sessions), and **Cloudflare Access** (per-user auth via full OAuth/OIDC flow).

### Key commands, coding standards, and versioning

See [docs/contributing.md](docs/contributing.md) for commands, checks, coding standards, branch workflow, and how to add tools/routes.

Key agent-relevant details not in contributing.md:

- **Description constants:** `src/version.ts` exports `VERSION`, `SERVER_NAME`, `SERVER_DISPLAY_NAME`, `SERVER_DESCRIPTION`, and `REPO_URL`. These are consumed by the MCP server constructor, OAuth approval page, root URL landing page, and `/health` endpoint. Update description in `version.ts` only.
- **Deploy commands:** `npm run deploy` (site A), `npm run deploy:b` (site B), `npm run deploy:init` (first time).

### Non-obvious caveats

Local dev setup (local flag, AI/Vectorize limitations, D1 init) is covered in [docs/contributing.md](docs/contributing.md#local-dev-caveats).

- **OAuth flow requires secrets:** The full OAuth login flow needs seven secrets in `.dev.vars` (see `.dev.vars.example`): `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`, `ACCESS_AUD_TAG`, and `COOKIE_ENCRYPTION_KEY`. Without these, `/health` and `/register` still work, but the `/authorize` → `/callback` flow and authenticated MCP tool calls will not.
- **JWT audience validation:** `ACCESS_AUD_TAG` is the Cloudflare Access Application Audience tag (not the OAuth client ID). It validates the `aud` claim in ID tokens to prevent cross-application token reuse.
- **Root URL:** `GET /` returns a plain-text landing page with version, description, and repo link. All other unknown paths return 404.
- **Health endpoint:** `GET /health` returns `{"status":"ok","server":"memory-graph-mcp","version":"<version>"}` — no auth required.
- **Security headers:** All responses from the access handler include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security`.
- **Input validation:** All MCP tool inputs have Zod `.max()` bounds on strings and arrays to prevent oversized payloads to D1/Workers AI.
- **Relation ownership:** `manage_relation` create verifies both `source_id` and `target_id` belong to the specified namespace — cross-namespace relations are rejected.
- **REST API auth:** API endpoints at `/api/v1/*` authenticate via JWT from Cloudflare Access. The middleware checks the `Cf-Access-Jwt-Assertion` header first, then falls back to the `CF_Authorization` cookie (Access sets the cookie for service token and browser flows). `/api/docs`, `/api/openapi.json`, and `/api/demo` are unauthenticated.
- **Service token identity resolution:** Cloudflare Access service token JWTs have no `email` claim and an empty `sub`. Identity is resolved via `common_name` (= `CF-Access-Client-Id`, survives token rotation). The middleware looks up `st:<common_name>` in KV (`env.CACHE`) to get the bound email. Unregistered service tokens get 403 except for initial claim flow. Bind tokens with `POST /api/v1/admin/service-tokens/bind-request` then `POST /api/v1/admin/service-tokens/bind-self`. No MCP tool for token management — REST API only.
- **`ACCESS_AUD_TAG` must match an Access application:** This secret must be the audience tag from the Cloudflare Access application protecting your Worker's domain. Mismatched audience tags cause `Invalid or expired token` errors on otherwise valid JWTs.
- **OpenAPI spec is auto-generated:** Each route file registers both its handler and its OpenAPI `PathOperation`. The spec at `/api/openapi.json` is assembled dynamically — no separate spec file to maintain.
- **CORS:** All `/api/*` responses include `Access-Control-Allow-Origin: *`. Auth is JWT-based so CORS is not the security boundary. Cookie-based CSRF protection is handled separately in middleware via Origin/Referer/Sec-Fetch-Site checks. CORS helpers live in `src/api/cors.ts`.
- **D1 read replication:** All D1 queries go through `D1DatabaseSession` (via `src/db.ts`). Read-only operations use `"first-unconstrained"` (any replica), write operations use `"first-primary"` (primary first). API routes accept/return `X-D1-Bookmark` header for cross-request consistency. All data-layer functions accept `DbHandle` (union of `D1Database` and `D1DatabaseSession`) — never raw `D1Database`.
- **D1 write retry:** All data-layer write operations are wrapped with `withRetry()` from `src/db.ts`. Retries up to 3 times with jitter backoff on transient D1 errors (`"Network connection lost"`, `"storage caused object to be reset"`, etc.). Workflow steps have their own retry mechanism and don't need `withRetry`.
- **Audit logging:** All write operations (MCP tools + REST API) are audit-logged via `audit()` from `src/audit.ts`. Each call writes to D1 `audit_logs` (queryable hot window) and an individual R2 object at `audit/events/{day}/{id}.json`. Both writes are fire-and-forget — failures never block the request flow. The consolidation workflow merges individual R2 events into daily NDJSON files (`audit/{YYYY-MM-DD}.ndjson`), then purges D1 audit logs older than 90 days. R2 archive is retained indefinitely.
- **Namespace visibility + RBAC:** Namespaces have `visibility` (`private` | `public`, default `private`) and RBAC grants via `namespace_grants` (direct user or group). Public namespaces are readable by any authenticated user. Write requires editor/owner level; owner-only actions require owner level (or admin). Use `manage_namespace` actions (`share`, `unshare`, `list_access`, `transfer`, `set_visibility`) or REST grant routes.
- **Relation ownership:** `manage_relation` create verifies both `source_id` and `target_id` belong to the specified namespace — cross-namespace relations are rejected.
- **AI Gateway:** All Workers AI calls (`embeddings.ts`, `summaries.ts`, `merge.ts`, `reranker.ts`) are routed through AI Gateway via `aiRun()` from `src/ai.ts`. Uses the native binding approach — `env.AI.run(model, input, { gateway: { id } })` — no extra packages or API tokens needed. Gateway ID is a constant in `ai.ts` (`flarelylegal-ai-gateway`). Provides analytics, caching, rate limiting, and logging for all AI inference.
- **Elicitation (human-in-the-loop):** Destructive MCP tool operations (entity/relation/memory delete, consolidate, reindex-all, claim namespaces) prompt the user for confirmation via `server.server.elicitInput()`. The `confirm()` helper in `response-helpers.ts` checks `getClientCapabilities().elicitation.form` first ��� if the client doesn't support elicitation, operations proceed without confirmation (graceful degradation).

### File structure

Code is organized into focused modules with a 250-line cap per file:

- `src/index.ts` — MCP server entry point (McpAgent class + OAuthProvider export + Workflow class re-exports)
- `src/version.ts` — Single source of truth for version, name, description, repo URL
- `src/types.ts` — `Env` interface (all bindings), `AuthProps`, `SessionState`, `StateHandle`, domain types + DB row types
- `src/db.ts` — D1 Sessions API helpers: `DbHandle` type, `session()`, `getBookmark()`, `withRetry()` (jitter backoff for transient D1 write errors)
- `src/access-handler.ts` — OAuth route handler (`/authorize`, `/callback`, `/health`, `/`, `/api/*`)
- `src/auth.ts` — Per-user authorization: read/write access checks with namespace visibility support (`assertNamespaceReadAccess`, `assertNamespaceWriteAccess`, `assertEntityReadAccess`, `assertEntityAccess`, etc.), `isAdmin()` KV lookup, `AccessDeniedError`
- `src/jwt.ts` — JWT verification (RSA signature + expiry + audience validation)
- `src/ai.ts` — AI Gateway wrapper: `aiRun()` injects gateway routing into all `env.AI.run()` calls
- `src/embeddings.ts` — Vectorize + Workers AI: embed, upsert, delete, semantic search
- `src/memories.ts` — Memory CRUD + temporal-decay recall ranking
- `src/conversations.ts` — Conversation and message history
- `src/utils.ts` — `generateId`, `decayScore`, JSON helpers
- `src/tool-schemas.ts` — Shared Zod schemas, enums, and field definitions used by MCP tools, REST validators, and OpenAPI specs
- `src/response-helpers.ts` — Shared MCP response helpers (`txt`, `ok`, `err`, `safeMeta`, `toolHandler`, `cap`, `trunc`, `confirm`)
- `src/state.ts` — Session state helpers: `track`, `untrack`, `resolveNamespace`, `resolveConversation`
- `src/reindex.ts` — Shared batch-reindex logic (entity/memory chunk embedding + Vectorize upsert) used by workflows and REST API
- `src/audit.ts` — Audit logging: D1 hot window + R2 individual event objects, `audit()`, `consolidateAuditR2()`, `queryAuditLogs()`, `purgeAuditLogs()`
- `src/consolidation.ts` — Data-layer for consolidation: decay sweep, duplicate detection, archive, purge
- `src/stats.ts` — Namespace aggregate statistics (`NamespaceStats`, `getNamespaceStats`)
- `src/summaries.ts` — Entity summary generation via Workers AI (`generateEntitySummary`, `getEntityWithMemories`)
- `src/merge.ts` — Memory merge: pairwise cosine clustering + LLM summarization (`findMemoryClusters`, `mergeCluster`, `writeMergedMemory`)
- `src/workflows/reindex.ts` — `ReindexWorkflow` WorkflowEntrypoint: durable batch re-embedding with chunked steps and retries
- `src/workflows/consolidation.ts` — `ConsolidationWorkflow` WorkflowEntrypoint: 7-step pipeline (decay sweep, dedup, memory merge, entity summary refresh, archive purge, R2 audit consolidation, D1 audit purge)
- `src/tools/` — One file per tool domain (namespace, entity, relation, traversal, memory, conversation, search, admin). Each exports a `register*Tools(server, env, email)` function.
- `src/graph/` — D1 operations split by domain (namespaces, entities, relations, traversal) with barrel re-export via `index.ts`.
- `src/api/` — REST API layer (OpenAPI 3.1 + Scalar docs):
  - `index.ts` — Router, route registration, public endpoints (`/api/docs`, `/api/openapi.json`)
  - `cors.ts` — CORS headers (wildcard `*`) and gzip compression
  - `types.ts` — `ApiContext`, `RouteDefinition`, `PathOperation`, `HttpMethod`, OpenAPI schema types
  - `registry.ts` — Route registry (single source of truth for routing + OpenAPI spec)
  - `middleware.ts` — JWT auth (`Cf-Access-Jwt-Assertion`), service token → email resolution via KV, JSON helpers, error handler
  - `service-tokens.ts` — `ST_PREFIX` constant and `ServiceTokenMapping` type (shared by middleware + token routes)
  - `row-parsers.ts` — `parseEntityRow`, `parseMemoryRow` (shared by collection + CRUD route files)
  - `openapi.ts` — Assembles OpenAPI 3.1 spec dynamically from registered routes
  - `schemas.ts` — OpenAPI response schemas, parameter helpers, `queryLimit()`, `zodSchema()` (Zod → OpenAPI converter)
  - `docs.ts` — Scalar API reference UI
  - `routes/` — One file per domain (namespaces, namespace-crud, grants, groups, group-members, entities, entity-crud, relations, traversal, memories, memory-queries, conversations, messages, search, admin, workflows, tokens, token-crud, demo). Each registers routes + their OpenAPI path definitions.
- `src/oauth/` — OAuth utilities split by concern (error, sanitize, csrf, state, approval) with barrel re-export via `index.ts`.
- `schemas/schema.sql` — D1 schema (11 tables: namespaces, entities, relations, conversations, messages, memories, memory_entity_links, audit_logs, groups, group_members, namespace_grants).

### MCP tools (17 total)

| Tool                  | Domain       | Description                                                       |
| --------------------- | ------------ | ----------------------------------------------------------------- |
| `manage_namespace`    | namespace    | Namespace CRUD plus share/unshare/list_access/transfer/visibility |
| `manage_entity`       | entity       | CRUD for graph entities with embedding upsert                     |
| `find_entities`       | entity       | Search entities by name/type/keyword                              |
| `manage_relation`     | relation     | Create or delete directed relations (with ownership check)        |
| `get_relations`       | relation     | Query relations from/to an entity                                 |
| `traverse_graph`      | traversal    | BFS from an entity up to max_depth hops                           |
| `manage_memory`       | memory       | Create/update/delete memories with embedding                      |
| `query_memories`      | memory       | Recall (decay-ranked), search (keyword), or entity-linked         |
| `manage_conversation` | conversation | Create or list conversations                                      |
| `add_message`         | conversation | Add a message and embed for search                                |
| `get_messages`        | conversation | Get or search messages                                            |
| `search`              | search       | Semantic vector search; context mode enriches with graph          |
| `reindex_vectors`     | admin        | Trigger durable reindex workflow (returns instance ID)            |
| `consolidate_memory`  | admin        | Trigger consolidation workflow (decay, dedup, merge, summarize)   |
| `get_workflow_status` | admin        | Check status of a running workflow instance                       |
| `namespace_stats`     | admin        | Entity/memory/relation/conversation counts for a namespace        |
| `claim_namespaces`    | admin        | Claim all unowned namespaces for current user                     |
