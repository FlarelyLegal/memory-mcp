/**
 * Namespace statistics queries.
 *
 * Aggregate counts and metrics for a namespace, used by the
 * `namespace_stats` MCP tool and REST API.
 */
import type { DbHandle } from "./db.js";

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
