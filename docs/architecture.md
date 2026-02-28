# Architecture

[README](../README.md) > [Docs](README.md) > Architecture

## Components

| Component        | Cloudflare Service             | Purpose                                                          |
| ---------------- | ------------------------------ | ---------------------------------------------------------------- |
| MCP sessions     | **Durable Objects**            | Stateful per-session MCP agent with persistent state             |
| Structured graph | **D1** (SQLite)                | Entities, relations, memories, conversations, audit logs         |
| Semantic search  | **Vectorize** + **Workers AI** | Embeddings via `@cf/baai/bge-m3` (1024 dims, 60K context)        |
| Auth + tokens    | **KV**                         | OAuth state, service token bindings, identity cache, flags, JWKS |
| Cold archive     | **R2**                         | Audit log NDJSON archive (Loki-compatible)                       |
| Background jobs  | **Workflows**                  | Durable reindex and consolidation pipelines                      |

## D1 schema (11 tables)

| Table                 | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `namespaces`          | Scopes for organizing data; `visibility` (private/public) |
| `entities`            | Graph nodes (person, concept, project, tool, etc.)        |
| `relations`           | Directed edges between entities with type and weight      |
| `memories`            | Knowledge fragments with type, importance, temporal decay |
| `memory_entity_links` | Many-to-many junction between memories and entities       |
| `conversations`       | Conversation containers within a namespace                |
| `messages`            | Individual messages within a conversation                 |
| `audit_logs`          | Write operation audit trail (D1 hot window)               |
| `groups`              | Group definitions for RBAC principals                     |
| `group_members`       | Group membership + role/status                            |
| `namespace_grants`    | User/group grants to namespaces with role + lifecycle     |

Full schema: `schemas/schema.sql`

## Identity model examples

- D1 RBAC footprint example: `docs/examples/rbac-user-footprint.example.json`
- USERS KV cached identity example: `docs/examples/identity-cache.example.json`

## Security model

Every request is authenticated and authorized before any data access.

### Identity flow

1. Client sends JWT via `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie
2. RSA signature verified against the Cloudflare Access JWKS endpoint
3. Token expiry and audience tag (`ACCESS_AUD_TAG`) validated
4. Email extracted from verified claims

Service tokens follow a different path: the JWT has no `email` or `sub` claim. Identity is resolved via `common_name` (the `CF-Access-Client-Id` header, which survives token rotation). The middleware looks up `st:<common_name>` in KV to get the bound email.

### Authorization

`loadIdentity()` populates a `UserIdentity` from D1 via the KV identity cache. This includes owned namespaces, direct grants, and group memberships with their associated grants. After identity is loaded, all access checks are pure in-memory lookups with zero additional D1 queries per request.

### Audit trail

Every write operation is logged to two stores:

- **D1** (hot window): queryable for 90 days, indexed by namespace, action, and timestamp
- **R2** (archive): individual event objects consolidated into daily NDJSON files at `audit/{YYYY-MM-DD}.ndjson`, retained indefinitely

R2 is S3-compatible. The NDJSON audit archive can be consumed directly by any S3-aware log aggregator (Loki, Splunk, Datadog, Elastic) without building an export pipeline.

Both writes are fire-and-forget via `Promise.allSettled` and never block the primary operation. The consolidation workflow merges individual R2 events into daily archives and purges D1 records beyond 90 days.

### Security headers and input validation

- All responses include `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- CSRF protection via `Origin`/`Referer`/`Sec-Fetch-Site` validation in middleware for cookie-based flows
- All MCP tool and REST API inputs have Zod `.max()` bounds on strings and arrays to prevent oversized payloads
- Cross-namespace relation creation is rejected at the data layer (both source and target must belong to the same namespace)

## RBAC model

Namespace access is controlled by three roles, each with a numeric level:

| Role     | Level | Capabilities                                    |
| -------- | ----- | ----------------------------------------------- |
| `owner`  | 3     | Full control, transfer ownership, manage grants |
| `editor` | 2     | Read and write entities, relations, memories    |
| `viewer` | 1     | Read-only access                                |

A user's effective role is the highest level across all sources: implicit ownership (from `namespaces.owner`), direct user grants, and group membership grants. This is a union model where the most permissive grant wins.

### Groups

Groups are app-managed in D1 (not synced from an identity provider). Each group has its own role hierarchy:

| Group role | Capabilities                                    |
| ---------- | ----------------------------------------------- |
| `owner`    | Delete group, manage all members and roles      |
| `admin`    | Add/remove members, change member roles         |
| `member`   | Inherits namespace grants assigned to the group |

