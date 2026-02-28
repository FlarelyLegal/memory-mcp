# E2E Tests

[README](../../README.md) > [Tests](../README.md) > E2E Tests

Playwright tests for the live deployed workers. Two projects:

| Project   | Spec file       | Description                                              |
| --------- | --------------- | -------------------------------------------------------- |
| `api`     | `api.spec.ts`   | API-only tests (no browser) for REST endpoint CRUD flows |
| `browser` | `pages.spec.ts` | Chromium browser tests for HTML pages with screenshots   |

## What these tests cover

### API tests (`api.spec.ts`)

- Public endpoints (`/health`, `/api/openapi.json`)
- Authenticated CRUD flows (entities, relations, memories, conversations, messages)
- Graph traversal and error handling paths

### Browser tests (`pages.spec.ts`)

- Landing page (`GET /`): title, health status pill, about section, quick links
- Service token bind UI (`GET /api/v1/admin/service-tokens/bind`): form fields, signed-in email, token list loading, client-side validation
- Screenshots saved to `tests/e2e/screenshots/` (gitignored)

## Auth setup

Tests authenticate via **Cloudflare Access service tokens**. The service token must be:

1. Created in the Cloudflare Access dashboard
2. Bound to an email via `POST /api/v1/admin/service-tokens/bind` (combined endpoint) or the two-step `bind-request` + `bind-self` flow
3. The KV mapping must use the versioned format: `{"v":"1.0","email":"...","label":"...","created_at":...}`

The `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers are sent on every request. For browser tests, these headers pass through Cloudflare Access at the edge, allowing the browser to reach authenticated pages without an interactive login.

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
- Screenshots are overwritten on each run

## Run locally

```bash
# API tests only (default)
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e

# Browser tests only (takes screenshots)
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e:pages

# All tests (API + browser)
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." npm run test:e2e:all

# Explicit target
API_TARGET=b npm run test:e2e:b
API_TARGET=b npm run test:e2e:pages:b
```

## CI

E2E API tests run automatically on push to `main` via `.github/workflows/e2e.yml`. Browser tests can be run manually or added to CI when screenshot baselines are desired.
