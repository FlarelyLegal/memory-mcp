# Memory Graph MCP

<!-- badges:start -->

[![CI](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/FlarelyLegal/memory-mcp?logo=github&label=release)](https://github.com/FlarelyLegal/memory-mcp/releases/latest)
[![Node.js](https://img.shields.io/badge/Node.js-≥24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blue)](https://modelcontextprotocol.io)
[![GitHub Issues](https://img.shields.io/github/issues/FlarelyLegal/memory-mcp?logo=github)](https://github.com/FlarelyLegal/memory-mcp/issues)
[![GitHub Stars](https://img.shields.io/github/stars/FlarelyLegal/memory-mcp?style=flat&logo=github&label=stars)](https://github.com/FlarelyLegal/memory-mcp/stargazers)

<!-- badges:end -->

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FlarelyLegal/memory-mcp)

Remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory — knowledge graphs, semantic search, and temporally-decayed recall.

## Architecture

| Component        | Cloudflare Service             | Purpose                                             |
| ---------------- | ------------------------------ | --------------------------------------------------- |
| MCP sessions     | **Durable Objects**            | Stateful per-session MCP agent                      |
| Structured graph | **D1** (SQLite)                | Entities, relations, memories, conversations        |
| Semantic search  | **Vectorize** + **Workers AI** | Embeddings via `@cf/baai/bge-large-en-v1.5` (1024d) |
| Auth state       | **KV**                         | OAuth tokens/clients, Cloudflare Access integration |
| Blob storage     | **R2**                         | Reserved for future use                             |

## Tools (14)

**Namespaces** — `manage_namespace` (create, list)

**Entities** — `manage_entity` (create, get, update, delete), `find_entities` (name/type/keyword search)

**Relations** — `manage_relation` (create, delete), `get_relations` (from/to/both)

**Traversal** — `traverse_graph` (BFS, max depth 5)

**Memories** — `manage_memory` (create, update, delete), `query_memories` (recall, search, entity modes)

**Conversations** — `manage_conversation` (create, list), `add_message`, `get_messages` (recent or search)

**Search** — `search` (semantic vector search; context mode enriches with graph neighbors)

**Admin** — `reindex_vectors` (batch re-embed into Vectorize), `claim_namespaces` (adopt unowned namespaces)

## Project Structure

```
src/
  index.ts              MCP server entry (McpAgent + OAuthProvider)
  version.ts            Version, name, description constants
  types.ts              Env, AuthProps, domain + DB row types
  auth.ts               Per-user namespace authorization guards
  access-handler.ts     OAuth routes (/authorize, /callback, /health, /)
  jwt.ts                JWT verification (RSA + expiry + audience)
  embeddings.ts         Vectorize + Workers AI operations
  memories.ts           Memory CRUD with temporal decay
  conversations.ts      Conversation + message operations
  response-helpers.ts   MCP response helpers (txt, ok, cap)
  utils.ts              ID generation, decay scoring, JSON helpers
  tools/                One file per domain, each exports register*Tools()
  graph/                D1 operations by domain (barrel via index.ts)
  oauth/                OAuth utilities by concern (barrel via index.ts)
schemas/
  schema.sql            D1 schema (7 tables)
```

## Setup

### Prerequisites

- Node.js 24+
- Cloudflare account with Workers, D1, Vectorize, and Workers AI
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Quick Start

```bash
npm install

# Create Cloudflare resources
npx wrangler d1 create memory-graph-mcp-db
npx wrangler vectorize create memory-graph-mcp-embeddings --dimensions=1024 --metric=cosine
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create memory-graph-mcp-storage
```

Update `wrangler.jsonc` with the resource IDs from the commands above.

```bash
# Initialize database and deploy
npm run deploy:init

# Or for local development
npm run db:init:local
npx wrangler dev --local --port 8787
```

### Auth (Cloudflare Access)

The OAuth flow requires secrets — copy `.dev.vars.example` to `.dev.vars` and fill in values from your Cloudflare Access application. Without these, `/health` works but authenticated tool calls will not.

## Connecting Clients

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

Works with Claude Desktop, OpenCode, Cursor, or any MCP-compatible client.

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp
```

## Temporal Decay

`query_memories` recall mode ranks by blending importance with recency:

```
relevance = importance * 0.4 + recency * 0.6
recency   = e^(-ln(2) / half_life * age_hours)
```

Default half-life: 7 days. Accessing a memory resets its recency.
