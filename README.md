# Memory Graph MCP

[![CI](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/FlarelyLegal/memory-mcp?logo=github&label=release)](https://github.com/FlarelyLegal/memory-mcp/releases/latest)

[![Node.js](https://img.shields.io/badge/Node.js-≥24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blue)](https://modelcontextprotocol.io)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/FlarelyLegal/memory-mcp?logo=github)](https://github.com/FlarelyLegal/memory-mcp/issues)
[![GitHub Stars](https://img.shields.io/github/stars/FlarelyLegal/memory-mcp?style=flat&logo=github&label=stars)](https://github.com/FlarelyLegal/memory-mcp/stargazers)

Remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory — knowledge graphs, semantic search, and temporally-decayed recall.

## Architecture

| Component       | Service                | Purpose                                                  |
| --------------- | ---------------------- | -------------------------------------------------------- |
| MCP sessions    | Durable Objects        | Stateful per-session agent with persistent state         |
| Graph + data    | D1 (SQLite)            | Entities, relations, memories, conversations, audit logs |
| Semantic search | Vectorize + Workers AI | Embeddings via `@cf/baai/bge-m3` (1024d)                 |
| Auth + config   | KV                     | OAuth state, service token bindings, admin allowlist     |
| Cold archive    | R2                     | Audit log NDJSON archive (Loki-compatible)               |
| Background jobs | Workflows              | Durable reindex and consolidation pipelines              |

## Public demo

A live instance is running at **[memory.flarelylegal.com](https://memory.flarelylegal.com)** with the server modeled as its own knowledge graph.

- **API docs:** [memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)
- **Demo snapshot** (no auth required):

```bash
curl -s https://memory.flarelylegal.com/api/demo | jq
```

## Quick start

```bash
npm install
npm run db:init:local
npm run dev -- --local --port 8787
```

See [Deployment](docs/deployment.md) for full setup with Cloudflare resources.

## Connect an MCP client

```json
{
  "mcpServers": {
    "memory-graph": {
      "url": "https://memory.flarelylegal.com/mcp"
    }
  }
}
```

Works with Claude Desktop, Cursor, OpenCode, or any MCP-compatible client.
Access is gated by Cloudflare Access — to request a test account, open an issue or reach out.

## MCP Tools (17)

| Tool                  | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `manage_namespace`    | Create, list, or set visibility on namespaces             |
| `manage_entity`       | CRUD for graph entities with embedding upsert             |
| `find_entities`       | Search entities by name/type/keyword                      |
| `manage_relation`     | Create or delete directed relations                       |
| `get_relations`       | Query relations from/to an entity                         |
| `traverse_graph`      | BFS graph traversal up to max_depth hops                  |
| `manage_memory`       | Create/update/delete memories with embedding              |
| `query_memories`      | Recall (decay-ranked), search (keyword), or entity-linked |
| `manage_conversation` | Create or list conversations                              |
| `add_message`         | Add a message and embed for search                        |
| `get_messages`        | Get or search messages                                    |
| `search`              | Semantic vector search; context mode enriches with graph  |
| `reindex_vectors`     | Trigger durable reindex workflow                          |
| `consolidate_memory`  | Trigger consolidation workflow (decay, dedup, summarize)  |
| `get_workflow_status` | Check status of a running workflow instance               |
| `namespace_stats`     | Aggregate counts for a namespace                          |
| `claim_namespaces`    | Claim all unowned namespaces for current user             |

See [MCP Tools](docs/mcp-tools.md) for parameters and usage details.

## REST API

Full REST API mirrors the MCP tools with OpenAPI 3.1 spec.

- **Interactive docs:** [https://memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)
- **OpenAPI spec:** `GET /api/openapi.json`

See [REST API](docs/rest-api.md) for authentication, endpoints, and response shaping.

## Documentation

| Document                                       | Description                                  |
| ---------------------------------------------- | -------------------------------------------- |
| [docs/](docs/README.md)                        | Documentation index                          |
| [docs/deployment.md](docs/deployment.md)       | Setup, resource creation, deploy, migrations |
| [docs/configuration.md](docs/configuration.md) | Secrets, Cloudflare Access, admin role       |
| [docs/architecture.md](docs/architecture.md)   | Components, file structure, data flow        |
| [docs/mcp-tools.md](docs/mcp-tools.md)         | All 17 tools with parameters and usage       |
| [docs/rest-api.md](docs/rest-api.md)           | Authentication, endpoints, service tokens    |
| [docs/observability.md](docs/observability.md) | Audit logging, wrangler tail, monitoring     |
| [tests/e2e/](tests/e2e/README.md)              | E2E test suite                               |

## Testing

```bash
npm run typecheck
npm run lint
npm run build
npm run test:e2e:a    # site A
npm run test:e2e:b    # site B
```

See [Testing](tests/e2e/README.md) for details on targets, secrets, and running locally.

## Roadmap

Security and feature items not yet implemented:

- [ ] **Rate limiting** — `RATE_LIMIT_AUTH` and `RATE_LIMIT_SEARCH` bindings exist in types but are not wired up
- [ ] **Field-level encryption** — entity content, memory text, and conversation messages are plaintext in D1 (Cloudflare encrypts at rest at the storage layer, but dashboard/D1 console access exposes data)
- [ ] **Namespace groups** — shared access across multiple users within a namespace (currently single-owner only)
- [ ] **CORS origin KV setup** — `cors:origins` KV key must be populated per deployment for cross-origin browser clients (same-origin works by default)
- [ ] **Health check config validation** — `/health` could verify KV keys (`admin:emails`, `cors:origins`) and report misconfiguration
- [ ] **Audit query MCP tool + REST API routes** — `queryAuditLogs` exists in code but has no MCP tool or REST endpoint yet
