# FAQ

[< Back to docs](README.md) | [< Back to main README](../README.md)

Frequently asked questions about FlarelyLegal Memory MCP.

## General

**What is this?**
FlarelyLegal Memory MCP is a remote MCP server on Cloudflare Workers that gives LLMs collaborative, persistent structured memory — shared knowledge graphs with RBAC, semantic search, conversation history, and temporally-decayed recall.

**Can I try it?**
The public demo runs at `memory.flarelylegal.com`. Access is gated by Cloudflare Access — open an issue or reach out to request a test account.

**What MCP clients work with this?**
Any MCP-compatible client: Claude Desktop, Cursor, OpenCode, etc. See [MCP Tools](mcp-tools.md) for connection config.

## Local development

**Do I need a Cloudflare account to develop locally?**
No. Run `npm run dev -- --local --port 8787` to use local D1, KV, R2, and Durable Objects. Workers AI and Vectorize are not available locally — tools that use embeddings/search fail gracefully.

**Why do I get empty tables when running locally?**
Run `npm run db:init:local` before first use to create the D1 SQLite tables.

**What secrets do I need for local dev?**
See `.dev.vars.example`. Without secrets, `/health` and `/register` work but the OAuth login flow won't.

## CI/CD

**How does CI work?**
Push to `main` or open a PR to trigger the full pipeline: lint, typecheck, build, and E2E tests (site B). See [.github/workflows/README.md](../.github/workflows/README.md) for details on all 13 workflows.

**How are releases created?**
Automated via `release.yml`. Pushing to `main` triggers git-cliff to calculate the next semver from conventional commits, bump `package.json`, generate a changelog, and create a GitHub Release. No manual version management needed.

**What commit format is required?**
[Conventional commits](https://www.conventionalcommits.org/). `feat:` = minor bump, `fix:` = patch, `feat!:` / `fix!:` = major. See [Contributing](contributing.md).

## Architecture

**Why Durable Objects for MCP sessions?**
Each MCP session gets its own stateful Durable Object instance with direct access to all env bindings. Sessions auto-expire after 24 hours of inactivity.

**How does auth work?**
Cloudflare Access via a full OAuth/OIDC flow. MCP clients go through `/authorize` → `/callback`. The REST API accepts `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie. No Bearer tokens.

**Where is data stored?**
D1 for the graph, memories, conversations, and audit logs. Vectorize for semantic search indexes. R2 for audit log archive. KV for caching and OAuth state.

## Contributing

**Where are the coding standards?**
See [Contributing](contributing.md) for setup, coding standards (250-line file cap, shared Zod schemas, audit logging requirements), and the branch workflow.

**How do I add a new MCP tool?**
Add the tool in `src/tools/`, use shared schemas from `src/tool-schemas.ts`, and audit-log writes. For RBAC/user/group administration, prefer REST routes in `src/api/routes/` to keep MCP tool context lean. Step-by-step in [Contributing](contributing.md#adding-an-mcp-tool).
