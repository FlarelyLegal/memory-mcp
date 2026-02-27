/** Relation CRUD operations against D1. */
import type { RelationRow } from "../types.js";
import { type DbHandle, withRetry, isReplayInsertConflict } from "../db.js";
import { generateId, now, toJson } from "../utils.js";

export async function createRelation(
  db: DbHandle,
  opts: {
    namespace_id: string;
    source_id: string;
    target_id: string;
    relation_type: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = generateId();
  try {
    await withRetry(() =>
      db
        .prepare(
          `INSERT INTO relations (id, namespace_id, source_id, target_id, relation_type, weight, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace_id, source_id, target_id, relation_type) DO UPDATE SET
         weight = excluded.weight, metadata = excluded.metadata, updated_at = ?`,
        )
        .bind(
          id,
          opts.namespace_id,
          opts.source_id,
          opts.target_id,
          opts.relation_type,
          opts.weight ?? 1.0,
          toJson(opts.metadata ?? null),
          now(),
        )
        .run(),
    );
  } catch (err) {
    if (!(await isReplayInsertConflict(db, "relations", id, err))) throw err;
  }
  // On upsert conflict, D1 keeps the original row's ID — query for the actual ID.
  const row = await db
    .prepare(
      `SELECT id FROM relations
       WHERE namespace_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
    )
    .bind(opts.namespace_id, opts.source_id, opts.target_id, opts.relation_type)
    .first<{ id: string }>();
  return row?.id ?? id;
}

export async function getRelationsFrom(
  db: DbHandle,
  entity_id: string,
  opts?: { relation_type?: string; limit?: number },
): Promise<(RelationRow & { target_name: string; target_type: string })[]> {
  const clauses: string[] = ["r.source_id = ?"];
  const params: unknown[] = [entity_id];

  if (opts?.relation_type) {
    clauses.push("r.relation_type = ?");
    params.push(opts.relation_type);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit);

  const sql = `
    SELECT r.*, e.name as target_name, e.type as target_type
    FROM relations r
    JOIN entities e ON e.id = r.target_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY r.weight DESC
    LIMIT ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<RelationRow & { target_name: string; target_type: string }>();
  return result.results;
}

export async function getRelationsTo(
  db: DbHandle,
  entity_id: string,
  opts?: { relation_type?: string; limit?: number },
): Promise<(RelationRow & { source_name: string; source_type: string })[]> {
  const clauses: string[] = ["r.target_id = ?"];
  const params: unknown[] = [entity_id];

  if (opts?.relation_type) {
    clauses.push("r.relation_type = ?");
    params.push(opts.relation_type);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit);

  const sql = `
    SELECT r.*, e.name as source_name, e.type as source_type
    FROM relations r
    JOIN entities e ON e.id = r.source_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY r.weight DESC
    LIMIT ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<RelationRow & { source_name: string; source_type: string }>();
  return result.results;
}

export async function deleteRelation(db: DbHandle, id: string): Promise<void> {
  await withRetry(() => db.prepare(`DELETE FROM relations WHERE id = ?`).bind(id).run());
}
