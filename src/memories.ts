/**
 * Memory operations: standalone knowledge fragments with temporal decay.
 */
import type { Env, MemoryRow } from "./types.js";
import { generateId, now, toJson, decayScore } from "./utils.js";

export async function createMemory(
  db: D1Database,
  opts: {
    namespace_id: string;
    content: string;
    type?: "fact" | "observation" | "preference" | "instruction";
    source?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
    entity_ids?: string[];
  },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO memories (id, namespace_id, content, type, source, importance, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.namespace_id,
      opts.content,
      opts.type ?? "fact",
      opts.source ?? null,
      opts.importance ?? 0.5,
      toJson(opts.metadata ?? null),
    )
    .run();

  // Link to entities if specified
  if (opts.entity_ids?.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO memory_entity_links (memory_id, entity_id) VALUES (?, ?)`,
    );
    await db.batch(opts.entity_ids.map((eid) => stmt.bind(id, eid)));
  }

  return id;
}

export async function getMemory(db: D1Database, id: string): Promise<MemoryRow | null> {
  const row = await db.prepare(`SELECT * FROM memories WHERE id = ?`).bind(id).first<MemoryRow>();
  if (row) {
    await db
      .prepare(
        `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
      )
      .bind(now(), id)
      .run();
  }
  return row;
}

export async function searchMemories(
  db: D1Database,
  namespace_id: string,
  opts: { query?: string; type?: string; limit?: number },
): Promise<MemoryRow[]> {
  const clauses: string[] = ["namespace_id = ?"];
  const params: unknown[] = [namespace_id];

  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }
  if (opts.query) {
    clauses.push("content LIKE ?");
    params.push(`%${opts.query}%`);
  }

  const limit = opts.limit ?? 20;
  params.push(limit);

  const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY importance DESC, last_accessed_at DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...params).all<MemoryRow>();
  return result.results;
}

/**
 * Retrieve memories ranked by temporal decay + importance.
 */
export async function recallMemories(
  db: D1Database,
  namespace_id: string,
  opts?: { type?: string; limit?: number; halfLifeHours?: number },
): Promise<(MemoryRow & { relevance_score: number })[]> {
  const clauses: string[] = ["namespace_id = ?"];
  const params: unknown[] = [namespace_id];

  if (opts?.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }

  // Fetch a larger pool then rank client-side
  const pool = opts?.limit ? opts.limit * 3 : 60;
  params.push(pool);

  const sql = `SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY last_accessed_at DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...params).all<MemoryRow>();

  const scored = result.results.map((m) => ({
    ...m,
    relevance_score: decayScore(m.last_accessed_at, m.importance, opts?.halfLifeHours),
  }));

  scored.sort((a, b) => b.relevance_score - a.relevance_score);
  return scored.slice(0, opts?.limit ?? 20);
}

export async function getMemoriesForEntity(
  db: D1Database,
  entity_id: string,
  opts?: { limit?: number },
): Promise<MemoryRow[]> {
  const limit = opts?.limit ?? 20;
  const result = await db
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memory_entity_links mel ON mel.memory_id = m.id
       WHERE mel.entity_id = ?
       ORDER BY m.importance DESC, m.last_accessed_at DESC
       LIMIT ?`,
    )
    .bind(entity_id, limit)
    .all<MemoryRow>();
  return result.results;
}

export async function updateMemory(
  db: D1Database,
  id: string,
  updates: { content?: string; type?: string; importance?: number; metadata?: Record<string, unknown> },
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (updates.content !== undefined) { sets.push("content = ?"); params.push(updates.content); }
  if (updates.type !== undefined) { sets.push("type = ?"); params.push(updates.type); }
  if (updates.importance !== undefined) { sets.push("importance = ?"); params.push(updates.importance); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); params.push(toJson(updates.metadata)); }

  params.push(id);
  await db.prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
}

export async function deleteMemory(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM memories WHERE id = ?`).bind(id).run();
}
