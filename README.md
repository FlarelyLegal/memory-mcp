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

Remote MCP server on Cloudflare Workers providing LLMs with persistent shared memory: knowledge graphs, semantic search, RBAC namespace sharing, and temporally-decayed recall.

## Why Memory Graph MCP?

Memory Graph MCP is the open-source MCP server built for shared memory across teams. Every user gets private namespaces by default, and any namespace can be shared with individuals or groups through role-based access control.

### Collaborative by design

- Namespace-level RBAC with three roles: owner, editor, viewer
- Group-based sharing: create a group, add members, grant the group access to namespaces
- Private by default with opt-in public visibility for read-only community namespaces
- Per-write audit logging on every mutation to D1 (90 days queryable) and R2 NDJSON archive (indefinite retention, S3-compatible for ingestion by Loki, Splunk, Datadog, Elastic, or any S3-aware log aggregator)

### Secure by default

- Cloudflare Access handles identity through a full OAuth/OIDC flow
- JWT verification on every request: RSA signature validation, expiry checks, audience tag enforcement
- Security headers on all responses: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- CSRF protection via Origin/Referer/Sec-Fetch-Site validation in middleware
- Service token support with identity binding for CI/CD and automation
- Encryption at rest at the Cloudflare storage layer

### Fast at the edge

- Runs on Cloudflare Workers globally, not a centralized server
- D1 read replication: read-heavy workloads hit the nearest replica
- Vectorize ANN search: semantic queries without provisioning a separate vector database
- KV identity cache with 30-second security-first TTL for fast auth with fast revocation
- All AI inference routed through AI Gateway for observability and caching

## What you get

| Capability                 | How it works                                                                   | Why it matters                                            |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Shared memory + RBAC**   | Namespaces with owner/editor/viewer grants for users and groups                | Teams share knowledge without giving up control           |
| **Identity + auth**        | Cloudflare Access (OAuth/OIDC), JWT verification, service tokens               | Every request is authenticated and authorized             |
| **Edge deployment**        | Cloudflare Workers, D1 read replication, KV identity cache                     | Low latency globally, no centralized bottleneck           |
| **Knowledge graph**        | Typed entities, weighted directed relations, BFS traversal                     | Structured context the LLM can reason over                |
| **Semantic search**        | Vectorize ANN + Workers AI embeddings (`@cf/baai/bge-m3`, 1024d)               | Find relevant context by meaning, not just keywords       |
| **Temporal decay**         | Importance-weighted recall with time-based decay scoring                       | Recent and important memories surface first               |
| **Audit trail**            | D1 hot window (90 days) + R2 NDJSON archive (S3-compatible, indefinite)        | Full write history, ready for Loki/Splunk/Datadog/Elastic |
| **Durable workflows**      | Cloudflare Workflows with step-level retry for consolidation + reindex         | Background maintenance that survives failures             |
| **REST API + OpenAPI 3.1** | Full MCP-parity REST API plus REST-only RBAC admin routes, Scalar docs UI      | Integrate from any HTTP client, not just MCP              |
| **Elicitation safety**     | Destructive operations prompt for human confirmation with graceful degradation | Prevents accidental deletes in interactive sessions       |

## Architecture

| Component       | Service                | Purpose                                                    |
| --------------- | ---------------------- | ---------------------------------------------------------- |
| MCP sessions    | Durable Objects        | Stateful per-session agent with persistent state           |
| Graph + data    | D1 (SQLite)            | Entities, relations, memories, conversations, audit logs   |
| Semantic search | Vectorize + Workers AI | Embeddings via `@cf/baai/bge-m3` (1024d)                   |
| Auth + identity | KV                     | OAuth state, service token bindings, identity cache, flags |
| Audit archive   | R2                     | S3-compatible NDJSON audit archive (indefinite retention)  |
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

> [!NOTE]
> Access is gated by Cloudflare Access. To request a test account, open an issue or reach out.

## MCP Tools (17)

17 tools covering namespaces, entities, relations, traversal, memories, conversations, semantic search, and admin workflows. See [MCP Tools](docs/mcp-tools.md) for the full list with parameters and usage.

## REST API

Full REST API alongside MCP tools, documented with an auto-generated OpenAPI 3.1 spec and Scalar docs UI. Covers all MCP-parity endpoints plus REST-only routes for RBAC administration (groups, group members, namespace grants, service tokens).

- **Interactive docs:** [memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)
- **OpenAPI spec:** `GET /api/openapi.json`

See [REST API](docs/rest-api.md) for authentication, endpoints, and response shaping.

## Documentation

Full docs at [docs/](docs/README.md): deployment, configuration, architecture, MCP tools, REST API, observability, [FAQ](docs/faq.md), and [contributing](docs/contributing.md).
