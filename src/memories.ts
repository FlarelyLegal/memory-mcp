/**
 * Memory operations: standalone knowledge fragments with temporal decay.
 */
import type { MemoryRow } from "./types.js";
import { type DbHandle, withRetry, isReplayInsertConflict } from "./db.js";
import {
  generateId,
  now,
  toJson,
  decayScore,
  ftsEscape,
  handleFtsError,
  escapeLike,
} from "./utils.js";

export async function createMemory(
  db: DbHandle,
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
  try {
    await withRetry(() =>
      db
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
        .run(),
    );
  } catch (err) {
    if (!(await isReplayInsertConflict(db, "memories", id, err))) throw err;
  }

  // Link to entities if specified
  if (opts.entity_ids?.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO memory_entity_links (memory_id, entity_id) VALUES (?, ?)`,
    );
    await withRetry(() => db.batch(opts.entity_ids!.map((eid) => stmt.bind(id, eid))));
  }

  return id;
}

export async function getMemory(db: DbHandle, id: string): Promise<MemoryRow | null> {
  const [selectResult] = await withRetry(() =>
    db.batch([
      db.prepare(`SELECT * FROM memories WHERE id = ?`).bind(id),
      db
        .prepare(
          `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
        )
        .bind(now(), id),
    ]),
  );
  const rows = selectResult.results as unknown as MemoryRow[];
  return rows[0] ?? null;
}

export async function searchMemories(
  db: DbHandle,
  namespace_id: string,
  opts: { query?: string; type?: string; limit?: number; offset?: number },
): Promise<MemoryRow[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  // FTS5 path: BM25-ranked full-text search
  if (opts.query) {
    try {
      const clauses: string[] = ["m.namespace_id = ?"];
      const params: unknown[] = [namespace_id];
      if (opts.type) {
        clauses.push("m.type = ?");
        params.push(opts.type);
      }
      const ftsQuery = ftsEscape(opts.query);
      params.push(ftsQuery, limit, offset);
      const sql =
        `SELECT m.*, bm25(memories_fts) AS rank FROM memories m` +
        ` JOIN memories_fts ON memories_fts.rowid = m.rowid` +
        ` WHERE ${clauses.join(" AND ")} AND memories_fts MATCH ?` +
        ` ORDER BY rank LIMIT ? OFFSET ?`;
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<MemoryRow>();
      if (result.results.length > 0 || result.success) return result.results;
    } catch (err) {
      handleFtsError(err);
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
    clauses.push("content LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(opts.query)}%`);
  }
  params.push(limit, offset);
  const sql =
    `SELECT * FROM memories WHERE ${clauses.join(" AND ")}` +
    ` ORDER BY importance DESC, last_accessed_at DESC LIMIT ? OFFSET ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<MemoryRow>();
  return result.results;
}

/**
 * Retrieve memories ranked by temporal decay + importance.
 */
export async function recallMemories(
  db: DbHandle,
  namespace_id: string,
  opts?: { type?: string; limit?: number; halfLifeHours?: number; offset?: number },
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
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<MemoryRow>();

  const scored = result.results.map((m) => ({
    ...m,
    relevance_score: decayScore(m.last_accessed_at, m.importance, opts?.halfLifeHours),
  }));

  scored.sort((a, b) => b.relevance_score - a.relevance_score);
  const offset = opts?.offset ?? 0;
  return scored.slice(offset, offset + (opts?.limit ?? 20));
}

export async function getMemoriesForEntity(
  db: DbHandle,
  entity_id: string,
  opts?: { limit?: number; offset?: number },
): Promise<MemoryRow[]> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const result = await db
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memory_entity_links mel ON mel.memory_id = m.id
       WHERE mel.entity_id = ?
       ORDER BY m.importance DESC, m.last_accessed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(entity_id, limit, offset)
    .all<MemoryRow>();
  return result.results;
}

export async function updateMemory(
  db: DbHandle,
  id: string,
  updates: {
    content?: string;
    type?: string;
    importance?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (updates.content !== undefined) {
    sets.push("content = ?");
    params.push(updates.content);
  }
  if (updates.type !== undefined) {
    sets.push("type = ?");
    params.push(updates.type);
  }
  if (updates.importance !== undefined) {
    sets.push("importance = ?");
    params.push(updates.importance);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(toJson(updates.metadata));
  }

  params.push(id);
  await withRetry(() =>
    db
      .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run(),
  );
}

export async function deleteMemory(db: DbHandle, id: string): Promise<void> {
  await withRetry(() => db.prepare(`DELETE FROM memories WHERE id = ?`).bind(id).run());
}
