# Unit Tests

[< Back to main README](../../README.md) | [Docs](../../docs/README.md)

Vitest unit tests for core logic. These run without network, Workers runtime, or D1 -- all external dependencies are mocked.

## Run

```bash
npm run test          # single run
npm run test:watch    # watch mode
```

## Test files

| File                        | What it covers                                                           |
| --------------------------- | ------------------------------------------------------------------------ |
| `identity.test.ts`          | Identity loading, KV cache hit/miss, access level helpers, cache busting |
| `auth-rbac.test.ts`         | Namespace read/write/owner access assertions, public visibility          |
| `kv-admin.test.ts`          | `FLAGS` admin:emails encode/decode                                       |
| `kv-identity.test.ts`       | `USERS` identity cache encode/decode                                     |
| `kv-service-token.test.ts`  | `CACHE` service token mapping encode/decode                              |
| `kv-bind-challenge.test.ts` | `CACHE` bind challenge encode/decode                                     |
| `bind-ui.test.ts`           | Bind UI HTML renderer and landing page renderer                          |
| `utils.test.ts`             | ID generation, decay scoring, JSON parsing, FTS helpers                  |
| `state.test.ts`             | Session state tracking (namespace, entity, conversation)                 |
| `response-helpers.test.ts`  | MCP response formatting, tool handler wrappers                           |
| `fields.test.ts`            | API field filtering and selection                                        |
| `row-parsers.test.ts`       | D1 row to domain object parsing                                          |
| `api-schemas.test.ts`       | OpenAPI schema generation from Zod                                       |
| `schema-fields.test.ts`     | Tool schema field definitions and constraints                            |
| `schema-validators.test.ts` | Zod input validation for MCP tools                                       |
| `graph-grants.test.ts`      | Namespace grant CRUD (D1 mocked)                                         |
| `graph-groups.test.ts`      | Group CRUD and slug generation (D1 mocked)                               |
| `parity.test.ts`            | MCP tool / REST API parity checks                                        |

## Conventions

- Test emails use `@memory.flarelylegal.com` domain
- D1 and KV are mocked via plain objects (no Workers runtime needed)
- One file per domain, 250-line cap per file
- New source files should have corresponding test coverage
