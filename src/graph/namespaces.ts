/** Namespace CRUD operations against D1. */
import type { NamespaceRow } from "../types.js";
import { type DbHandle, withRetry } from "../db.js";
import { generateId, toJson } from "../utils.js";

export async function createNamespace(
  db: DbHandle,
  opts: { name: string; description?: string; owner?: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const id = generateId();
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
  return id;
}

export async function getNamespace(db: DbHandle, id: string): Promise<NamespaceRow | null> {
  return db.prepare(`SELECT * FROM namespaces WHERE id = ?`).bind(id).first<NamespaceRow>();
}

export async function listNamespaces(
  db: DbHandle,
  owner?: string,
  opts?: { limit?: number; offset?: number },
): Promise<NamespaceRow[]> {
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  if (owner) {
    const result = await db
      .prepare(`SELECT * FROM namespaces WHERE owner = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
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
export async function claimUnownedNamespaces(db: DbHandle, owner: string): Promise<number> {
  const result = await withRetry(() =>
    db.prepare(`UPDATE namespaces SET owner = ? WHERE owner IS NULL`).bind(owner).run(),
  );
  return result.meta.changes ?? 0;
}
