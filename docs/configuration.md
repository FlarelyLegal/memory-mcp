# Configuration

[< Docs](README.md) | [Deployment](deployment.md) | [Architecture >](architecture.md)

## Secrets

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in values.

For production, set each secret on the Worker. Run for both configs:

```bash
npx wrangler secret put ACCESS_CLIENT_ID --config wrangler-a.jsonc
npx wrangler secret put ACCESS_CLIENT_SECRET --config wrangler-a.jsonc
npx wrangler secret put ACCESS_TOKEN_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_AUTHORIZATION_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_JWKS_URL --config wrangler-a.jsonc
npx wrangler secret put ACCESS_ISSUER --config wrangler-a.jsonc   # optional
npx wrangler secret put ACCESS_AUD_TAG --config wrangler-a.jsonc
npx wrangler secret put COOKIE_ENCRYPTION_KEY --config wrangler-a.jsonc
```

`ACCESS_JWKS_URL` and `ACCESS_AUD_TAG` can be comma-separated when using both self-hosted and SaaS Access apps.

`ACCESS_AUD_TAG` must match the Access applications that issue your JWTs. Mismatched audience tags cause `Invalid or expired token` errors.

## Cloudflare Access setup

You need two Access applications:

### Self-hosted application (REST API auth)

1. In [Zero Trust dashboard](https://dash.cloudflare.com/one/), go to **Access > Applications**
2. Create a **Self-hosted** application for your Workers domain
3. Add an **Allow** policy for your identity provider
4. If using service tokens, add a **Service Auth** policy (`non_identity`, include `any_valid_service_token` or specific token)

**Path scope:** Protect only `/api/v1`. Keep `/api/docs` and `/api/openapi.json` outside Access so API docs stay public.

| Value                          | Where to find it                                           | Used as           |
| ------------------------------ | ---------------------------------------------------------- | ----------------- |
| Application Audience (AUD) tag | Application overview page                                  | `ACCESS_AUD_TAG`  |
| JWKS URL                       | `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` | `ACCESS_JWKS_URL` |

### SaaS application (MCP OAuth flow)

| Value             | Where to find it          | Used as                    |
| ----------------- | ------------------------- | -------------------------- |
| Client ID         | SaaS app > OIDC settings  | `ACCESS_CLIENT_ID`         |
| Client Secret     | SaaS app > OIDC settings  | `ACCESS_CLIENT_SECRET`     |
| Token URL         | SaaS app > OIDC endpoints | `ACCESS_TOKEN_URL`         |
| Authorization URL | SaaS app > OIDC endpoints | `ACCESS_AUTHORIZATION_URL` |
| JWKS URL          | SaaS app > OIDC endpoints | `ACCESS_JWKS_URL` (append) |

## Admin role

Admin-only operations are gated by a KV allowlist.

**KV key:** `admin:emails` in the `CACHE` namespace
**Value:** comma-separated emails, e.g. `alice@example.com,bob@example.com`

```bash
npx wrangler kv key put "admin:emails" "alice@example.com,bob@example.com" \
  --namespace-id <CACHE_KV_NAMESPACE_ID> --remote
```

No redeploy needed — changes take effect immediately. If the key is missing, all admin operations are denied (fail-closed).

**Guarded operations:**

- MCP: `reindex_vectors`, `consolidate_memory`, `claim_namespaces`
- REST: `POST /api/v1/admin/reindex`, `POST /api/v1/admin/consolidate`, `POST /api/v1/admin/claim-namespaces`

**Not guarded** (all authenticated users can manage their own tokens):

- `POST /api/v1/admin/service-tokens/bind-request`
- `POST /api/v1/admin/service-tokens/bind-self`
- `GET/PATCH/DELETE /api/v1/admin/service-tokens/*`

## Rate limiting

Optional bindings supported by the Worker:

| Binding             | Scope                                              | Recommended limit        |
| ------------------- | -------------------------------------------------- | ------------------------ |
| `RATE_LIMIT_AUTH`   | Auth-sensitive endpoints (bind-request, bind-self) | ~10 req/min per identity |
| `RATE_LIMIT_SEARCH` | Search-heavy endpoints                             | ~60 req/min per identity |

Tune by observing 429 rate and user impact.

## JWT/JWKS cache

- In-memory JWKS cache TTL: 5 minutes
- Verification path: cached lookup first, then one forced refresh on `kid` miss
- Fallback helps key rotation without immediate auth breakage

## GitHub secrets

| Secret                      | Purpose                           | Target                  |
| --------------------------- | --------------------------------- | ----------------------- |
| `API_BASE_URL_A`            | E2E base URL for A                | `e2e-a-manual` workflow |
| `CF_ACCESS_CLIENT_ID_A`     | Access service token ID for A     | `e2e-a-manual` workflow |
| `CF_ACCESS_CLIENT_SECRET_A` | Access service token secret for A | `e2e-a-manual` workflow |
| `API_BASE_URL_B`            | E2E base URL for B                | CI `e2e` workflow       |
| `CF_ACCESS_CLIENT_ID_B`     | Access service token ID for B     | CI `e2e` workflow       |
| `CF_ACCESS_CLIENT_SECRET_B` | Access service token secret for B | CI `e2e` workflow       |
