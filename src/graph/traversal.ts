/** BFS graph traversal from a starting entity. */
import type { EntityRow, RelationRow } from "../types.js";
import type { DbHandle } from "../db.js";
import { chunks } from "../utils.js";

/** D1 max bound parameters per query. */
const MAX_PARAMS = 100;

type RelWithNames = RelationRow & { target_name: string; target_type: string };

/**
 * BFS traversal from a starting entity up to `maxDepth` hops.
 * Uses batched IN(...) queries per depth level instead of per-node queries.
 * Chunks at 100 IDs to stay within the D1 bound-parameter limit.
 * Returns all reachable entities and the relations connecting them.
 */
export async function traverse(
  db: DbHandle,
  startEntityId: string,
  opts?: { maxDepth?: number; relationTypes?: string[] },
): Promise<{ entities: EntityRow[]; relations: RelationRow[] }> {
  const maxDepth = opts?.maxDepth ?? 2;
  const visited = new Set<string>();
  const allRelations: RelationRow[] = [];
  let frontier = [startEntityId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const unvisited = frontier.filter((id) => !visited.has(id));
    if (unvisited.length === 0) break;
    for (const id of unvisited) visited.add(id);

    // Chunk to stay within D1's 100-parameter limit
    const nextFrontier: string[] = [];
    for (const chunk of chunks(unvisited, MAX_PARAMS)) {
      const ph = chunk.map(() => "?").join(",");
      const clauses = [`r.source_id IN (${ph})`];
      const params: unknown[] = [...chunk];
      if (opts?.relationTypes?.length) {
        const rph = opts.relationTypes.map(() => "?").join(",");
        clauses.push(`r.relation_type IN (${rph})`);
        params.push(...opts.relationTypes);
      }
      const result = await db
        .prepare(
          `SELECT r.*, e.name AS target_name, e.type AS target_type
           FROM relations r
           JOIN entities e ON e.id = r.target_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY r.weight DESC`,
        )
        .bind(...params)
        .all<RelWithNames>();
      for (const rel of result.results) {
        allRelations.push(rel);
        if (!visited.has(rel.target_id)) nextFrontier.push(rel.target_id);
      }
    }
    frontier = nextFrontier;
  }
  for (const id of frontier) visited.add(id);

  // Batch-fetch all visited entities, chunked for D1 param limit
  if (visited.size === 0) return { entities: [], relations: [] };
  const entities: EntityRow[] = [];
  for (const chunk of chunks([...visited], MAX_PARAMS)) {
    const ph = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT * FROM entities WHERE id IN (${ph})`)
      .bind(...chunk)
      .all<EntityRow>();
    entities.push(...result.results);
  }

  return { entities, relations: allRelations };
}
