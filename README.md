# Memory Graph MCP

A remote MCP server on Cloudflare Workers that gives LLMs persistent, structured memory.

**What it does:** Any MCP-compatible client (Claude, OpenCode, Cursor, etc.) can connect to this server and use tools to remember things, build knowledge graphs, search by meaning, and recall past conversations -- all persisted on Cloudflare's edge.

## Architecture

| Component | Cloudflare Service | Purpose |
|---|---|---|
| Structured graph | **D1** (SQLite) | Entities, relations, memories, conversations |
| Semantic search | **Vectorize** + **Workers AI** | Embedding-based similarity search |
| Compute | **Workers** | MCP server, tool handlers, graph traversal |
| Cache | **KV** | Optional caching layer |

## Available Tools (22)

### Namespaces
- `create_namespace` -- Create a scope (per-user, per-project, etc.)
- `list_namespaces` -- List all namespaces

### Entities (graph nodes)
- `create_entity` -- Add a person, concept, project, tool, etc.
- `get_entity` -- Get entity details by ID
- `search_entities` -- Search by name/type/keyword
- `update_entity` -- Modify an entity
- `delete_entity` -- Remove an entity and its relations

### Relations (graph edges)
- `create_relation` -- Create a directed relationship (e.g. Alice --knows--> Bob)
- `get_relations` -- Get relations from/to an entity
- `delete_relation` -- Remove a relation

### Graph Traversal
- `traverse_graph` -- BFS traversal from a starting entity (configurable depth)

### Memories (knowledge fragments)
- `create_memory` -- Store a fact, observation, preference, or instruction
- `recall_memories` -- Retrieve memories ranked by importance + recency (temporal decay)
- `search_memories` -- Keyword search
- `get_entity_memories` -- Get memories linked to an entity
- `update_memory` -- Modify a memory
- `delete_memory` -- Remove a memory

### Conversations
- `create_conversation` -- Start tracking a conversation
- `list_conversations` -- List recent conversations
- `add_message` -- Add a message (user/assistant/system/tool)
- `get_messages` -- Get conversation history
- `search_conversations` -- Search across all conversation messages

### Semantic Search
- `semantic_search` -- Vector similarity search across entities, memories, and messages
- `get_context` -- **High-level composite tool**: gathers semantic matches, graph context, ranked memories, and keyword matches in one call. Best for "tell me everything about X".

## Setup

### Prerequisites
- Node.js 18+
- A Cloudflare account with Workers, D1, Vectorize, and Workers AI enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 1. Install dependencies

```bash
cd memory-graph-mcp
npm install
```

### 2. Create Cloudflare resources

```bash
# Create the D1 database
npx wrangler d1 create memory-graph

# Create the Vectorize index (768 dimensions for bge-base-en-v1.5)
npx wrangler vectorize create memory-graph-embeddings --dimensions=768 --metric=cosine

# Create the KV namespace
npx wrangler kv namespace create CACHE
```

### 3. Update wrangler.jsonc

Replace the placeholder IDs in `wrangler.jsonc` with the actual IDs printed by the commands above:
- `database_id` for D1
- `id` for KV namespace

### 4. Initialize the database schema

```bash
# Remote
npm run db:init

# Or local dev
npm run db:init:local
```

### 5. Deploy

```bash
# Local development
npm run dev

# Deploy to production
npm run deploy
```

Your MCP server will be available at: `https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp`

## Connecting Clients

### Claude Desktop / OpenCode / Cursor

Add to your MCP client config:

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector https://memory-graph-mcp.<your-subdomain>.workers.dev/mcp
```

## How Temporal Decay Works

Memories have an `importance` score (0.0-1.0) and track `last_accessed_at`. The `recall_memories` tool blends these:

```
relevance = importance * 0.4 + recency_factor * 0.6
recency_factor = e^(-ln(2) / half_life_hours * age_hours)
```

Default half-life is 7 days: a memory accessed 7 days ago has a recency factor of ~0.5. Important memories (high importance) resist decay. Accessing a memory resets its recency.

## Example Usage

Once connected, an LLM can do things like:

```
"Create a namespace called 'work' for my work context"
"Create an entity for the project 'Atlas' of type 'project' with summary 'Internal data platform'"
"Create an entity for 'Sarah' of type 'person' with summary 'Tech lead on Atlas'"
"Create a relation from Sarah to Atlas with type 'leads'"
"Remember that Sarah prefers async communication"
"What do I know about Atlas?" → uses get_context to pull everything
"Traverse the graph from Atlas 2 hops deep" → discovers connected people, tools, etc.
```

## Limits

- **D1**: 10 GB per database, single-threaded (~1000 qps at 1ms/query)
- **Vectorize**: Metadata filtering scoped by namespace
- **Workers AI**: Embedding model `@cf/baai/bge-base-en-v1.5` (768 dimensions)
- **Workers**: Standard request limits apply
