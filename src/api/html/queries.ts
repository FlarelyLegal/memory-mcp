/**
 * Lightweight D1 queries for HTML views.
 *
 * These fetch just enough data for the browser views -- limited rows,
 * minimal columns, no embedding vectors. Separate from the full graph
 * layer to keep HTML rendering self-contained.
 */
import type { DbHandle } from "../../db.js";
import type { NamespaceDetailData } from "./namespace-detail.js";
import type { EntityDetailData } from "./entity-detail.js";
import { getNamespaceStats, type NamespaceStats } from "../../stats.js";
import { toISO } from "../../utils.js";

const PAGE = 50;

/** Fetch stats for multiple namespaces in parallel. */
export async function fetchNamespaceStatsMap(
  db: DbHandle,
  namespaceIds: string[],
): Promise<Map<string, NamespaceStats>> {
  const map = new Map<string, NamespaceStats>();
  // Batch in groups of 5 to avoid excessive parallelism
  for (let i = 0; i < namespaceIds.length; i += 5) {
    const batch = namespaceIds.slice(i, i + 5);
    const results = await Promise.all(batch.map((id) => getNamespaceStats(db, id)));
    for (const s of results) map.set(s.namespace_id, s);
  }
  return map;
}

/** Fetch all data needed for the namespace detail HTML view. */
export async function fetchNamespaceDetail(
  db: DbHandle,
  namespaceId: string,
): Promise<Omit<NamespaceDetailData, "namespace"> & { stats: NamespaceStats }> {
  const [stats, entities, memories, relations, conversations] = await Promise.all([
    getNamespaceStats(db, namespaceId),
    db
      .prepare(
        `SELECT id, name, type, summary, created_at
         FROM entities WHERE namespace_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(namespaceId, PAGE)
      .all<{
        id: string;
        name: string;
        type: string;
        summary: string | null;
        created_at: number;
      }>(),
    db
      .prepare(
        `SELECT id, content, importance, created_at
         FROM memories WHERE namespace_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(namespaceId, PAGE)
      .all<{ id: string; content: string; importance: number | null; created_at: number }>(),
    db
      .prepare(
        `SELECT r.relation_type,
                es.name AS source_name,
                et.name AS target_name
         FROM relations r
         JOIN entities es ON es.id = r.source_id
         JOIN entities et ON et.id = r.target_id
         WHERE r.namespace_id = ?
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(namespaceId, PAGE)
      .all<{ relation_type: string; source_name: string; target_name: string }>(),
    db
      .prepare(
        `SELECT id, title, created_at
         FROM conversations WHERE namespace_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(namespaceId, PAGE)
      .all<{ id: string; title: string | null; created_at: number }>(),
  ]);

  return {
    stats,
    entities: entities.results.map((e) => ({
      ...e,
      created_at: toISO(e.created_at),
    })),
    memories: memories.results.map((m) => ({
      ...m,
      created_at: toISO(m.created_at),
    })),
    relations: relations.results,
    conversations: conversations.results.map((c) => ({
      ...c,
      created_at: toISO(c.created_at),
    })),
  };
}

/** Fetch all data needed for the entity detail HTML view. */
export async function fetchEntityDetail(
  db: DbHandle,
  entityId: string,
  entity: {
    id: string;
    namespace_id: string;
    name: string;
    type: string;
    summary: string | null;
    created_at: number;
    updated_at: number;
  },
): Promise<EntityDetailData> {
  const [nsRow, outgoing, incoming, memoryLinks] = await Promise.all([
    db
      .prepare(`SELECT name FROM namespaces WHERE id = ?`)
      .bind(entity.namespace_id)
      .first<{ name: string }>(),
    db
      .prepare(
        `SELECT r.relation_type, e.id, e.name
         FROM relations r JOIN entities e ON e.id = r.target_id
         WHERE r.source_id = ?
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(entityId, PAGE)
      .all<{ relation_type: string; id: string; name: string }>(),
    db
      .prepare(
        `SELECT r.relation_type, e.id, e.name
         FROM relations r JOIN entities e ON e.id = r.source_id
         WHERE r.target_id = ?
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(entityId, PAGE)
      .all<{ relation_type: string; id: string; name: string }>(),
    db
      .prepare(
        `SELECT m.id, m.content, m.importance, m.created_at
         FROM memories m
         JOIN memory_entity_links mel ON mel.memory_id = m.id
         WHERE mel.entity_id = ?
         ORDER BY m.created_at DESC LIMIT ?`,
      )
      .bind(entityId, PAGE)
      .all<{ id: string; content: string; importance: number | null; created_at: number }>(),
  ]);

  const relations = [
    ...outgoing.results.map((r) => ({
      id: r.id,
      name: r.name,
      relation_type: r.relation_type,
      direction: "outgoing" as const,
    })),
    ...incoming.results.map((r) => ({
      id: r.id,
      name: r.name,
      relation_type: r.relation_type,
      direction: "incoming" as const,
    })),
  ];

  return {
    entity: {
      ...entity,
      namespace_name: nsRow?.name ?? "(unknown)",
      created_at: toISO(entity.created_at),
      updated_at: toISO(entity.updated_at),
    },
    relations,
    memories: memoryLinks.results.map((m) => ({
      ...m,
      created_at: toISO(m.created_at),
    })),
  };
}
