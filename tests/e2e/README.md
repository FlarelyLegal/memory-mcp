# E2E API Tests

This folder contains Playwright API tests for the live REST API.

## What These Tests Cover

- Public endpoints (`/health`, `/api/openapi.json`)
- Authenticated CRUD flows (entities, relations, memories, conversations, messages)
- Graph traversal and error handling paths

## Target Environment

By default, tests run against the deployed API:

- `https://memory.schenanigans.com`

To run against a different environment, set `API_BASE_URL`.

## Required Secrets

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

These are sent as Access service-token headers for authenticated requests.

## Namespace Requirement

Tests expect a namespace named `Playwright Testing` to exist.

The suite resolves this namespace by name at startup and runs all test data inside it.

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
```
