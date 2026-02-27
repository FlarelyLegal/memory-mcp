/** Entity CRUD operations against D1. */
import type { EntityRow } from "../types.js";
import { generateId, now, toJson, ftsEscape } from "../utils.js";

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
  const [selectResult] = await db.batch([
    db.prepare(`SELECT * FROM entities WHERE id = ?`).bind(id),
    db
      .prepare(
        `UPDATE entities SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
      )
      .bind(now(), id),
  ]);
  const rows = selectResult.results as unknown as EntityRow[];
  return rows[0] ?? null;
}

export async function searchEntities(
  db: D1Database,
  namespace_id: string,
  opts: { query?: string; type?: string; limit?: number; offset?: number },
): Promise<EntityRow[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  // FTS5 path: use MATCH + BM25 ranking when a query is provided
  if (opts.query) {
    try {
      const clauses: string[] = ["e.namespace_id = ?"];
      const params: unknown[] = [namespace_id];
      if (opts.type) {
        clauses.push("e.type = ?");
        params.push(opts.type);
      }
      // Escape FTS5 special chars and add prefix matching
      const ftsQuery = ftsEscape(opts.query);
      params.push(ftsQuery, limit, offset);
      const sql =
        `SELECT e.*, bm25(entities_fts) AS rank FROM entities e` +
        ` JOIN entities_fts ON entities_fts.rowid = e.rowid` +
        ` WHERE ${clauses.join(" AND ")} AND entities_fts MATCH ?` +
        ` ORDER BY rank LIMIT ? OFFSET ?`;
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<EntityRow>();
      if (result.results.length > 0 || result.success) return result.results;
    } catch {
      // FTS table doesn't exist yet — fall through to LIKE
    }
  }

  // Fallback: LIKE-based search
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
  params.push(limit, offset);
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
