# Tests

[< Back to main README](../README.md) | [Docs](../docs/README.md) | [Contributing](../docs/contributing.md)

## Structure

| Directory | Framework  | What it covers                                          |
| --------- | ---------- | ------------------------------------------------------- |
| `unit/`   | Vitest     | Core logic, KV encoding, RBAC, schemas, MCP/REST parity |
| `e2e/`    | Playwright | Live API CRUD flows and browser page tests              |

## Quick commands

| Task                    | Command                  | Notes                                       |
| ----------------------- | ------------------------ | ------------------------------------------- |
| Unit tests (single run) | `npm test`               | No network or Workers runtime needed        |
| Unit tests (watch mode) | `npm run test:watch`     |                                             |
| E2E API tests           | `npm run test:e2e`       | Needs `CF_ACCESS_CLIENT_ID/SECRET` env vars |
| E2E browser tests       | `npm run test:e2e:pages` | Needs Chromium (`npx playwright install`)   |
| E2E all                 | `npm run test:e2e:all`   | API + browser                               |
| Target site A           | `npm run test:e2e:a`     |                                             |
| Target site B           | `npm run test:e2e:b`     |                                             |

## Unit tests

18 test files covering KV encoding, identity resolution, RBAC access checks, session state, response formatting, schema validation, API helpers, and MCP/REST parity. All external dependencies (D1, KV, Workers AI) are mocked -- no network needed.

The **parity test** (`unit/parity.test.ts`) is the structural safety net: it maintains a manifest mapping every MCP tool action to its REST API counterpart and fails if a route or tool is added without updating the manifest.

See [unit/README.md](unit/README.md) for the full file-by-file breakdown.

## E2E tests

Playwright tests against the live deployed workers. Two projects:

- **`api`** -- API-only tests (no browser) for REST endpoint CRUD flows
- **`browser`** -- Chromium browser tests for HTML pages (landing page, bind UI) with screenshots

Auth is via Cloudflare Access service tokens passed as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers.

See [e2e/README.md](e2e/README.md) for auth setup, env vars, cleanup, and CI details.

## Conventions

- Test emails use `@memory.flarelylegal.com` domain
- 250-line cap per test file
- New source files should have corresponding test coverage
