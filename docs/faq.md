# FAQ

[< Back to docs](README.md) | [< Back to main README](../README.md)

Frequently asked questions about FlarelyLegal Memory MCP.

## General

**What is this?**
FlarelyLegal Memory MCP is a remote MCP server on Cloudflare Workers that gives LLMs collaborative, persistent shared memory: knowledge graphs with RBAC, semantic search, conversation history, and temporally-decayed recall.

**Can I try it?**
The public demo runs at `memory.flarelylegal.com`. Access is gated by Cloudflare Access. Open an issue or reach out to request a test account.

**What MCP clients work with this?**
Any MCP-compatible client: Claude Desktop, Cursor, OpenCode, etc. See [MCP Tools](mcp-tools.md) for connection config.

## Local development

**Do I need a Cloudflare account to develop locally?**
No. Run `npm run dev -- --local --port 8787` to use local D1, KV, R2, and Durable Objects. Workers AI and Vectorize are not available locally, so tools that use embeddings/search fail gracefully.

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

## Shared memory and access control

**Is this a shared/team memory server?**
Yes. Namespaces can be shared with individuals or groups using role-based grants (owner/editor/viewer). The typical flow: create a namespace, then use `manage_namespace share` to grant access to a colleague or a group. Groups are managed through the REST API: create a group, add members, then grant the group access to namespaces. All namespaces are private by default.

**How is data isolated between users?**
Every namespace is private by default. Only the owner and explicitly granted users or groups can access it. JWT-verified identity is checked on every request with no ambient authority. Namespace ownership is enforced on every data access, and cross-namespace relation creation is rejected at the data layer.

**Can I use this for a single user?**
Yes. When you do not share any namespaces, it works exactly like a personal memory server. You still get the full feature set: knowledge graph, semantic search, temporal decay, conversation history, and audit trail.

## Security

**What security model does this use?**
Cloudflare Access provides identity through a full OAuth/OIDC flow. Every request is authenticated via RSA JWT verification with audience tag validation. Every write operation is audit-logged to D1 (90 days queryable) and R2 (NDJSON archive, indefinite retention). R2 is S3-compatible, so the audit archive can be consumed directly by Loki, Splunk, Datadog, Elastic, or any S3-aware log aggregator without building an export pipeline. All responses include security headers (HSTS, X-Frame-Options, X-Content-Type-Options). Cookie-based flows are protected by CSRF validation (Origin/Referer/Sec-Fetch-Site). Service tokens are supported with identity binding for CI/CD and automation. Cloudflare encrypts all stored data at rest at the storage layer.

## Contributing

**Where are the coding standards?**
See [Contributing](contributing.md) for setup, coding standards (250-line file cap, shared Zod schemas, audit logging requirements), and the branch workflow.

**How do I add a new MCP tool?**
Add the tool in `src/tools/`, use shared schemas from `src/tool-schemas.ts`, and follow these security requirements: every data access must call `assertNamespaceReadAccess` or `assertNamespaceWriteAccess` with `UserIdentity`, every write must call `audit()`, all inputs must have Zod `.max()` bounds, and destructive operations should use the `confirm()` helper for elicitation. For RBAC/user/group administration, prefer REST routes in `src/api/routes/` to keep the MCP tool surface lean. Step-by-step in [Contributing](contributing.md#adding-an-mcp-tool).
