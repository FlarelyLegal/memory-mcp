# Memory Graph MCP

[![CI](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/FlarelyLegal/memory-mcp?logo=github&label=release)](https://github.com/FlarelyLegal/memory-mcp/releases/latest)

[![Node.js](https://img.shields.io/badge/Node.js-≥24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blue)](https://modelcontextprotocol.io)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/FlarelyLegal/memory-mcp?logo=github)](https://github.com/FlarelyLegal/memory-mcp/issues)
[![GitHub Stars](https://img.shields.io/github/stars/FlarelyLegal/memory-mcp?style=flat&logo=github&label=stars)](https://github.com/FlarelyLegal/memory-mcp/stargazers)

Remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory — knowledge graphs, semantic search, and temporally-decayed recall.

Operational runbook (Access scope, CI targeting, A/B build parity, secrets matrix): `HOWTO.md`.

## Architecture

| Component        | Cloudflare Service             | Purpose                                             |
| ---------------- | ------------------------------ | --------------------------------------------------- |
| MCP sessions     | **Durable Objects**            | Stateful per-session MCP agent                      |
| Structured graph | **D1** (SQLite)                | Entities, relations, memories, conversations        |
| Semantic search  | **Vectorize** + **Workers AI** | Embeddings via `@cf/baai/bge-large-en-v1.5` (1024d) |
| Auth + tokens    | **KV**                         | OAuth state, service token → email bindings         |
| Blob storage     | **R2**                         | Reserved for future use                             |

## Setup

### Prerequisites

- Node.js 24+, [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers, D1, Vectorize, and Workers AI

### 1. Create Cloudflare resources

```bash
npm install

npx wrangler d1 create memory-graph-mcp-db
npx wrangler vectorize create memory-graph-mcp-embeddings --preset=@cf/baai/bge-large-en-v1.5
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create memory-graph-mcp-storage
```

Use account-specific configs and update resource IDs in each:

- `wrangler-a.jsonc` (Account A)
- `wrangler-b.jsonc` (Account B)

For Vectorize filtering to work, add metadata indexes for:

- `namespace_id` (string)
- `kind` (string)

### 2. Configure Cloudflare Access

You need a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) application to protect your Worker. This provides authentication for both interactive (MCP) and programmatic (REST API) access.

1. In the [Zero Trust dashboard](https://dash.cloudflare.com/one/), go to **Access > Applications**
2. Create a **Self-hosted** application for your Workers domain (e.g. `memory-graph-mcp.<subdomain>.workers.dev`)
3. Add an **Allow** policy for your identity provider (Google, GitHub, etc.)
4. If you plan to use service tokens for programmatic access, add a **Service Auth** policy (`non_identity`, include `any_valid_service_token` or specific token)
5. Note the following values from the application configuration:

Recommended path scope for the self-hosted Access app:

- Protect only `/api/v1` paths
- Leave `/api/docs` and `/api/openapi.json` outside Access so API docs/spec stay public

| Value                          | Where to find it                                           | Used as           |
| ------------------------------ | ---------------------------------------------------------- | ----------------- |
| Application Audience (AUD) tag | Application overview page                                  | `ACCESS_AUD_TAG`  |
| JWKS URL                       | `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` | `ACCESS_JWKS_URL` |

You also need a **SaaS application** for the MCP OAuth flow (this is separate from the self-hosted app above):

| Value             | Where to find it          | Used as                    |
| ----------------- | ------------------------- | -------------------------- |
| Client ID         | SaaS app > OIDC settings  | `ACCESS_CLIENT_ID`         |
| Client Secret     | SaaS app > OIDC settings  | `ACCESS_CLIENT_SECRET`     |
| Token URL         | SaaS app > OIDC endpoints | `ACCESS_TOKEN_URL`         |
| Authorization URL | SaaS app > OIDC endpoints | `ACCESS_AUTHORIZATION_URL` |
| JWKS URL          | SaaS app > OIDC endpoints | `ACCESS_JWKS_URL` (append) |

### 3. Set secrets

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the values.

For production, set each secret on the Worker. Run for both configs (`--config wrangler-a.jsonc` and `--config wrangler-b.jsonc`):

```bash
npx wrangler secret put ACCESS_CLIENT_ID --config wrangler-a.jsonc
npx wrangler secret put ACCESS_CLIENT_SECRET --config wrangler-a.jsonc
npx wrangler secret put ACCESS_TOKEN_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_AUTHORIZATION_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_JWKS_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_ISSUER --config wrangler-a.jsonc   # optional
npx wrangler secret put ACCESS_AUD_TAG --config wrangler-a.jsonc
npx wrangler secret put COOKIE_ENCRYPTION_KEY --config wrangler-a.jsonc
```

`ACCESS_JWKS_URL` and `ACCESS_AUD_TAG` can be comma-separated when using both self-hosted and SaaS Access apps.

**Important:** `ACCESS_AUD_TAG` must match the Access applications that issue your JWTs. Mismatched audience tags cause `Invalid or expired token` errors.

### 4. Deploy

```bash
npm run deploy:init    # first deploy (creates D1 tables + deploys)
npm run deploy         # account A
npm run deploy:b       # account B
```

Initialize schema per account:

```bash
npm run db:init      # account A
npm run db:init:b    # account B
```

### Local development

```bash
npm run db:init:local                  # create local D1 tables
npm run dev -- --local --port 8787      # account A config
npm run dev:b -- --local --port 8787    # account B config
```

Note: Workers AI and Vectorize are unavailable locally. Embedding/search tools fail gracefully. D1, KV, R2, and Durable Objects work.

## Authentication

### Interactive (MCP clients)

For Claude Desktop, Cursor, OpenCode, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

Your client opens the Cloudflare Access login page. You authenticate with your IdP, and the OAuth flow completes automatically. All data is scoped to your email.

### Programmatic (REST API via service tokens)

For agents, scripts, and CI pipelines that need programmatic access.

**1. Create a service token** in the [Zero Trust dashboard](https://dash.cloudflare.com/one/) under Access > Service Auth > Service Tokens. Save the **Client ID** and **Client Secret** (secret is only shown once).

**2. Add a Service Auth policy** to your Access application (Access > Applications > your app > Policies) that allows the service token.

**3. Create a bind challenge (human-authenticated).** Log in to your Worker in a browser, then grab the `CF_Authorization` cookie from DevTools (Application > Cookies):

```bash
curl -X POST https://<your-worker>/api/v1/admin/service-tokens/bind-request \
  -H "Cookie: CF_Authorization=<your-jwt-from-browser>" \
  -H "Content-Type: application/json" \
  -d '{"common_name": "<client-id>", "label": "My CI bot"}'
```

This returns a short-lived `challenge_id`.

**4. Complete bind as the service token (proof of possession).**

```bash
curl -X POST https://<your-worker>/api/v1/admin/service-tokens/bind-self \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>" \
  -H "Content-Type: application/json" \
  -d '{"challenge_id": "<challenge-id>"}'
```

**5. Make API calls.** Cloudflare Access validates the service token credentials and injects a signed JWT before the request reaches the Worker:

```bash
curl https://<your-worker>/api/v1/namespaces \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>"
```

You can also send a previously issued JWT as `cf-access-token` (or `CF_Authorization` cookie), but `Cf-Access-Jwt-Assertion` is preferred when present.

The Worker resolves the service token to your email via KV. All operations run with your permissions.

### Service token management

| Action                | Method   | Endpoint                                    |
| --------------------- | -------- | ------------------------------------------- |
| Create bind challenge | `POST`   | `/api/v1/admin/service-tokens/bind-request` |
| Complete self-bind    | `POST`   | `/api/v1/admin/service-tokens/bind-self`    |
| List your tokens      | `GET`    | `/api/v1/admin/service-tokens`              |
| Get binding           | `GET`    | `/api/v1/admin/service-tokens/:common_name` |
| Update label          | `PATCH`  | `/api/v1/admin/service-tokens/:common_name` |
| Revoke                | `DELETE` | `/api/v1/admin/service-tokens/:common_name` |

- `common_name` (= Client ID) survives token rotation — no need to re-bind after rotating the secret in the CF dashboard
- Unbound service tokens receive 403 for normal API routes (exception: `bind-self` during initial claim)

### API docs

- **OpenAPI spec:** `GET /api/openapi.json`
- **Interactive docs:** `GET /api/docs` (Scalar UI)
- Live docs URL: [https://memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)
- Both endpoints are unauthenticated in Worker code; keep them outside Access path protection.

### API response shaping

- Most list/search endpoints support `fields=` for projection.
- `fields=compact` and `fields=full` presets are supported.
- Cursor pagination is exposed via `X-Next-Cursor` response header; pass that value as `cursor=` on the next request.

### Public endpoints (no auth)

| Endpoint                | Response                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `GET /`                 | Plain-text landing page (version, description, repo)          |
| `GET /health`           | `{"status":"ok","server":"memory-graph-mcp","version":"..."}` |
| `GET /api/docs`         | Scalar API reference UI                                       |
| `GET /api/openapi.json` | OpenAPI 3.1 spec                                              |

## MCP Tools (14)

| Tool                  | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `manage_namespace`    | Create or list memory namespaces                           |
| `manage_entity`       | CRUD for graph entities with embedding upsert              |
| `find_entities`       | Search entities by name/type/keyword                       |
| `manage_relation`     | Create or delete directed relations (with ownership check) |
| `get_relations`       | Query relations from/to an entity                          |
| `traverse_graph`      | BFS from an entity up to max_depth hops                    |
| `manage_memory`       | Create/update/delete memories with embedding               |
| `query_memories`      | Recall (decay-ranked), search (keyword), or entity-linked  |
| `manage_conversation` | Create or list conversations                               |
| `add_message`         | Add a message and embed for search                         |
| `get_messages`        | Get or search messages                                     |
| `search`              | Semantic vector search; context mode enriches with graph   |
| `reindex_vectors`     | Batch re-embed entities/memories (25 per batch)            |
| `claim_namespaces`    | Claim all unowned namespaces for current user              |

### Temporal decay

`query_memories` recall mode ranks by blending importance with recency:

```
relevance = importance * 0.4 + recency * 0.6
recency   = e^(-ln(2) / half_life * age_hours)
```

Default half-life: 7 days. Accessing a memory resets its recency.

## Testing

```bash
npm run typecheck
npm run lint
npm run build
npm run test:e2e:a
npm run test:e2e:b
```

E2E tests call live APIs and require per-target env vars:

- `CF_ACCESS_CLIENT_ID_A`, `CF_ACCESS_CLIENT_SECRET_A`, `API_BASE_URL_A`
- `CF_ACCESS_CLIENT_ID_B`, `CF_ACCESS_CLIENT_SECRET_B`, `API_BASE_URL_B`
