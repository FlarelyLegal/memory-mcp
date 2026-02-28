# Contributing

[< Back to docs](README.md) | [< Back to main README](../README.md)

## Setup

```bash
npm install
npm run db:init:local          # create local D1 tables
npm run dev -- --local --port 8787
```

Copy `.dev.vars.example` to `.dev.vars` for the OAuth flow. Without secrets, `/health` and unauthenticated endpoints still work.

## D1 migrations

D1 schema changes are managed with Wrangler migrations in the `migrations/` directory.

- Keep `schemas/schema.sql` as the current-state reference schema.
- Add a migration file for every schema change (`000x_description.sql`).
- Apply locally first, then remote worker-b, then remote worker-a.

```bash
npx wrangler d1 migrations create memory-graph-mcp-db <message> --config wrangler-b.jsonc
npm run migrate:local
npm run migrate:b
npm run migrate:a
```

Useful checks:

```bash
npx wrangler d1 migrations list memory-graph-mcp-db --config wrangler-b.jsonc
npx wrangler d1 migrations list memory-graph-mcp-db --config wrangler-a.jsonc
```

## Checks

All four must pass before opening a PR:

```bash
npm run typecheck
npm run lint
npm run format          # auto-fix; use format:check for CI
npm run build           # wrangler dry-run
```

## Coding standards

- **250-line cap** per source file. If a file grows past this, extract a focused module.
- **One concern per file.** Don't add self-contained utilities to unrelated files. Keep helpers in the file that uses them unless they're shared.
- **Conventional commits required.** `feat:` = minor, `fix:` = patch, `feat!:` / `fix!:` = major. Scopes encouraged (e.g. `feat(api):`, `fix(tools):`). The release workflow uses git-cliff to generate changelogs from these.
- **Merge commits only.** Squash and rebase are disabled on the repo.
- **MCP tools and REST API routes mirror each other.** If you add a tool, add the corresponding REST endpoint (and vice versa).
- **Shared Zod schemas.** Field definitions live in `src/tool-schemas.ts`. MCP tools import Zod directly, REST validators compose from them, OpenAPI specs derive JSON Schema via `zodSchema()` in `api/schemas.ts`. Never duplicate field constraints.
- **OpenAPI is auto-generated.** Each route file registers its handler and its `PathOperation`. No separate spec file.
- **Version lives in `package.json` only.** `src/version.ts` reads it at build time. Never hardcode version strings.
- **All write operations must be audit-logged** via `audit()` from `src/audit.ts`.
- **All data-layer writes use `withRetry()`** from `src/db.ts` for transient D1 error resilience. Workflow steps have their own retry and don't need it.
- **All data-layer functions accept `DbHandle`**, never raw `D1Database`.
- **Input validation.** All tool/API inputs must have Zod `.max()` bounds on strings and arrays.
- **Limit console.log output.** Only structural metadata — no emails, no detail, no sensitive data.

## Adding an MCP tool

1. Create or edit the file in `src/tools/` for the relevant domain.
2. Import shared schemas from `src/tool-schemas.ts`.
3. Use the `toolHandler()` wrapper from `src/response-helpers.ts` for consistent error handling.
4. Add the corresponding REST route in `src/api/routes/`.
5. Register the OpenAPI `PathOperation` using `zodSchema()` for request/response schemas.
6. Audit-log write operations with `audit()`.
7. Update the tool table in `AGENTS.md`.

## Adding a REST route

1. Create or edit the file in `src/api/routes/` for the relevant domain.
2. Define the route and its `PathOperation` in the same file.
3. Register it in `src/api/index.ts`.
4. Use validators from `src/api/validators.ts` (composed from `src/tool-schemas.ts`).
5. Derive OpenAPI schemas with `zodSchema()` — don't hand-write JSON Schema.

## Branch workflow

1. Create a branch off `main`.
2. Make focused, conventional commits.
3. Open a PR targeting `main`.
4. CI runs lint, typecheck, build, and E2E (site B) automatically.
5. Merge commit (no squash/rebase) to preserve commit granularity for release notes.

## Local dev caveats

- **`--local` flag required** unless you have a `CLOUDFLARE_API_TOKEN`.
- **Workers AI and Vectorize don't work locally.** Embedding/search tools fail gracefully. D1, KV, R2, and Durable Objects work.
- **Run `npm run db:init:local`** before first dev server run.
