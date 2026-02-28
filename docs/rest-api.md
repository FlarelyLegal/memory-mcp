# REST API

[< Back to docs](README.md)

## Live docs

- **OpenAPI spec:** `GET /api/openapi.json`
- **Interactive docs:** `GET /api/docs` (Scalar UI)
- Live: [https://memory.flarelylegal.com/api/docs](https://memory.flarelylegal.com/api/docs)

Both endpoints are unauthenticated.

## Public endpoints (no auth)

| Endpoint                | Response                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `GET /`                 | HTML landing page (health status, about, quick links)         |
| `GET /health`           | `{"status":"ok","server":"memory-graph-mcp","version":"..."}` |
| `GET /api/docs`         | Scalar API reference UI                                       |
| `GET /api/openapi.json` | OpenAPI 3.1 spec                                              |
| `GET /api/demo`         | Full demo namespace graph snapshot                            |

## Authentication

API endpoints at `/api/v1/*` authenticate via JWT from Cloudflare Access.

The middleware checks in order:

1. `Cf-Access-Jwt-Assertion` header
2. `cf-access-token` header
3. `CF_Authorization` cookie

### Interactive (browser)

Visit the Worker URL in a browser. Cloudflare Access handles the login flow and sets the `CF_Authorization` cookie automatically.

### Service tokens

Service tokens let CI pipelines, scripts, and headless agents authenticate without a browser OAuth flow. Cloudflare Access issues the token, but the server needs to know which user it belongs to -- binding links the token's `common_name` (Client ID) to your email so writes are attributed correctly and RBAC is enforced.

1. **Create a service token** in the Zero Trust dashboard (Access > Service Auth > Service Tokens) _(admin)_
2. **Add a Service Auth policy** to your Access application _(admin)_
3. **Bind the token to your identity** _(any authenticated user)_:

**Browser (recommended):** Visit `https://<worker>/api/v1/admin/service-tokens/bind`, enter your Client ID and Secret, click "Bind token".

#### Programmatic binding {#programmatic-service-tokens}

**curl (combined endpoint):**

```bash
curl -X POST https://<worker>/api/v1/admin/service-tokens/bind \
  -H "Cookie: CF_Authorization=<your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "<client-id>", "client_secret": "<client-secret>", "label": "My CI bot"}'
```

<details>
<summary>Two-step challenge flow (legacy)</summary>

```bash
# Step 1: Human creates bind challenge (browser-authenticated)
curl -X POST https://<worker>/api/v1/admin/service-tokens/bind-request \
  -H "Cookie: CF_Authorization=<your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"common_name": "<client-id>", "label": "My CI bot"}'

# Step 2: Service token completes bind (proof of possession)
curl -X POST https://<worker>/api/v1/admin/service-tokens/bind-self \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>" \
  -H "Content-Type: application/json" \
  -d '{"challenge_id": "<challenge-id>"}'
```

</details>

4. **Make API calls:**

```bash
curl https://<worker>/api/v1/namespaces \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>"
```

### Service token management

| Action                | Method   | Endpoint                                    |
| --------------------- | -------- | ------------------------------------------- |
| Bind UI (browser)     | `GET`    | `/api/v1/admin/service-tokens/bind`         |
| Bind (combined)       | `POST`   | `/api/v1/admin/service-tokens/bind`         |
| Create bind challenge | `POST`   | `/api/v1/admin/service-tokens/bind-request` |
| Complete self-bind    | `POST`   | `/api/v1/admin/service-tokens/bind-self`    |
| List your tokens      | `GET`    | `/api/v1/admin/service-tokens`              |
| Get binding           | `GET`    | `/api/v1/admin/service-tokens/:common_name` |
| Update label          | `PATCH`  | `/api/v1/admin/service-tokens/:common_name` |
| Revoke                | `DELETE` | `/api/v1/admin/service-tokens/:common_name` |

`common_name` (= Client ID) survives token rotation -- no re-bind needed after rotating the secret.

## Response shaping

- Most list/search endpoints support `fields=` for projection
- `fields=compact` and `fields=full` presets available
- Cursor pagination via `X-Next-Cursor` response header; pass as `cursor=` on next request
- `X-D1-Bookmark` header for cross-request read consistency

## CORS

All `/api/*` responses include `Access-Control-Allow-Origin: *`.

## Endpoint summary

### Namespaces

| Method  | Endpoint                 | Description                    |
| ------- | ------------------------ | ------------------------------ |
| `GET`   | `/api/v1/namespaces`     | List namespaces (own + public) |
| `POST`  | `/api/v1/namespaces`     | Create namespace               |
| `PATCH` | `/api/v1/namespaces/:id` | Set visibility (admin only)    |

### Entities

| Method   | Endpoint                          | Description          |
| -------- | --------------------------------- | -------------------- |
| `GET`    | `/api/v1/namespaces/:ns/entities` | List/search entities |
| `POST`   | `/api/v1/namespaces/:ns/entities` | Create entity        |
| `GET`    | `/api/v1/entities/:id`            | Get entity           |
| `PUT`    | `/api/v1/entities/:id`            | Update entity        |
| `DELETE` | `/api/v1/entities/:id`            | Delete entity        |

### Relations

| Method   | Endpoint                           | Description                  |
| -------- | ---------------------------------- | ---------------------------- |
| `POST`   | `/api/v1/namespaces/:ns/relations` | Create relation              |
| `GET`    | `/api/v1/entities/:id/relations`   | Get relations from/to entity |
| `DELETE` | `/api/v1/relations/:id`            | Delete relation              |

### Memories

| Method   | Endpoint                                 | Description            |
| -------- | ---------------------------------------- | ---------------------- |
| `POST`   | `/api/v1/namespaces/:ns/memories`        | Create memory          |
| `GET`    | `/api/v1/memories/:id`                   | Get memory             |
| `PUT`    | `/api/v1/memories/:id`                   | Update memory          |
| `DELETE` | `/api/v1/memories/:id`                   | Delete memory          |
| `GET`    | `/api/v1/namespaces/:ns/memories/recall` | Recall (decay-ranked)  |
| `GET`    | `/api/v1/namespaces/:ns/memories/search` | Keyword search         |
| `GET`    | `/api/v1/entities/:id/memories`          | Entity-linked memories |

### Conversations

| Method | Endpoint                               | Description         |
| ------ | -------------------------------------- | ------------------- |
| `GET`  | `/api/v1/namespaces/:ns/conversations` | List conversations  |
| `POST` | `/api/v1/namespaces/:ns/conversations` | Create conversation |
| `GET`  | `/api/v1/conversations/:id/messages`   | Get messages        |
| `POST` | `/api/v1/conversations/:id/messages`   | Add message         |
| `GET`  | `/api/v1/namespaces/:ns/messages`      | Search messages     |

### Search

| Method | Endpoint                        | Description            |
| ------ | ------------------------------- | ---------------------- |
| `POST` | `/api/v1/namespaces/:ns/search` | Semantic vector search |

### Traversal

| Method | Endpoint                        | Description         |
| ------ | ------------------------------- | ------------------- |
| `GET`  | `/api/v1/entities/:id/traverse` | BFS graph traversal |

### Admin

| Method | Endpoint                            | Description                    |
| ------ | ----------------------------------- | ------------------------------ |
| `GET`  | `/api/v1/admin/stats/:ns`           | Namespace statistics           |
| `POST` | `/api/v1/admin/claim-namespaces`    | Claim unowned namespaces       |
| `POST` | `/api/v1/admin/reindex`             | Trigger reindex workflow       |
| `POST` | `/api/v1/admin/consolidate`         | Trigger consolidation workflow |
| `GET`  | `/api/v1/admin/workflows/:type/:id` | Workflow instance status       |
