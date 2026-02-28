# Deployment

[README](../README.md) > [Docs](README.md) > Deployment

## Prerequisites

- Node.js 24+, [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers, D1, Vectorize, and Workers AI

## 1. Create Cloudflare resources

```bash
npm install

npx wrangler d1 create memory-graph-mcp-db
npx wrangler vectorize create memory-graph-mcp-embeddings --preset=@cf/baai/bge-m3
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create memory-graph-mcp-storage
```

Update resource IDs in the appropriate wrangler config:

- `wrangler-a.jsonc` (Account A)
- `wrangler-b.jsonc` (Account B)

## 2. Create Vectorize metadata indexes

Required for filtered semantic search. Run once per account:

```bash
npm run vectorize:indexes    # account A
npm run vectorize:indexes:b  # account B
```

Creates indexes on `namespace_id`, `kind`, `type`, `created_at`, `role`, `conversation_id`, and `entity_id`. Without these, metadata filters silently return empty results.

## 3. Initialize D1 schema

```bash
npm run db:init      # account A (remote)
npm run db:init:b    # account B (remote)
npm run db:init:local  # local dev
```

## 4. Deploy

```bash
npm run deploy:init    # first deploy (creates D1 tables + deploys)
npm run deploy         # account A (subsequent)
npm run deploy:b       # account B (subsequent)
```

### Cloudflare dashboard builds

Set explicit commands per account in the Cloudflare Workers dashboard:

| Account | Build command     | Deploy command                                           |
| ------- | ----------------- | -------------------------------------------------------- |
| A       | `npm run build`   | `npx wrangler versions upload --config wrangler-a.jsonc` |
| B       | `npm run build:b` | `npx wrangler versions upload --config wrangler-b.jsonc` |

Using the wrong config causes cross-account binding failures (KV/D1/Vectorize IDs not found).

## Local development

```bash
npm run db:init:local                  # create local D1 tables
npm run dev -- --local --port 8787     # account A config
npm run dev:b -- --local --port 8787   # account B config
```

Workers AI and Vectorize are unavailable locally. Embedding/search tools fail gracefully. D1, KV, R2, and Durable Objects work.

## Database migrations

Fresh installs via `db:init` include everything. For existing databases, run migrations in order:

| Migration                   | Script (A / B / local)                                  | When                                |
| --------------------------- | ------------------------------------------------------- | ----------------------------------- |
| FTS5 tables + triggers      | `db:migrate:fts` / `fts:b` / `fts:local`                | After upgrading to FTS5 search      |
| Optimize indexes + triggers | `db:migrate:optimize` / `optimize:b` / `optimize:local` | After upgrading to optimized schema |
| Audit logs table            | `schemas/audit.sql` via `wrangler d1 execute`           | After adding audit logging          |

Migrations are idempotent (`IF NOT EXISTS`, `DROP IF EXISTS`).

## Demo seed

Seeds a `demo` namespace with the server modeled as its own knowledge graph -- 14 entities, 18 relations, and 14 memories.

```bash
API_BASE_URL="https://<your-worker-domain>" \
CF_ACCESS_CLIENT_ID="<service-token-id>" \
CF_ACCESS_CLIENT_SECRET="<service-token-secret>" \
npm run seed:demo
```

The seeder is idempotent -- it skips entities, relations, and memories that already exist.

GitHub Actions workflows for manual seeding: **Seed Demo (A Manual)** and **Seed Demo (B Manual)** under Actions > workflow_dispatch.

Seed source: `seeds/demo-directions.json`.
