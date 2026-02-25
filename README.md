# Memory Graph MCP

<!-- badges:start -->

[![CI](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-≥24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blue)](https://modelcontextprotocol.io)

<!-- badges:end -->

A remote MCP server on Cloudflare Workers that gives LLMs persistent, structured memory via knowledge graphs, semantic search, and temporally-decayed recall.

## Architecture

| Component        | Cloudflare Service             | Purpose                                                          |
| ---------------- | ------------------------------ | ---------------------------------------------------------------- |
| MCP sessions     | **Durable Objects**            | Stateful per-session MCP agent (`McpAgent`)                      |
| Structured graph | **D1** (SQLite)                | Entities, relations, memories, conversations                     |
| Semantic search  | **Vectorize** + **Workers AI** | Embedding-based similarity (`@cf/baai/bge-large-en-v1.5`, 1024d) |
| Auth             | **KV** + **OAuthProvider**     | OAuth token/client storage, Cloudflare Access integration        |
| Cache            | **KV**                         | Optional caching layer                                           |
| Blob storage     | **R2**                         | Conversation logs, documents                                     |

## Tools (13)

Consolidated from 25 granular tools into 13 action-based tools for token efficiency. Each multi-action tool uses an `action` or `mode` parameter to select the operation.

**Namespaces** -- `manage_namespace` (create, list)

**Entities** (graph nodes) -- `manage_entity` (create, get, update, delete), `find_entities` (search by name/type/keyword)

**Relations** (graph edges) -- `manage_relation` (create, delete), `get_relations` (from/to/both with direction filter)

**Graph traversal** -- `traverse_graph` (BFS from a starting entity, max depth 5)

**Memories** (knowledge fragments) -- `manage_memory` (create, update, delete), `query_memories` (modes: recall, search, entity)

**Conversations** -- `manage_conversation` (create, list), `add_message`, `get_messages` (recent or keyword search)

**Semantic search** -- `search` (modes: semantic vector search, context with graph enrichment)

**Admin** -- `reindex_vectors` (re-embed all entities/memories into Vectorize)

## Project Structure

```
src/
  index.ts              MCP server entry point (McpAgent + OAuthProvider)
  response-helpers.ts   Shared response utilities (txt, ok, cap)
  types.ts              TypeScript type definitions
  utils.ts              Utility functions (IDs, timestamps, decay scoring)
  auth.ts               Per-user namespace authorization guards
  embeddings.ts         Vectorize + Workers AI embedding operations
  memories.ts           Memory CRUD with temporal decay
  conversations.ts      Conversation and message operations
  access-handler.ts     Cloudflare Access OAuth route handler
  jwt.ts                JWT parsing, JWKS fetch, token verification
  tools/
    namespace.ts        manage_namespace tool
    entity.ts           manage_entity, find_entities tools
    relation.ts         manage_relation, get_relations tools
    traversal.ts        traverse_graph tool
    memory.ts           manage_memory, query_memories tools
    conversation.ts     manage_conversation, add_message, get_messages tools
    search.ts           search tool (semantic + context modes)
    admin.ts            reindex_vectors tool
  graph/
    namespaces.ts       Namespace D1 CRUD
    entities.ts         Entity D1 CRUD
    relations.ts        Relation D1 CRUD
    traversal.ts        BFS graph traversal
    index.ts            Barrel re-export
  oauth/
    error.ts            OAuthError class
    sanitize.ts         HTML/URL sanitization
    csrf.ts             CSRF token generation/validation
    state.ts            OAuth state management + upstream token exchange
    approval.ts         Approval dialog UI + signed cookie management
    index.ts            Barrel re-export
```

## Setup

### Prerequisites

- Node.js 24+
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

`query_memories` (recall mode) ranks memories by blending importance with recency:

```
relevance = importance * 0.4 + recency_factor * 0.6
recency_factor = e^(-ln(2) / half_life_hours * age_hours)
```

Default half-life is 7 days. Accessing a memory resets its recency.
