# MCP Tools

[< Back to docs](README.md)

17 tools organized by domain. All tools require authentication via the MCP OAuth flow.

## Connecting

For Claude Desktop, Cursor, OpenCode, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory.flarelylegal.com/mcp"
    }
  }
}
```

Your client opens the Cloudflare Access login page. All data is scoped to your email.
Access is gated by Cloudflare Access — to request a test account, open an issue or reach out.

## Session state

The server tracks active context across tool calls:

- **Current namespace** -- defaults for tools when `namespace_id` is omitted
- **Recent entities** -- last 10 accessed entity IDs
- **Current conversation** -- defaults for `add_message`/`get_messages`

## Tools by domain

### Namespace

| Tool               | Description                                   |
| ------------------ | --------------------------------------------- |
| `manage_namespace` | Create, list, or set visibility on namespaces |

Actions: `create` (requires `name`), `list`, `set_visibility` (admin only, requires `id` + `visibility`).

### Entity

| Tool            | Description                                   |
| --------------- | --------------------------------------------- |
| `manage_entity` | CRUD for graph entities with embedding upsert |
| `find_entities` | Search entities by name/type/keyword          |

`manage_entity` actions: `create`, `get`, `update`, `delete`. Delete prompts for confirmation via elicitation.

### Relation

| Tool              | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `manage_relation` | Create or delete directed relations (with ownership check) |
| `get_relations`   | Query relations from/to an entity                          |

Both source and target entities must belong to the specified namespace. Delete prompts for confirmation.

### Traversal

| Tool             | Description                             |
| ---------------- | --------------------------------------- |
| `traverse_graph` | BFS from an entity up to max_depth hops |

Returns connected entities and their relations up to the specified depth.

### Memory

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `manage_memory`  | Create/update/delete memories with embedding              |
| `query_memories` | Recall (decay-ranked), search (keyword), or entity-linked |

Memory types: `fact`, `observation`, `preference`, `instruction`.

`query_memories` modes:

- **recall** -- ranked by importance + recency (temporal decay)
- **search** -- keyword match via FTS5
- **entity** -- memories linked to a specific entity

### Conversation

| Tool                  | Description                        |
| --------------------- | ---------------------------------- |
| `manage_conversation` | Create or list conversations       |
| `add_message`         | Add a message and embed for search |
| `get_messages`        | Get or search messages             |

Message roles: `user`, `assistant`, `system`, `tool`. User and assistant messages are embedded for semantic search.

### Search

| Tool     | Description                                              |
| -------- | -------------------------------------------------------- |
| `search` | Semantic vector search; context mode enriches with graph |

Modes:

- **search** -- pure vector similarity
- **context** -- vector search + graph traversal from results for richer context

### Admin

| Tool                  | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `reindex_vectors`     | Trigger durable reindex workflow (returns instance ID)          |
| `consolidate_memory`  | Trigger consolidation workflow (decay, dedup, merge, summarize) |
| `get_workflow_status` | Check status of a running workflow instance                     |
| `namespace_stats`     | Entity/memory/relation/conversation counts for a namespace      |
| `claim_namespaces`    | Claim all unowned namespaces for current user                   |

Admin tools require the user's email to be in the `admin:emails` KV allowlist. Destructive operations prompt for confirmation.

## Temporal decay

`query_memories` recall mode ranks by blending importance with recency:

```
relevance = importance * 0.4 + recency * 0.6
recency   = e^(-ln(2) / half_life * age_hours)
```

Default half-life: 7 days. Accessing a memory resets its recency.

## Compact mode

Most read tools support `compact` (default `true`) and `verbose` parameters:

- `compact: true` -- minimal fields (id, name, type)
- `compact: false` -- all fields including metadata, timestamps
- `verbose: true` -- disables text truncation on long fields
