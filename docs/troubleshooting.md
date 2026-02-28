# Troubleshooting

[README](../README.md) > [Docs](README.md) > Troubleshooting

Common issues and their resolutions.

## Invalid or expired token

**Symptom:** API calls return `401 Invalid or expired token` even though Cloudflare Access login succeeds.

**Cause:** The `ACCESS_AUD_TAG` secret on the Worker does not match the audience tag of the Access application that issued the JWT. Access issues the token correctly, but the Worker rejects it because the `aud` claim fails validation.

**Fix:**

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/) and go to **Access > Applications**.
2. Find the self-hosted application protecting your Worker domain.
3. Copy the **Application Audience (AUD) tag** from the application overview page.
4. Update the Worker secret:

```bash
npx wrangler secret put ACCESS_AUD_TAG --config wrangler-b.jsonc
```

5. If you use both a self-hosted and SaaS Access application, `ACCESS_AUD_TAG` accepts comma-separated values. See [Configuration](configuration.md).

**Note:** `ACCESS_AUD_TAG` must match the Access application, not the OAuth Client ID. These are different values.

## Service token not registered

**Symptom:** API calls with `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers return `403 Service token not registered. Bind it to an email first.`

**Cause:** The service token is valid at the Cloudflare Access edge (it passes the Access policy), but the Memory Graph MCP server does not know which user the token belongs to. Every service token must be bound to a user email before it can make authenticated calls.

**Fix:**

1. Log in to the server in your browser (so you have a valid session).
2. Visit the bind UI: `https://<worker>/api/v1/admin/service-tokens/bind`
3. Enter your Client ID and Client Secret, then click **Bind token**.
4. The bind page validates the credentials via a subrequest to Access and links the token to your identity.

Alternatively, bind programmatically:

```bash
curl -X POST https://<worker>/api/v1/admin/service-tokens/bind \
  -H "Cookie: CF_Authorization=<your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "<client-id>", "client_secret": "<client-secret>", "label": "My CI bot"}'
```

See [REST API -- service tokens](rest-api.md#service-tokens) for the full binding flow.

## Does rotating a service token secret require re-binding?

No. Binding is keyed on `common_name`, which equals the Client ID. The Client ID does not change when you rotate the secret in the Zero Trust dashboard. Rotate freely -- no re-bind needed.

## MCP client can't connect (headless/CI)

**Symptom:** A headless agent or CI pipeline needs to use MCP tools, but the MCP endpoint requires an OAuth browser redirect that can't complete without a user present.

**Cause:** The MCP endpoint (`/mcp`) uses the standard MCP OAuth 2.1 flow, which requires an interactive browser login through Cloudflare Access. Service tokens (`CF-Access-Client-Id`/`CF-Access-Client-Secret`) authenticate at the Access edge but do not complete the MCP OAuth handshake.

**Workaround:** Use the [REST API](rest-api.md) instead. The REST API has full MCP-parity for all data operations and authenticates via service tokens without a browser. See [REST API -- service tokens](rest-api.md#service-tokens) for setup.

A dedicated headless MCP transport is a planned feature. See project backlog.

## Empty tables in local development

Run `npm run db:init:local` before starting the dev server. This creates the D1 SQLite tables that the server expects.

## Workers AI / Vectorize not available locally

Workers AI and Vectorize bindings are not emulated by Miniflare. Tools that use embeddings or semantic search will fail gracefully in local mode. D1, KV, R2, and Durable Objects all work locally.

## OAuth flow fails locally

The OAuth login flow (`/authorize` -> `/callback`) requires seven secrets in `.dev.vars`. Copy `.dev.vars.example` and fill in all values. Without them, `/health` and unauthenticated endpoints work, but login does not. See [Configuration](configuration.md).
