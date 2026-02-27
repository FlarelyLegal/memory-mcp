# Observability

[< Docs](README.md) | [REST API](rest-api.md) | [Testing](../tests/e2e/README.md)

## Audit logging

All write operations (MCP tools + REST API) are audit-logged via `audit()` from `src/audit.ts`. Each call writes to two destinations concurrently:

1. **D1 `audit_logs` table** -- queryable hot window (90-day retention, purged by consolidation workflow)
2. **R2 NDJSON archive** -- cold storage at `audit/{YYYY-MM-DD}.ndjson` (Loki-compatible, retained indefinitely)

Both writes are best-effort via `Promise.allSettled` -- failures never break the primary operation.

### Logged actions

| Action                        | Resource      | Trigger                |
| ----------------------------- | ------------- | ---------------------- |
| `namespace.create`            | namespace     | MCP + API              |
| `namespace.claim`             | namespace     | MCP + API              |
| `entity.create`               | entity        | MCP + API              |
| `entity.update`               | entity        | MCP + API              |
| `entity.delete`               | entity        | MCP + API              |
| `relation.create`             | relation      | MCP + API              |
| `relation.delete`             | relation      | MCP + API              |
| `memory.create`               | memory        | MCP + API              |
| `memory.update`               | memory        | MCP + API              |
| `memory.delete`               | memory        | MCP + API              |
| `conversation.create`         | conversation  | MCP + API              |
| `conversation.delete`         | conversation  | MCP                    |
| `message.create`              | message       | MCP + API              |
| `workflow.reindex`            | workflow      | MCP + API              |
| `workflow.consolidate`        | workflow      | MCP + API              |
| `audit.purge`                 | audit_logs    | Consolidation workflow |
| `service_token.bind_request`  | service_token | API                    |
| `service_token.bind_self`     | service_token | API                    |
| `service_token.bind_denied`   | service_token | API                    |
| `service_token.bind_conflict` | service_token | API                    |
| `service_token.update`        | service_token | API                    |
| `service_token.revoke`        | service_token | API                    |

### D1 audit schema

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  namespace_id TEXT,
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail TEXT,         -- JSON
  created_at INTEGER NOT NULL
);
```

Indexed on: `(namespace_id, created_at)`, `(email, created_at)`, `(action, created_at)`, `(resource_type, resource_id)`, `(created_at)`.

### R2 archive format

Audit events are written as individual R2 objects at `audit/events/{YYYY-MM-DD}/{id}.json` (one PUT per event, no read-modify-write race). The consolidation workflow merges these into daily NDJSON files at `audit/{YYYY-MM-DD}.ndjson` and deletes the individual objects.

Each line in the daily NDJSON file:

```json
{
  "timestamp": "2026-02-27T12:34:56.000Z",
  "id": "...",
  "namespace_id": "...",
  "email": "tim@example.com",
  "action": "entity.create",
  "resource_type": "entity",
  "resource_id": "...",
  "detail": { "name": "Foo", "type": "concept" }
}
```

Compatible with Loki, Grafana, or any NDJSON log processor.

### Retention

- **D1 hot window:** 90 days. The consolidation workflow's `purge-audit-logs` step deletes older entries.
- **R2 cold archive:** Indefinite. Configure R2 lifecycle rules in the dashboard if needed.

Recommended R2 lifecycle policy:

- Production: 90+ days
- Non-production: 30 days

## Tail logging

Workers emit structured `console.log` output visible via `wrangler tail`:

```bash
npx wrangler tail --config wrangler-a.jsonc        # account A
npx wrangler tail --config wrangler-b.jsonc        # account B
npx wrangler tail --config wrangler-a.jsonc --format json  # JSON output
```

Audit events are logged to console as structured JSON alongside D1/R2 writes, making them visible in real-time via tail without additional infrastructure.

### Filtering tail output

```bash
# Only errors
npx wrangler tail --config wrangler-a.jsonc --status error

# Specific path
npx wrangler tail --config wrangler-a.jsonc --search "/api/v1/entities"

# JSON format for piping to jq
npx wrangler tail --config wrangler-a.jsonc --format json | jq '.logs[]'
```

## Workflow monitoring

Durable workflows (reindex, consolidation) can be monitored via:

- **MCP tool:** `get_workflow_status` with workflow type and instance ID
- **REST API:** `GET /api/v1/admin/workflows/:type/:id`
- **Wrangler CLI:** `npx wrangler workflows instances describe <workflow-name> <instance-id>`

Workflow status values: `queued`, `running`, `complete`, `errored`.

## Health check

`GET /health` returns server status without authentication:

```json
{ "status": "ok", "server": "memory-graph-mcp", "version": "0.11.1" }
```

Use this for uptime monitoring, load balancer health checks, or CI preflight.
