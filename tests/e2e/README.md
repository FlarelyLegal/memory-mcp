# E2E API Tests

[< Back to main README](../../README.md) | [Docs](../../docs/README.md) | [REST API](../../docs/rest-api.md)

Playwright API tests for the live REST API. These run against deployed workers, not local dev.

## What these tests cover

- Public endpoints (`/health`, `/api/openapi.json`)
- Authenticated CRUD flows (entities, relations, memories, conversations, messages)
- Graph traversal and error handling paths

## Auth setup

Tests authenticate via **Cloudflare Access service tokens**. The service token must be:

1. Created in the Cloudflare Access dashboard
2. Bound to an email via the `POST /api/v1/admin/service-tokens/bind-request` + `bind-self` flow
3. The KV mapping must use the versioned format: `{"v":"1.0","email":"...","label":"...","created_at":...}`

The `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers are sent on every request.

## Required env vars

| Variable                  | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `CF_ACCESS_CLIENT_ID`     | Service token client ID (shared fallback)               |
| `CF_ACCESS_CLIENT_SECRET` | Service token client secret (shared fallback)           |
| `API_BASE_URL`            | Worker URL (default: `https://memory.schenanigans.com`) |

Per-target overrides (used by CI):

| Variable                                                               | Description |
| ---------------------------------------------------------------------- | ----------- |
| `CF_ACCESS_CLIENT_ID_A`, `CF_ACCESS_CLIENT_SECRET_A`, `API_BASE_URL_A` | Account A   |
| `CF_ACCESS_CLIENT_ID_B`, `CF_ACCESS_CLIENT_SECRET_B`, `API_BASE_URL_B` | Account B   |

## Namespace

Tests default to namespace `demo` (override with `TEST_NAMESPACE_NAME`). The suite resolves this namespace by name at startup and creates it if missing.

## Cleanup

- Test-created entities, relations, and memories are deleted in `afterAll`
- Conversations and messages are left in place (small, non-destructive)

## Run locally

```bash
# Default (account A)
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e

# Explicit target
API_TARGET=a npm run test:e2e:a
API_TARGET=b npm run test:e2e:b

# Custom base URL
API_BASE_URL="https://your-worker.example.com" CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e
```

## CI

E2E tests run automatically on push to `main` via `.github/workflows/e2e.yml`. Secrets are configured in the repo's GitHub Actions environment.
