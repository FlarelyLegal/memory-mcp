/**
 * Memory consolidation data-layer operations.
 *
 * Queries used by the consolidation workflow:
 * - Decay sweep: find memories below a relevance threshold for soft-delete
 * - Duplicate detection: find exact-duplicate memories
 * - Archive / purge: soft-delete and hard-delete old memories
 */
import type { MemoryRow } from "./types.js";
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
): Promise<{ deleted: number; deleted_ids: string[] }> {
  const candidates = await db
    .prepare(
      `SELECT id FROM memories
       WHERE namespace_id = ? AND importance = 0
         AND json_extract(metadata, '$.archived') = 1
         AND updated_at < ?`,
    )
    .bind(namespace_id, olderThanEpoch)
    .all<{ id: string }>();

  const ids = candidates.results.map((r) => r.id);
  if (ids.length === 0) return { deleted: 0, deleted_ids: [] };

  // Re-check archival constraints at delete-time so concurrent updates are safe.
  const stmt = db.prepare(
    `DELETE FROM memories
     WHERE id = ? AND namespace_id = ? AND importance = 0
       AND json_extract(metadata, '$.archived') = 1
       AND updated_at < ?`,
  );
  const results = await withRetry(() =>
    db.batch(ids.map((id) => stmt.bind(id, namespace_id, olderThanEpoch))),
  );

  const deleted_ids: string[] = [];
  let deleted = 0;
  for (let i = 0; i < results.length; i++) {
    const changes = results[i]?.meta.changes ?? 0;
    if (changes > 0) {
      deleted += changes;
      deleted_ids.push(ids[i]!);
    }
  }
  return { deleted, deleted_ids };
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
