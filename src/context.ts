/**
 * Batch entity context hydration for search context mode.
 *
 * Replaces the N+1 pattern (4 queries per entity) with 3 batch queries
 * total, regardless of how many entities matched.
 */
import type { DbHandle } from "./db.js";
import type { EntityRow, RelationRow, MemoryRow } from "./types.js";
import { now } from "./utils.js";

export interface EntityContext {
  entity: EntityRow;
  relationsFrom: (RelationRow & { target_name: string; target_type: string })[];
  relationsTo: (RelationRow & { source_name: string; source_type: string })[];
  memories: MemoryRow[];
}

/**
 * Batch-fetch entities, relations, and linked memories for a set of entity IDs.
 * Returns a Map keyed by entity ID for easy lookup.
 *
 * 3 queries total (entities, relations, memories) instead of 4×N.
 */
export async function hydrateEntityContext(
  db: DbHandle,
  entityIds: string[],
  opts?: { relLimit?: number; memLimit?: number },
): Promise<Map<string, EntityContext>> {
  if (entityIds.length === 0) return new Map();

  const relLimit = opts?.relLimit ?? 5;
  const memLimit = opts?.memLimit ?? 5;
  const ph = entityIds.map(() => "?").join(",");
  const ts = now();

  // 1. Batch-fetch entities + touch access timestamp
  const [entityResult] = await db.batch([
    db.prepare(`SELECT * FROM entities WHERE id IN (${ph})`).bind(...entityIds),
    db
      .prepare(
        `UPDATE entities SET last_accessed_at = ?, access_count = access_count + 1 WHERE id IN (${ph})`,
      )
      .bind(ts, ...entityIds),
  ]);
  const entities = entityResult.results as unknown as EntityRow[];
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // 2. Batch-fetch relations (both directions) with joined entity names
  const relResult = await db
    .prepare(
      `SELECT r.*, e.name as peer_name, e.type as peer_type,
              CASE WHEN r.source_id IN (${ph}) THEN 'from' ELSE 'to' END as direction
       FROM relations r
       JOIN entities e ON e.id = CASE WHEN r.source_id IN (${ph}) THEN r.target_id ELSE r.source_id END
       WHERE r.source_id IN (${ph}) OR r.target_id IN (${ph})
       ORDER BY r.weight DESC`,
    )
    .bind(...entityIds, ...entityIds, ...entityIds, ...entityIds)
    .all<RelationRow & { peer_name: string; peer_type: string; direction: string }>();

  // 3. Batch-fetch entity-linked memories
  const memResult = await db
    .prepare(
      `SELECT m.*, mel.entity_id as _link_entity_id FROM memories m
       JOIN memory_entity_links mel ON mel.memory_id = m.id
       WHERE mel.entity_id IN (${ph})
       ORDER BY m.importance DESC, m.last_accessed_at DESC`,
    )
    .bind(...entityIds)
    .all<MemoryRow & { _link_entity_id: string }>();

  // Assemble per-entity context with limits
  const result = new Map<string, EntityContext>();
  const fromCounts = new Map<string, number>();
  const toCounts = new Map<string, number>();
  const memCounts = new Map<string, number>();

  for (const id of entityIds) {
    const entity = entityMap.get(id);
    if (!entity) continue;
    result.set(id, { entity, relationsFrom: [], relationsTo: [], memories: [] });
    fromCounts.set(id, 0);
    toCounts.set(id, 0);
    memCounts.set(id, 0);
  }

  for (const rel of relResult.results) {
    if (rel.direction === "from") {
      const ctx = result.get(rel.source_id);
      const count = fromCounts.get(rel.source_id) ?? 0;
      if (ctx && count < relLimit) {
        ctx.relationsFrom.push({
          ...rel,
          target_name: rel.peer_name,
          target_type: rel.peer_type,
        } as RelationRow & { target_name: string; target_type: string });
        fromCounts.set(rel.source_id, count + 1);
      }
    } else {
      const ctx = result.get(rel.target_id);
      const count = toCounts.get(rel.target_id) ?? 0;
      if (ctx && count < relLimit) {
        ctx.relationsTo.push({
          ...rel,
          source_name: rel.peer_name,
          source_type: rel.peer_type,
        } as RelationRow & { source_name: string; source_type: string });
        toCounts.set(rel.target_id, count + 1);
      }
    }
  }

  for (const mem of memResult.results) {
    const eid = mem._link_entity_id;
    const ctx = result.get(eid);
    const count = memCounts.get(eid) ?? 0;
    if (ctx && count < memLimit) {
      ctx.memories.push(mem);
      memCounts.set(eid, count + 1);
    }
  }

  return result;
}
