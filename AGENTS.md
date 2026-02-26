# AGENTS.md

## Agent instructions

### Project overview

Memory Graph MCP — a remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory (knowledge graphs, semantic search, conversation history, temporal decay). Single-package TypeScript project using npm.

Built on: **D1** (graph + memories), **Vectorize** (semantic search), **Workers AI** (embeddings via `@cf/baai/bge-large-en-v1.5`), **KV** (caching + OAuth state), **R2** (blob storage), **Durable Objects** (stateful MCP sessions), and **Cloudflare Access** (per-user auth via full OAuth/OIDC flow).

### Key commands

See `package.json` scripts. Summary:

| Task                 | Command                                |
| -------------------- | -------------------------------------- |
| Install deps         | `npm install`                          |
| Typecheck            | `npm run typecheck`                    |
| Build (dry-run)      | `npm run build`                        |
| Lint                 | `npm run lint`                         |
| Format               | `npm run format`                       |
| Dev server (local)   | `npx wrangler dev --local --port 8787` |
| Init local D1 schema | `npm run db:init:local`                |
| Deploy (first time)  | `npm run deploy:init`                  |
| Deploy (subsequent)  | `npm run deploy`                       |

### Versioning and releases

- **Single source of truth:** version lives in `package.json` only. `src/version.ts` reads it at build time. Never hardcode version strings elsewhere.
- **Automated releases:** pushing to `main` triggers `.github/workflows/release.yml` which uses git-cliff to calculate the next semver from conventional commits, bumps `package.json`, syncs README badges (Node, TypeScript, MCP SDK versions), creates a GitHub Release with a changelog, and commits with `[skip ci]` to prevent loops.
- **Conventional commits required:** `feat` → minor bump, `fix` → patch bump, `feat!` / `fix!` → major bump. The changelog groups by commit type and credits PR authors.
- **Description constants:** `src/version.ts` exports `VERSION`, `SERVER_NAME`, `SERVER_DISPLAY_NAME`, `SERVER_DESCRIPTION`, and `REPO_URL`. These are consumed by the MCP server constructor, OAuth approval page, root URL landing page, and `/health` endpoint. Update description in `version.ts` only.

### Non-obvious caveats

- **Local dev requires `--local` flag:** Without a `CLOUDFLARE_API_TOKEN`, use `npx wrangler dev --local`. Without `--local`, Wrangler requires an API token for the AI and Vectorize bindings (remote services).
- **AI and Vectorize not available locally:** When running `--local`, Workers AI and Vectorize bindings are unsupported. Tools relying on embeddings/semantic search fail gracefully. D1, KV, R2, and Durable Objects all work locally.
- **Local D1 must be initialized:** Before first dev server run, execute `npm run db:init:local` to create SQLite tables in `.wrangler/state/`.
- **OAuth flow requires secrets:** The full OAuth login flow needs seven secrets in `.dev.vars` (see `.dev.vars.example`): `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`, `ACCESS_AUD_TAG`, and `COOKIE_ENCRYPTION_KEY`. Without these, `/health` and `/register` still work, but the `/authorize` → `/callback` flow and authenticated MCP tool calls will not.
- **JWT audience validation:** `ACCESS_AUD_TAG` is the Cloudflare Access Application Audience tag (not the OAuth client ID). It validates the `aud` claim in ID tokens to prevent cross-application token reuse.
- **Root URL:** `GET /` returns a plain-text landing page with version, description, and repo link. All other unknown paths return 404.
- **Health endpoint:** `GET /health` returns `{"status":"ok","server":"memory-graph-mcp","version":"<version>"}` — no auth required.
- **Security headers:** All responses from the access handler include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security`.
- **Input validation:** All MCP tool inputs have Zod `.max()` bounds on strings and arrays to prevent oversized payloads to D1/Workers AI.
- **Relation ownership:** `manage_relation` create verifies both `source_id` and `target_id` belong to the specified namespace — cross-namespace relations are rejected.

### File structure

Code is organized into focused modules with a 250-line cap per file:

- `src/index.ts` — MCP server entry point (McpAgent class + OAuthProvider export)
- `src/version.ts` — Single source of truth for version, name, description, repo URL
- `src/types.ts` — `Env` interface (all bindings), `AuthProps`, domain types + DB row types
- `src/access-handler.ts` — OAuth route handler (`/authorize`, `/callback`, `/health`, `/`)
- `src/auth.ts` — Per-user authorization: `assertNamespaceAccess`, `assertEntityAccess`, `assertMemoryAccess`, `assertConversationAccess`, `assertRelationAccess`
- `src/jwt.ts` — JWT verification (RSA signature + expiry + audience validation)
- `src/embeddings.ts` — Vectorize + Workers AI: embed, upsert, delete, semantic search
- `src/memories.ts` — Memory CRUD + temporal-decay recall ranking
- `src/conversations.ts` — Conversation and message history
- `src/utils.ts` — `generateId`, `decayScore`, JSON helpers
- `src/response-helpers.ts` — Shared MCP response helpers (`txt`, `ok`, `cap`)
- `src/tools/` — One file per tool domain (namespace, entity, relation, traversal, memory, conversation, search, admin). Each exports a `register*Tools(server, env, email)` function.
- `src/graph/` — D1 operations split by domain (namespaces, entities, relations, traversal) with barrel re-export via `index.ts`.
- `src/oauth/` — OAuth utilities split by concern (error, sanitize, csrf, state, approval) with barrel re-export via `index.ts`.
- `schemas/schema.sql` — D1 schema (6 tables: namespaces, entities, relations, conversations, messages, memories + memory_entity_links).

### MCP tools (14 total)

| Tool                  | Domain       | Description                                                |
| --------------------- | ------------ | ---------------------------------------------------------- |
| `manage_namespace`    | namespace    | Create or list memory namespaces                           |
| `manage_entity`       | entity       | CRUD for graph entities with embedding upsert              |
| `find_entities`       | entity       | Search entities by name/type/keyword                       |
| `manage_relation`     | relation     | Create or delete directed relations (with ownership check) |
| `get_relations`       | relation     | Query relations from/to an entity                          |
| `traverse_graph`      | traversal    | BFS from an entity up to max_depth hops                    |
| `manage_memory`       | memory       | Create/update/delete memories with embedding               |
| `query_memories`      | memory       | Recall (decay-ranked), search (keyword), or entity-linked  |
| `manage_conversation` | conversation | Create or list conversations                               |
| `add_message`         | conversation | Add a message and embed for search                         |
| `get_messages`        | conversation | Get or search messages                                     |
| `search`              | search       | Semantic vector search; context mode enriches with graph   |
| `reindex_vectors`     | admin        | Batch re-embed entities/memories (25 per batch)            |
| `claim_namespaces`    | admin        | Claim all unowned namespaces for current user              |
