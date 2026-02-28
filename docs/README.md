# Documentation

[README](../README.md) > Documentation

Operational and reference documentation for FlarelyLegal Memory MCP.

## Contents

| Document                                | Description                                                           |
| --------------------------------------- | --------------------------------------------------------------------- |
| [Deployment](deployment.md)             | Setup, resource creation, deploy commands, database migrations        |
| [Configuration](configuration.md)       | Secrets, Cloudflare Access, environment variables, admin role         |
| [Architecture](architecture.md)         | Components, security model, RBAC, infrastructure rationale, data flow |
| [Examples](examples/)                   | JSON examples for RBAC footprint and identity cache                   |
| [MCP Tools](mcp-tools.md)               | All 17 tools with parameters, actions, and usage notes                |
| [REST API](rest-api.md)                 | Authentication, endpoints, response shaping, service tokens           |
| [Observability](observability.md)       | Audit logging, `wrangler tail`, monitoring, R2 archive                |
| [FAQ](faq.md)                           | Frequently asked questions                                            |
| [Contributing](contributing.md)         | Setup, coding standards, branch workflow                              |
| [CI/CD](../.github/workflows/README.md) | GitHub Actions pipeline and automation                                |
| [Testing](../tests/README.md)           | Test structure, commands, unit + E2E suites                           |
| [Migrations](../migrations/README.md)   | D1 schema migrations, commands, adding new migrations                 |

## Quick reference

| Task              | Command                                     |
| ----------------- | ------------------------------------------- |
| Install deps      | `npm install`                               |
| Typecheck         | `npm run typecheck`                         |
| Build (A / B)     | `npm run build` / `npm run build:b`         |
| Lint              | `npm run lint`                              |
| Format            | `npm run format`                            |
| Dev server (A)    | `npm run dev -- --local --port 8787`        |
| Deploy (A / B)    | `npm run deploy` / `npm run deploy:b`       |
| Init local D1     | `npm run db:init:local`                     |
| E2E tests (A / B) | `npm run test:e2e:a` / `npm run test:e2e:b` |

## Dual-account model

This project uses a single repo with two Wrangler configs for demonstration and parity testing:

- `wrangler-a.jsonc` (Account A)
- `wrangler-b.jsonc` (Account B)

Do not split code across multiple repos unless you intentionally want diverging behavior.

## Merge strategy

Use merge commits only (no squash/rebase) to preserve commit granularity for `git-cliff` release notes.

## CI behavior

- Site B E2E runs automatically in CI.
- Site A E2E runs manually via `workflow_dispatch`.
- CI includes a fast preflight (`/health`, `/api/openapi.json`) before full E2E.
