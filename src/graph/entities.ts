/** Entity CRUD operations against D1. */
import type { EntityRow } from "../types.js";
import { generateId, now, toJson } from "../utils.js";

export async function createEntity(
  db: D1Database,
  opts: {
    namespace_id: string;
    name: string;
    type: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO entities (id, namespace_id, name, type, summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.namespace_id,
      opts.name,
      opts.type,
      opts.summary ?? null,
      toJson(opts.metadata ?? null),
    )
    .run();
  return id;
}

export async function getEntity(db: D1Database, id: string): Promise<EntityRow | null> {
  const row = await db.prepare(`SELECT * FROM entities WHERE id = ?`).bind(id).first<EntityRow>();
  if (row) {
    await db
      .prepare(
        `UPDATE entities SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
      )
      .bind(now(), id)
      .run();
  }
  return row;
}

export async function searchEntities(
  db: D1Database,
  namespace_id: string,
  opts: { query?: string; type?: string; limit?: number; offset?: number },
): Promise<EntityRow[]> {
  const clauses: string[] = ["namespace_id = ?"];
  const params: unknown[] = [namespace_id];

  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }
  if (opts.query) {
    clauses.push("(name LIKE ? OR summary LIKE ?)");
    params.push(`%${opts.query}%`, `%${opts.query}%`);
  }

  const limit = opts.limit ?? 20;
  params.push(limit, opts.offset ?? 0);

  const sql =
    `SELECT * FROM entities WHERE ${clauses.join(" AND ")}` +
    ` ORDER BY last_accessed_at DESC LIMIT ? OFFSET ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<EntityRow>();
  return result.results;
}

export async function updateEntity(
  db: D1Database,
  id: string,
  updates: { name?: string; type?: string; summary?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    sets.push("type = ?");
    params.push(updates.type);
  }
  if (updates.summary !== undefined) {
    sets.push("summary = ?");
    params.push(updates.summary);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(toJson(updates.metadata));
  }

  params.push(id);
  await db
    .prepare(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();
}

export async function deleteEntity(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM entities WHERE id = ?`).bind(id).run();
}
