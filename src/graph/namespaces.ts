/** Namespace CRUD operations against D1. */
import type { NamespaceRow, NamespaceVisibility } from "../types.js";
import { type DbHandle, withRetry, isReplayInsertConflict } from "../db.js";
import { generateId, toJson } from "../utils.js";

export async function createNamespace(
  db: DbHandle,
  opts: { name: string; description?: string; owner?: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const id = generateId();
  try {
    await withRetry(() =>
      db
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
        .run(),
    );
  } catch (err) {
    if (!(await isReplayInsertConflict(db, "namespaces", id, err))) throw err;
  }
  return id;
}

export async function getNamespace(db: DbHandle, id: string): Promise<NamespaceRow | null> {
  return db.prepare(`SELECT * FROM namespaces WHERE id = ?`).bind(id).first<NamespaceRow>();
}

/**
 * List namespaces accessible to a user.
 * If `owner` is provided, returns namespaces owned by that email PLUS public namespaces.
 * If `owner` is omitted, returns all namespaces (admin use).
 */
export async function listNamespaces(
  db: DbHandle,
  owner?: string,
  opts?: { limit?: number; offset?: number },
): Promise<NamespaceRow[]> {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  if (owner) {
    const result = await db
      .prepare(
        `SELECT * FROM namespaces WHERE owner = ? OR visibility = 'public'
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(owner, limit, offset)
      .all<NamespaceRow>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM namespaces ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<NamespaceRow>();
  return result.results;
}

/**
 * Claim all unowned namespaces (owner IS NULL) for the given owner.
 * Returns the number of namespaces claimed.
 */
export async function updateNamespaceVisibility(
  db: DbHandle,
  id: string,
  visibility: NamespaceVisibility,
): Promise<void> {
  await withRetry(() =>
    db.prepare(`UPDATE namespaces SET visibility = ? WHERE id = ?`).bind(visibility, id).run(),
  );
}

/**
 * Collect all vector IDs for a namespace (entities, memories, messages).
 * Must be called BEFORE deleting the namespace since cascade removes the rows.
 */
export async function collectNamespaceVectorIds(
  db: DbHandle,
  namespaceId: string,
): Promise<string[]> {
  const [entities, memories, messages] = await Promise.all([
    db
      .prepare(`SELECT id FROM entities WHERE namespace_id = ?`)
      .bind(namespaceId)
      .all<{ id: string }>(),
    db
      .prepare(`SELECT id FROM memories WHERE namespace_id = ?`)
      .bind(namespaceId)
      .all<{ id: string }>(),
    db
      .prepare(
        `SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.namespace_id = ?`,
      )
      .bind(namespaceId)
      .all<{ id: string }>(),
  ]);
  return [
    ...entities.results.map((r) => `entity:${r.id}`),
    ...memories.results.map((r) => `memory:${r.id}`),
    ...messages.results.map((r) => `message:${r.id}`),
  ];
}

/** Delete a namespace and all its contents. D1 ON DELETE CASCADE handles child rows. */
export async function deleteNamespace(db: DbHandle, id: string): Promise<void> {
  await withRetry(() => db.prepare(`DELETE FROM namespaces WHERE id = ?`).bind(id).run());
}

export async function claimUnownedNamespaces(db: DbHandle, owner: string): Promise<number> {
  const result = await withRetry(() =>
    db.prepare(`UPDATE namespaces SET owner = ? WHERE owner IS NULL`).bind(owner).run(),
  );
  return result.meta.changes ?? 0;
}
