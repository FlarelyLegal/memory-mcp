/**
 * Core graph operations against D1.
 * Handles entities, relations, namespaces, and graph traversal.
 */
import type { EntityRow, RelationRow, NamespaceRow } from "./types.js";
import { generateId, now, toJson } from "./utils.js";

// ---- Namespaces ----

export async function createNamespace(
  db: D1Database,
  opts: { name: string; description?: string; owner?: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO namespaces (id, name, description, owner, metadata) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.name,
      opts.description ?? null,
      opts.owner ?? null,
      toJson(opts.metadata ?? null),
    )
    .run();
  return id;
}

export async function getNamespace(db: D1Database, id: string): Promise<NamespaceRow | null> {
  return db.prepare(`SELECT * FROM namespaces WHERE id = ?`).bind(id).first<NamespaceRow>();
}

export async function listNamespaces(db: D1Database, owner?: string): Promise<NamespaceRow[]> {
  if (owner) {
    const result = await db
      .prepare(`SELECT * FROM namespaces WHERE owner = ? OR owner IS NULL ORDER BY created_at DESC`)
      .bind(owner)
      .all<NamespaceRow>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM namespaces ORDER BY created_at DESC`)
    .all<NamespaceRow>();
  return result.results;
}

// ---- Entities ----

export async function createEntity(
  db: D1Database,
  opts: {
    namespace_id: string;
    name: string;
    type: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO entities (id, namespace_id, name, type, summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.namespace_id,
      opts.name,
      opts.type,
      opts.summary ?? null,
      toJson(opts.metadata ?? null),
    )
    .run();
  return id;
}

export async function getEntity(db: D1Database, id: string): Promise<EntityRow | null> {
  const row = await db.prepare(`SELECT * FROM entities WHERE id = ?`).bind(id).first<EntityRow>();
  if (row) {
    // bump access stats
    await db
      .prepare(
        `UPDATE entities SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`,
      )
      .bind(now(), id)
      .run();
  }
  return row;
}

export async function searchEntities(
  db: D1Database,
  namespace_id: string,
  opts: { query?: string; type?: string; limit?: number },
): Promise<EntityRow[]> {
  const clauses: string[] = ["namespace_id = ?"];
  const params: unknown[] = [namespace_id];

  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }
  if (opts.query) {
    clauses.push("(name LIKE ? OR summary LIKE ?)");
    params.push(`%${opts.query}%`, `%${opts.query}%`);
  }

  const limit = opts.limit ?? 20;
  params.push(limit);

  const sql = `SELECT * FROM entities WHERE ${clauses.join(" AND ")} ORDER BY last_accessed_at DESC LIMIT ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<EntityRow>();
  return result.results;
}

export async function updateEntity(
  db: D1Database,
  id: string,
  updates: { name?: string; type?: string; summary?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    sets.push("type = ?");
    params.push(updates.type);
  }
  if (updates.summary !== undefined) {
    sets.push("summary = ?");
    params.push(updates.summary);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(toJson(updates.metadata));
  }

  params.push(id);
  await db
    .prepare(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();
}

export async function deleteEntity(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM entities WHERE id = ?`).bind(id).run();
}

// ---- Relations ----

export async function createRelation(
  db: D1Database,
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
  await db
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
    .run();
  return id;
}

export async function getRelationsFrom(
  db: D1Database,
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
  db: D1Database,
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

export async function deleteRelation(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM relations WHERE id = ?`).bind(id).run();
}

// ---- Graph traversal ----

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

      // Get outgoing relations
      const rels = await getRelationsFrom(db, entityId, {
        relation_type: opts?.relationTypes?.[0], // simplified: use first filter
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

  // Fetch all visited entities
  const entities: EntityRow[] = [];
  for (const eid of visited) {
    const e = await db.prepare(`SELECT * FROM entities WHERE id = ?`).bind(eid).first<EntityRow>();
    if (e) entities.push(e);
  }

  return { entities, relations: allRelations };
}
