# E2E API Tests

[< Back to main README](../../README.md) | [Docs](../../docs/README.md) | [REST API](../../docs/rest-api.md)

Playwright API tests for the live REST API.

## What These Tests Cover

- Public endpoints (`/health`, `/api/openapi.json`)
- Authenticated CRUD flows (entities, relations, memories, conversations, messages)
- Graph traversal and error handling paths

## Target Environment

By default, tests run against target `a`.

You can run target `a` or `b` with `API_TARGET` and per-target env vars.

## Required Secrets

- Shared mode:
  - `CF_ACCESS_CLIENT_ID`
  - `CF_ACCESS_CLIENT_SECRET`
- Targeted mode:
  - `CF_ACCESS_CLIENT_ID_A`, `CF_ACCESS_CLIENT_SECRET_A`, `API_BASE_URL_A`
  - `CF_ACCESS_CLIENT_ID_B`, `CF_ACCESS_CLIENT_SECRET_B`, `API_BASE_URL_B`

These are sent as Access service-token headers for authenticated requests.

## Namespace Requirement

Tests default to namespace `demo` (override with `TEST_NAMESPACE_NAME`).

The suite resolves this namespace by name at startup and creates it if missing.

## Data Safety / Cleanup

- Test-created entities, relations, and memories are deleted in `afterAll`
- Conversations/messages are currently left in place (small, non-destructive test data)

## Run Locally

```bash
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e
```

Optional:

```bash
API_BASE_URL="https://<your-worker-domain>" CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e

# Target A
API_TARGET=a API_BASE_URL_A="https://<account-a-worker-domain>" CF_ACCESS_CLIENT_ID_A="..." CF_ACCESS_CLIENT_SECRET_A="..." npm run test:e2e:a

# Target B
API_TARGET=b API_BASE_URL_B="https://<account-b-worker-domain>" CF_ACCESS_CLIENT_ID_B="..." CF_ACCESS_CLIENT_SECRET_B="..." npm run test:e2e:b
```
