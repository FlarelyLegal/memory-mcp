/** BFS graph traversal from a starting entity. */
import type { EntityRow, RelationRow } from "../types.js";
import { getRelationsFrom } from "./relations.js";

/**
 * BFS traversal from a starting entity up to `maxDepth` hops.
 * Returns all reachable entities and the relations connecting them.
 */
export async function traverse(
  db: D1Database,
  startEntityId: string,
  opts?: { maxDepth?: number; relationTypes?: string[] },
): Promise<{ entities: EntityRow[]; relations: RelationRow[] }> {
  const maxDepth = opts?.maxDepth ?? 2;
  const visited = new Set<string>();
  const allRelations: RelationRow[] = [];
  let frontier = [startEntityId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const entityId of frontier) {
      if (visited.has(entityId)) continue;
      visited.add(entityId);

      const rels = await getRelationsFrom(db, entityId, {
        relation_type: opts?.relationTypes?.[0],
        limit: 20,
      });

      for (const rel of rels) {
        allRelations.push(rel);
        if (!visited.has(rel.target_id)) {
          nextFrontier.push(rel.target_id);
        }
      }
    }
    frontier = nextFrontier;
  }

  const entities: EntityRow[] = [];
  for (const eid of visited) {
    const e = await db.prepare(`SELECT * FROM entities WHERE id = ?`).bind(eid).first<EntityRow>();
    if (e) entities.push(e);
  }

  return { entities, relations: allRelations };
}
