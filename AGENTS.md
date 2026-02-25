# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Memory Graph MCP — a remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory (knowledge graphs, semantic search, conversation history, temporal decay). Single-package TypeScript project using npm.

### Key commands

See `package.json` scripts. Summary:

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Typecheck | `npm run typecheck` |
| Build (dry-run) | `npm run build` |
| Dev server (local) | `npx wrangler dev --local --port 8787` |
| Init local D1 schema | `npm run db:init:local` |

### Non-obvious caveats

- **Local dev requires `--local` flag:** In environments without a `CLOUDFLARE_API_TOKEN`, use `npx wrangler dev --local` instead of `npm run dev`. Without `--local`, Wrangler requires an API token for the AI and Vectorize bindings (which use remote Cloudflare services).
- **AI and Vectorize not available locally:** When running `--local`, the Workers AI and Vectorize bindings show "not supported". Tools that rely on embeddings/semantic search will fail gracefully. D1, KV, R2, and Durable Objects all work locally.
- **Local D1 must be initialized:** Before first dev server run, execute `npm run db:init:local` to create the SQLite tables in `.wrangler/state/`.
- **OAuth flow requires Cloudflare Access secrets:** The full OAuth login flow needs `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_TOKEN_URL`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_JWKS_URL`, and `COOKIE_ENCRYPTION_KEY` in `.dev.vars`. Without these, the `/health`, `/register`, and `/.well-known/oauth-authorization-server` endpoints still work, but the `/authorize` → `/callback` flow and authenticated MCP tool calls will not.
- **Health endpoint:** `GET /health` returns `{"status":"ok","server":"memory-graph-mcp","version":"0.1.0"}` and requires no authentication — use it to verify the server is running.
