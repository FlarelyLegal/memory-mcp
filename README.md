# Memory Graph MCP

[![CI](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-178_passed-2ea44f?logo=vitest)](https://github.com/FlarelyLegal/memory-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/FlarelyLegal/memory-mcp?logo=github&label=release)](https://github.com/FlarelyLegal/memory-mcp/releases/latest)

[![Node.js](https://img.shields.io/badge/Node.js-≥24-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blue)](https://modelcontextprotocol.io)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/FlarelyLegal/memory-mcp?logo=github)](https://github.com/FlarelyLegal/memory-mcp/issues)
[![GitHub Stars](https://img.shields.io/github/stars/FlarelyLegal/memory-mcp?style=flat&logo=github&label=stars)](https://github.com/FlarelyLegal/memory-mcp/stargazers)

Remote MCP server on Cloudflare Workers providing LLMs with persistent structured memory — knowledge graphs, semantic search, and temporally-decayed recall.

## Why FlarelyLegal Memory MCP?

Most MCP memory servers give you a personal scratchpad. Memory Graph MCP is built for **collaborative memory** — shared knowledge graphs that teams and organizations use together with real access control.

- **Works solo** — every user gets their own private namespaces out of the box
- **Works for teams** — grant group or individual access to namespaces with role-based permissions (owner / editor / viewer)
- **Works at the edge** — runs on Cloudflare Workers with D1, Vectorize, and KV, so latency is low everywhere
- **Authenticated by default** — Cloudflare Access handles identity; the server enforces per-namespace RBAC with audit logging on every write
- **Semantic + structural** — vector search finds relevant context, the knowledge graph preserves relationships, and temporal decay surfaces what matters now

This is the MCP memory layer for organizations, not just individuals.

## Architecture

| Component       | Service                | Purpose                                                    |
| --------------- | ---------------------- | ---------------------------------------------------------- |
| MCP sessions    | Durable Objects        | Stateful per-session agent with persistent state           |
| Graph + data    | D1 (SQLite)            | Entities, relations, memories, conversations, audit logs   |
| Semantic search | Vectorize + Workers AI | Embeddings via `@cf/baai/bge-m3` (1024d)                   |
| Auth + config   | KV                     | OAuth state, service token bindings, identity cache, flags |
| Cold archive    | R2                     | Audit log NDJSON archive (Loki-compatible)                 |
| Background jobs | Workflows              | Durable reindex and consolidation pipelines                |

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

17 tools covering namespaces, entities, relations, traversal, memories, conversations, semantic search, and admin workflows. See [MCP Tools](docs/mcp-tools.md) for the full list with parameters and usage.

## REST API

Full REST API is documented with OpenAPI 3.1 and Scalar. It covers MCP-parity endpoints plus REST-only RBAC/user-management routes.

- **Interactive docs:** [memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)
- **OpenAPI spec:** `GET /api/openapi.json`

See [REST API](docs/rest-api.md) for authentication, endpoints, and response shaping.

## Documentation

Full docs at [docs/](docs/README.md) — deployment, configuration, architecture, MCP tools, REST API, observability, [FAQ](docs/faq.md), and [contributing](docs/contributing.md).

## Roadmap

Active and planned work:

- [ ] **Groups + RBAC** _(in progress)_ — team-based namespace sharing with role-based access control (owner / editor / viewer), group management, and coalesced identity caching
- [ ] **D1 migration system** _(in progress)_ — `wrangler d1 migrations` for schema versioning
- [ ] **Rate limiting** — `RATE_LIMIT_AUTH` and `RATE_LIMIT_SEARCH` bindings exist in types but are not wired up
- [ ] **DPoP-bound delegated tokens** — proof-of-possession tokens for third-party integrations
- [ ] **Field-level encryption** — entity content, memory text, and conversation messages are plaintext in D1 (Cloudflare encrypts at rest at the storage layer, but dashboard/D1 console access exposes data)
- [ ] **Audit query MCP tool + REST API routes** — `queryAuditLogs` exists in code but has no MCP tool or REST endpoint yet
