# HOWTO

Operational notes for this repository.

## Demonstration Deployment Model

This project uses a single repo with two Wrangler configs for demonstration and parity testing:

- `wrangler-a.jsonc` (site/account A)
- `wrangler-b.jsonc` (site/account B)

Do not split code across multiple repos unless you intentionally want diverging behavior.

## Access Policy Scope (Required)

For the self-hosted Access app:

- Protect only `/api/v1`
- Keep `/api/docs` and `/api/openapi.json` public
- Include a Service Auth policy with `decision=non_identity`

This keeps interactive docs/spec reachable while enforcing auth for API operations.

## Cloudflare Workers Builds Parity

Set explicit commands per account in Cloudflare dashboard.

| Account | Build command     | Deploy command                                           | Version command                                          |
| ------- | ----------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| A       | `npm run build`   | `npx wrangler versions upload --config wrangler-a.jsonc` | `npx wrangler versions upload --config wrangler-a.jsonc` |
| B       | `npm run build:b` | `npx wrangler versions upload --config wrangler-b.jsonc` | `npx wrangler versions upload --config wrangler-b.jsonc` |

Using the wrong config causes cross-account binding failures (KV/D1/Vectorize IDs not found).

## GitHub Secrets Matrix

| Secret                      | Purpose                           | Target                           |
| --------------------------- | --------------------------------- | -------------------------------- |
| `API_BASE_URL_A`            | E2E base URL for A                | manual workflow (`e2e-a-manual`) |
| `CF_ACCESS_CLIENT_ID_A`     | Access service token ID for A     | manual workflow (`e2e-a-manual`) |
| `CF_ACCESS_CLIENT_SECRET_A` | Access service token secret for A | manual workflow (`e2e-a-manual`) |
| `API_BASE_URL_B`            | E2E base URL for B                | CI auto workflow (`e2e`)         |
| `CF_ACCESS_CLIENT_ID_B`     | Access service token ID for B     | CI auto workflow (`e2e`)         |
| `CF_ACCESS_CLIENT_SECRET_B` | Access service token secret for B | CI auto workflow (`e2e`)         |

## CI Behavior

- Site B E2E runs automatically in CI.
- Site A E2E runs manually via `workflow_dispatch`.
- CI includes a fast preflight (`/health`, `/api/openapi.json`) before full E2E.

## Rate-Limit Bindings

Optional bindings supported by the Worker:

- `RATE_LIMIT_AUTH`: auth-sensitive endpoints (`bind-request`, `bind-self`)
- `RATE_LIMIT_SEARCH`: search-heavy endpoints

Recommended starting limits:

- `RATE_LIMIT_AUTH`: ~10 requests/min per identity
- `RATE_LIMIT_SEARCH`: ~60 requests/min per identity

Tune by observing 429 rate and user impact.

## JWT/JWKS Cache Behavior

JWT verification supports multiple JWKS URLs and audiences.

- In-memory JWKS cache TTL: 5 minutes
- Verification path: cached lookup first, then one forced refresh on `kid` miss
- Fallback helps key rotation without immediate auth breakage

## Audit Logging and Retention

Audit events are written (best effort) to R2 under `audit/YYYY-MM-DD/...`.

Current logged actions include:

- `service_token_bind_request_created`
- `service_token_bind_request_conflict`
- `service_token_bind_self_denied` (with reason)
- `service_token_bind_self_conflict`
- `service_token_bound`

Recommended lifecycle policy in R2:

- Keep 90 days for production
- Keep 30 days for non-production

## Database Migrations (Existing Deployments)

Fresh installs via `db:init` include everything. For existing databases, run these migrations in order:

| Migration                   | Script (A / B / local)                                  | When                                |
| --------------------------- | ------------------------------------------------------- | ----------------------------------- |
| FTS5 tables + triggers      | `db:migrate:fts` / `fts:b` / `fts:local`                | After upgrading to FTS5 search      |
| Optimize indexes + triggers | `db:migrate:optimize` / `optimize:b` / `optimize:local` | After upgrading to optimized schema |

Migrations are idempotent (`IF NOT EXISTS`, `DROP IF EXISTS`).

## Vectorize Metadata Indexes

Run once per Vectorize index to enable server-side filtered ANN search:

```sh
npm run vectorize:indexes    # account A
npm run vectorize:indexes:b  # account B
```

Creates indexes on `namespace_id`, `kind`, and `type`. Without these, metadata filters silently return empty results.

## Merge Strategy

Use merge commits only (no squash/rebase) to preserve commit granularity for `git-cliff` release notes.