### Namespace visibility

Namespaces have a `visibility` column: `private` (default) or `public`. Public namespaces are readable by any authenticated user. Write access still requires an explicit editor or owner grant.

### Administration

Groups, group members, and namespace grants are managed through the REST API, not MCP tools. This keeps the MCP tool surface lean (17 tools). Namespace sharing actions (`share`, `unshare`, `list_access`, `transfer`, `set_visibility`) are available through the `manage_namespace` MCP tool.

## Infrastructure rationale

The server runs entirely on Cloudflare's developer platform. Each service was chosen for a specific technical reason:

| Service             | Why                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**              | SQLite semantics with read replication. Sessions API for read/write consistency. No connection pooling. `withRetry()` handles transient errors.                                    |
| **Vectorize**       | Native ANN search integrated with the Workers runtime. No external vector database to provision.                                                                                   |
| **Workers AI**      | Embedded inference (embeddings via `@cf/baai/bge-m3`, summaries, merge, reranking) routed through AI Gateway for analytics, caching, and rate limiting.                            |
| **KV**              | Globally distributed cache with TTL control. Four separate namespaces (USERS, FLAGS, CACHE, OAUTH_KV) for isolation. 30-second cacheTtl on identity for security-first revocation. |
| **R2**              | S3-compatible object storage for the audit archive. No egress fees. Indefinite retention.                                                                                          |
| **Durable Objects** | Stateful MCP sessions with persistent state across tool calls within a conversation.                                                                                               |
| **Workflows**       | Durable multi-step background jobs with step-level retry. Consolidation and reindex survive Worker restarts.                                                                       |

The net result: one `wrangler deploy` provisions the entire stack. No separate databases, queues, or object stores to manage.

## Data flow

### Write path

1. MCP tool or REST API handler validates input (Zod schemas)
2. Auth check: read-access (owner or public) for reads, write-access (owner or admin+public) for writes
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
- `src/consolidation.ts` -- Decay sweep, duplicate detection, archive, purge
- `src/stats.ts` -- Namespace aggregate statistics
- `src/summaries.ts` -- Entity summary generation via Workers AI
- `src/merge.ts` -- Memory merge: cosine clustering + LLM summarization

### Shared schemas

- `src/tool-schemas.ts` -- Shared Zod schemas, enums, field definitions (single source of truth for MCP tools, REST validators, and OpenAPI specs)

### MCP tools

- `src/tools/` -- One file per domain: namespace, entity, relation, traversal, memory, conversation, search, admin
- `src/response-helpers.ts` -- `txt`, `ok`, `err`, `safeMeta`, `toolHandler`, `confirm`
- `src/state.ts` -- Session state: `track`, `untrack`, `resolveNamespace`, `resolveConversation`

### REST API

- `src/api/index.ts` -- Router, route registration, public endpoints
- `src/api/cors.ts` -- CORS headers (wildcard `*`) and gzip compression
- `src/api/registry.ts` -- Single source of truth for routing + OpenAPI spec
- `src/api/middleware.ts` -- JWT auth, service token resolution, JSON helpers
- `src/api/openapi.ts` -- Assembles OpenAPI 3.1 spec dynamically
- `src/api/docs.ts` -- Scalar API reference UI
- `src/api/routes/` -- One file per domain, each registers routes + OpenAPI definitions

### Observability

- `src/audit.ts` -- D1 hot window + R2 individual event objects, `audit()`, `consolidateAuditR2()`, `queryAuditLogs()`, `purgeAuditLogs()`

### Workflows

- `src/workflows/reindex.ts` -- `ReindexWorkflow`: durable batch re-embedding
- `src/workflows/consolidation.ts` -- `ConsolidationWorkflow`: 7-step pipeline (decay, dedup, memory merge, AI summaries, memory purge, R2 audit consolidation, D1 audit purge)
- `src/reindex.ts` -- Shared chunk logic used by reindex workflow + REST API

## Design decisions

- **Per-user data isolation:** All data is scoped by namespace ownership. Public namespaces allow read access to any authenticated user; write access requires owner OR admin.
- **Best-effort audit:** Audit writes never fail the primary operation. D1 + R2 writes fire concurrently via `Promise.allSettled`.
- **Elicitation for destructive ops:** Delete operations prompt for confirmation via MCP elicitation. Graceful degradation if client doesn't support it.
- **Session state:** Active namespace, recent entities, and current conversation are tracked in Durable Object state for smarter defaults across tool calls.
- **Write retry:** All D1 writes wrapped in `withRetry()` with jitter backoff for transient errors. Workflow steps have their own retry mechanism.
