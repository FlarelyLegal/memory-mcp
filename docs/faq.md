# FAQ

[README](../README.md) > [Docs](README.md) > FAQ

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
Push to `main` or open a PR to trigger the full pipeline: lint, typecheck, unit tests, build, and conditional E2E tests against site B. The workflow catalog currently has 21 workflows covering CI, release automation, PR checks, operational monitors, and manual operations. See [.github/workflows/README.md](../.github/workflows/README.md) for the complete catalog.

**How are releases created?**
Automated via `release.yml`. Pushing to `main` triggers git-cliff to calculate the next semver from conventional commits, bump `package.json`, generate a changelog, and create a GitHub Release. No manual version management needed.

**What commit format is required?**
[Conventional commits](https://www.conventionalcommits.org/). `feat:` = minor bump, `fix:` = patch, `feat!:` / `fix!:` = major. See [Contributing](contributing.md).

## Architecture

**Why Durable Objects for MCP sessions?**
Each MCP session gets its own stateful Durable Object instance with direct access to all env bindings. Sessions auto-expire after 24 hours of inactivity.

**How does auth work?**
Cloudflare Access via a full OAuth/OIDC flow. Every protected endpoint (`/api/v1/*` and MCP tool calls) is authenticated and authorized. Public endpoints (`/`, `/health`, `/api/docs`, `/api/openapi.json`, `/api/demo`) require no auth.

- **MCP clients:** OAuth flow via `/authorize` then `/callback`. Cloudflare Access handles the login page.
- **REST API:** JWT from Cloudflare Access, checked in order: `Cf-Access-Jwt-Assertion` header, `cf-access-token` header, or `CF_Authorization` cookie.
- **Service tokens:** `CF-Access-Client-Id` + `CF-Access-Client-Secret` headers for CI/headless use. See [Headless/CI](#headlessci) below.

No Bearer tokens.

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

- **Auth:** Cloudflare Access identity via OAuth/OIDC. Every protected endpoint verified by RSA JWT signature + expiry + audience tag. See [auth details above](#architecture).
- **Audit:** Every write is logged to D1 (90 days queryable) and R2 NDJSON archive (indefinite, S3-compatible). See [Observability](observability.md).
- **CSRF:** Cookie-based flows validated via Origin/Referer/Sec-Fetch-Site checks in middleware.
- **Service tokens:** CI/headless auth with identity binding -- `common_name` links token to user email. See [REST API -- service tokens](rest-api.md#service-tokens).
- **Headers:** All responses include HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff.
- **Encryption:** Cloudflare encrypts all stored data at rest at the storage layer.

## Headless/CI

**How do CI pipelines and headless agents authenticate?**
Use Cloudflare Access [service tokens](rest-api.md#service-tokens). Send `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on every request. The token must be bound to a user email first -- see [Service tokens](../README.md#service-tokens-cicd-and-automation) in the README.

**Why do I get "Service token not registered" (403)?**
The service token is valid at the Access edge but has not been bound to a user email on this server. Visit the [bind UI](https://memory.flarelylegal.com/api/v1/admin/service-tokens/bind) in your browser to link the token to your identity. See [Troubleshooting](troubleshooting.md#service-token-not-registered) for step-by-step resolution.

**Does rotating a service token secret require re-binding?**
No. Binding is keyed on `common_name` (= Client ID), which does not change when you rotate the secret in the Zero Trust dashboard. Rotate freely.

**Why does a valid Access JWT fail with "Invalid or expired token"?**
The most common cause is an `ACCESS_AUD_TAG` mismatch -- the audience tag in the Worker's config does not match the Access application that issued the JWT. See [Troubleshooting](troubleshooting.md#invalid-or-expired-token) for details.

## Contributing

**Where are the coding standards?**
See [Contributing](contributing.md) for setup, coding standards (250-line file cap, shared Zod schemas, audit logging requirements), and the branch workflow.

**How do I add a new MCP tool?**
Add the tool in `src/tools/`, use shared schemas from `src/tool-schemas.ts`, and follow these security requirements: every data access must call `assertNamespaceReadAccess` or `assertNamespaceWriteAccess` with `UserIdentity`, every write must call `audit()`, all inputs must have Zod `.max()` bounds, and destructive operations should use the `confirm()` helper for elicitation. For RBAC/user/group administration, prefer REST routes in `src/api/routes/` to keep the MCP tool surface lean. Step-by-step in [Contributing](contributing.md#adding-an-mcp-tool).
