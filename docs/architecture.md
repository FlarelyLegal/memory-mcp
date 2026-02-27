# Architecture

[< Docs](README.md) | [Configuration](configuration.md) | [MCP Tools >](mcp-tools.md)

## Components

| Component        | Cloudflare Service             | Purpose                                                          |
| ---------------- | ------------------------------ | ---------------------------------------------------------------- |
| MCP sessions     | **Durable Objects**            | Stateful per-session MCP agent with persistent state             |
| Structured graph | **D1** (SQLite)                | Entities, relations, memories, conversations, audit logs         |
| Semantic search  | **Vectorize** + **Workers AI** | Embeddings via `@cf/baai/bge-m3` (1024 dims, 60K context)        |
| Auth + tokens    | **KV**                         | OAuth state, service token bindings, admin allowlist, JWKS cache |
| Cold archive     | **R2**                         | Audit log NDJSON archive (Loki-compatible)                       |
| Background jobs  | **Workflows**                  | Durable reindex and consolidation pipelines                      |

## D1 schema (8 tables)

| Table                 | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `namespaces`          | Scopes for organizing data, owned by an email             |
| `entities`            | Graph nodes (person, concept, project, tool, etc.)        |
| `relations`           | Directed edges between entities with type and weight      |
| `memories`            | Knowledge fragments with type, importance, temporal decay |
| `memory_entity_links` | Many-to-many junction between memories and entities       |
| `conversations`       | Conversation containers within a namespace                |
| `messages`            | Individual messages within a conversation                 |
| `audit_logs`          | Write operation audit trail (D1 hot window)               |

Full schema: `schemas/schema.sql`

## Data flow

### Write path

1. MCP tool or REST API handler validates input (Zod schemas)
2. Auth check: namespace/entity/memory ownership verified against email
3. Data-layer function writes to D1 (wrapped in `withRetry` for transient errors)
4. Vectorize upsert for searchable content (entities, memories, messages)
5. Audit log written to D1 + R2 (best-effort, never blocks)
6. `console.log` emits structured JSON for `wrangler tail`

### Read path

1. D1 reads use `first-unconstrained` session (any replica)
2. D1 writes use `first-primary` session (primary first)
3. API routes accept/return `X-D1-Bookmark` header for cross-request consistency

### Semantic search

1. Query text embedded via Workers AI (`@cf/baai/bge-m3`)
2. Vectorize ANN search with metadata filters (namespace, kind, type)
3. Results enriched with D1 data (entity details, relations, memories)
4. Context mode: graph traversal from search results for richer context

## File structure

Code is organized into focused modules with a 250-line cap per file:

### Core

- `src/index.ts` -- MCP server entry point (McpAgent + OAuthProvider + Workflow re-exports)
- `src/version.ts` -- Version, name, description, repo URL (read from package.json at build)
- `src/types.ts` -- `Env` interface, `AuthProps`, `SessionState`, domain types, DB row types
- `src/db.ts` -- D1 Sessions API: `DbHandle`, `session()`, `getBookmark()`, `withRetry()`
- `src/utils.ts` -- `generateId`, `decayScore`, JSON helpers, FTS escape

### Auth

- `src/access-handler.ts` -- OAuth route handler (`/authorize`, `/callback`, `/health`, `/api/*`)
- `src/auth.ts` -- Per-user authorization assertions
- `src/jwt.ts` -- JWT verification (RSA signature + expiry + audience)
- `src/oauth/` -- OAuth utilities (error, sanitize, csrf, state, approval)

### Data layer

- `src/graph/` -- D1 operations by domain (namespaces, entities, relations, traversal)
- `src/memories.ts` -- Memory CRUD + temporal-decay recall
- `src/conversations.ts` -- Conversation and message history
- `src/embeddings.ts` -- Vectorize + Workers AI embed/upsert/delete/search
- `src/vectorize.ts` -- Vector CRUD + semantic search
- `src/consolidation.ts` -- Decay sweep, duplicate detection, stats, entity summaries

### MCP tools

- `src/tools/` -- One file per domain: namespace, entity, relation, traversal, memory, conversation, search, admin
- `src/response-helpers.ts` -- `txt`, `ok`, `err`, `safeMeta`, `toolHandler`, `confirm`
- `src/state.ts` -- Session state: `track`, `untrack`, `resolveNamespace`, `resolveConversation`

### REST API

- `src/api/index.ts` -- Router, route registration, CORS
- `src/api/registry.ts` -- Single source of truth for routing + OpenAPI spec
- `src/api/middleware.ts` -- JWT auth, service token resolution, JSON helpers
- `src/api/openapi.ts` -- Assembles OpenAPI 3.1 spec dynamically
- `src/api/docs.ts` -- Scalar API reference UI
- `src/api/routes/` -- One file per domain, each registers routes + OpenAPI definitions

### Observability

- `src/audit.ts` -- D1 hot window + R2 NDJSON archive, `audit()`, `queryAuditLogs()`, `purgeAuditLogs()`

### Workflows

- `src/workflows/reindex.ts` -- `ReindexWorkflow`: durable batch re-embedding
- `src/workflows/consolidation.ts` -- `ConsolidationWorkflow`: 5-step pipeline (decay, dedup, AI summaries, memory purge, audit purge)
- `src/reindex.ts` -- Shared chunk logic used by reindex workflow + REST API

## Design decisions

- **Per-user data isolation:** All data is scoped by namespace ownership. No cross-user access.
- **Best-effort audit:** Audit writes never fail the primary operation. D1 + R2 writes fire concurrently via `Promise.allSettled`.
- **Elicitation for destructive ops:** Delete operations prompt for confirmation via MCP elicitation. Graceful degradation if client doesn't support it.
- **Session state:** Active namespace, recent entities, and current conversation are tracked in Durable Object state for smarter defaults across tool calls.
- **Write retry:** All D1 writes wrapped in `withRetry()` with jitter backoff for transient errors. Workflow steps have their own retry mechanism.
