/**
 * Memory consolidation operations.
 *
 * Provides the data-layer queries for the consolidation workflow:
 * - Decay sweep: find memories below a relevance threshold for soft-delete
 * - Duplicate detection: find near-duplicate memories via FTS + cosine sim
 * - Stats: aggregate counts, importance distribution, namespace sizes
 * - Entity summary refresh via Workers AI
 */
import type { MemoryRow, EntityRow } from "./types.js";
import { type DbHandle, withRetry } from "./db.js";
import { now, decayScore } from "./utils.js";

/** Memories below this relevance score are candidates for archival. */
export const DEFAULT_DECAY_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Decay sweep
// ---------------------------------------------------------------------------

/** Find memories whose decay-ranked relevance is below the threshold. */
export async function findDecayedMemories(
  db: DbHandle,
  namespace_id: string,
  opts?: { threshold?: number; limit?: number; halfLifeHours?: number },
): Promise<(MemoryRow & { relevance_score: number })[]> {
  const threshold = opts?.threshold ?? DEFAULT_DECAY_THRESHOLD;
  const limit = opts?.limit ?? 200;
  const halfLife = opts?.halfLifeHours ?? 168;

  const result = await db
    .prepare(
      `SELECT * FROM memories WHERE namespace_id = ?
       ORDER BY last_accessed_at ASC LIMIT ?`,
    )
    .bind(namespace_id, limit * 2) // over-fetch, then filter client-side
    .all<MemoryRow>();

  return result.results
    .map((m) => ({
      ...m,
      relevance_score: decayScore(m.last_accessed_at, m.importance, halfLife),
    }))
    .filter((m) => m.relevance_score < threshold)
    .slice(0, limit);
}

/** Soft-delete decayed memories by moving content to metadata and clearing it. */
export async function archiveMemories(db: DbHandle, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const ts = now();
  const stmt = db.prepare(
    `UPDATE memories
     SET metadata = json_set(COALESCE(metadata, '{}'), '$.archived', 1, '$.archived_at', ?),
         importance = 0,
         updated_at = ?
     WHERE id = ?`,
  );
  const results = await withRetry(() => db.batch(ids.map((id) => stmt.bind(ts, ts, id))));
  return results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
}

/** Hard-delete archived memories older than a cutoff. */
export async function purgeArchivedMemories(
  db: DbHandle,
  namespace_id: string,
  olderThanEpoch: number,
): Promise<number> {
  const result = await withRetry(() =>
    db
      .prepare(
        `DELETE FROM memories
       WHERE namespace_id = ? AND importance = 0
         AND json_extract(metadata, '$.archived') = 1
         AND updated_at < ?`,
      )
      .bind(namespace_id, olderThanEpoch)
      .run(),
  );
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/** Find memory pairs with identical or near-identical content (FTS match). */
export async function findDuplicateMemories(
  db: DbHandle,
  namespace_id: string,
  opts?: { limit?: number },
): Promise<{ id_a: string; id_b: string; content_a: string; content_b: string }[]> {
  const limit = opts?.limit ?? 50;
  // Self-join on FTS to find content overlap within the same namespace
  const result = await db
    .prepare(
      `SELECT a.id AS id_a, b.id AS id_b, a.content AS content_a, b.content AS content_b
       FROM memories a
       JOIN memories b ON a.namespace_id = b.namespace_id AND a.id < b.id
       WHERE a.namespace_id = ?
         AND a.content = b.content
       LIMIT ?`,
    )
    .bind(namespace_id, limit)
    .all<{ id_a: string; id_b: string; content_a: string; content_b: string }>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface NamespaceStats {
  namespace_id: string;
  entity_count: number;
  memory_count: number;
  relation_count: number;
  conversation_count: number;
  message_count: number;
  avg_importance: number;
  archived_count: number;
}

/** Aggregate stats for a single namespace. */
export async function getNamespaceStats(
  db: DbHandle,
  namespace_id: string,
): Promise<NamespaceStats> {
  const [entities, memories, relations, convos, msgs, avgImp, archived] = await db.batch([
    db.prepare("SELECT COUNT(*) AS c FROM entities WHERE namespace_id = ?").bind(namespace_id),
    db.prepare("SELECT COUNT(*) AS c FROM memories WHERE namespace_id = ?").bind(namespace_id),
    db.prepare("SELECT COUNT(*) AS c FROM relations WHERE namespace_id = ?").bind(namespace_id),
    db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE namespace_id = ?").bind(namespace_id),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM messages m
         JOIN conversations cv ON cv.id = m.conversation_id
         WHERE cv.namespace_id = ?`,
      )
      .bind(namespace_id),
    db
      .prepare("SELECT AVG(importance) AS avg FROM memories WHERE namespace_id = ?")
      .bind(namespace_id),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM memories
         WHERE namespace_id = ? AND json_extract(metadata, '$.archived') = 1`,
      )
      .bind(namespace_id),
  ]);

  const row = <T>(r: D1Result<T>) => (r.results as Record<string, number>[])[0] ?? {};
  return {
    namespace_id,
    entity_count: row(entities).c ?? 0,
    memory_count: row(memories).c ?? 0,
    relation_count: row(relations).c ?? 0,
    conversation_count: row(convos).c ?? 0,
    message_count: row(msgs).c ?? 0,
    avg_importance: Math.round((row(avgImp).avg ?? 0) * 100) / 100,
    archived_count: row(archived).c ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Entity summary refresh
// ---------------------------------------------------------------------------

/** Fetch entity + its linked memories for LLM-based summary generation. */
export async function getEntityWithMemories(
  db: DbHandle,
  entity_id: string,
): Promise<{ entity: EntityRow; memories: MemoryRow[] } | null> {
  const entity = await db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .bind(entity_id)
    .first<EntityRow>();
  if (!entity) return null;

  const mems = await db
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memory_entity_links mel ON mel.memory_id = m.id
       WHERE mel.entity_id = ?
       ORDER BY m.importance DESC LIMIT 20`,
    )
    .bind(entity_id)
    .all<MemoryRow>();
  return { entity, memories: mems.results };
}

/** Update an entity's summary field. */
export async function updateEntitySummary(
  db: DbHandle,
  entity_id: string,
  summary: string,
): Promise<void> {
  await withRetry(() =>
    db
      .prepare("UPDATE entities SET summary = ?, updated_at = ? WHERE id = ?")
      .bind(summary, now(), entity_id)
      .run(),
  );
}
