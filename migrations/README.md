# D1 Migrations

[README](../README.md) > [Docs](../docs/README.md) > Migrations

Sequential D1 schema migrations applied via `wrangler d1 migrations apply`. Wrangler tracks which migrations have run -- each file executes at most once per database.

## Migration files

| File                              | Description                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `0000_initial_schema.sql`         | Core tables: namespaces, entities, relations, conversations, messages, memories, memory_entity_links, audit_logs |
| `0001_add_rbac_tables.sql`        | RBAC tables: groups, group_members, namespace_grants                                                             |
| `0002_add_namespace_shard_id.sql` | Add `shard_id` column to namespaces (default `"default"`)                                                        |

## Commands

| Task           | Command                 |
| -------------- | ----------------------- |
| Apply (site B) | `npm run migrate:b`     |
| Apply (site A) | `npm run migrate:a`     |
| Apply (local)  | `npm run migrate:local` |

## Adding a new migration

1. Create `migrations/NNNN_description.sql` (next sequential number)
2. Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` -- migrations must be idempotent where possible
3. Run `npm run migrate:local` to test locally, then `npm run migrate:b` and `npm run migrate:a` for remote

## Relationship to `schemas/schema.sql`

`schemas/schema.sql` is the full canonical schema used by `npm run db:init` for fresh databases. Migrations are incremental changes applied to existing databases. Both must stay in sync -- any migration that adds a table or column must also be reflected in `schemas/schema.sql`.
