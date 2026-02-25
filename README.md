# Memory Graph MCP

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.12-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTEyIDJMMiA3djEwbDEwIDUgMTAtNVY3eiIvPjwvc3ZnPg==)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-4.x-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

A remote MCP server on Cloudflare Workers that gives LLMs persistent, structured memory via knowledge graphs, semantic search, and temporally-decayed recall.

## Architecture

| Component | Cloudflare Service | Purpose |
|---|---|---|
| MCP sessions | **Durable Objects** | Stateful per-session MCP agent (`McpAgent`) |
| Structured graph | **D1** (SQLite) | Entities, relations, memories, conversations |
| Semantic search | **Vectorize** + **Workers AI** | Embedding-based similarity (`@cf/baai/bge-large-en-v1.5`, 1024d) |
| Auth | **KV** + **OAuthProvider** | OAuth token/client storage, Cloudflare Access integration |
| Cache | **KV** | Optional caching layer |
| Blob storage | **R2** | Conversation logs, documents |

## Tools (25)

**Namespaces** -- `create_namespace`, `list_namespaces`

**Entities** (graph nodes) -- `create_entity`, `get_entity`, `search_entities`, `update_entity`, `delete_entity`

**Relations** (graph edges) -- `create_relation`, `get_relations`, `delete_relation`

**Graph traversal** -- `traverse_graph` (BFS from a starting entity, configurable depth)

**Memories** (knowledge fragments) -- `create_memory`, `recall_memories` (ranked by importance + temporal decay), `search_memories`, `get_entity_memories`, `update_memory`, `delete_memory`

**Conversations** -- `create_conversation`, `list_conversations`, `add_message`, `get_messages`, `search_conversations`

**Semantic search** -- `semantic_search` (vector similarity across entities, memories, messages), `get_context` (composite: semantic + graph + ranked memories in one call)

**Admin** -- `reindex_vectors` (re-embed all entities/memories into Vectorize)

## Setup

### Prerequisites
- Node.js 18+
- Cloudflare account with Workers, D1, Vectorize, and Workers AI enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 1. Install dependencies

```bash
npm install
```

### 2. Create Cloudflare resources

```bash
npx wrangler d1 create memory-graph-mcp-db
npx wrangler vectorize create memory-graph-mcp-embeddings --dimensions=1024 --metric=cosine
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create memory-graph-mcp-storage
```

### 3. Update wrangler.jsonc

Replace the IDs in `wrangler.jsonc` with the values printed by the commands above:
- `database_id` for D1
- `id` for each KV namespace

### 4. Initialize the database schema

```bash
npm run db:init        # remote
npm run db:init:local  # local dev
```

### 5. Deploy

```bash
npm run dev     # local development
npm run deploy  # production
```

## Connecting Clients

Add to your MCP client config (Claude Desktop, OpenCode, Cursor, etc.):

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp
```

## Temporal Decay

`recall_memories` ranks memories by blending importance with recency:

```
relevance = importance * 0.4 + recency_factor * 0.6
recency_factor = e^(-ln(2) / half_life_hours * age_hours)
```

Default half-life is 7 days. Accessing a memory resets its recency.
