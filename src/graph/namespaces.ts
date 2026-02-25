/** Namespace CRUD operations against D1. */
import type { NamespaceRow } from "../types.js";
import { generateId, toJson } from "../utils.js";

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
