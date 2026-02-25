/**
 * Per-user authorization helpers.
 *
 * Namespaces have an `owner` column (email). These helpers enforce that the
 * authenticated user can only access namespaces they own (or legacy unowned
 * namespaces where owner IS NULL).
 */

import type { NamespaceRow } from "./types.js";

export class AccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/**
 * Verify the authenticated user owns the given namespace.
 * Allows access to unowned (legacy) namespaces where owner IS NULL.
 */
export async function assertNamespaceAccess(
  db: D1Database,
  namespaceId: string,
  email: string,
): Promise<NamespaceRow> {
  const ns = await db
    .prepare(`SELECT * FROM namespaces WHERE id = ?`)
    .bind(namespaceId)
    .first<NamespaceRow>();

  if (!ns) {
    throw new AccessDeniedError("Namespace not found");
  }

  if (ns.owner !== null && ns.owner !== email) {
    throw new AccessDeniedError("You do not have access to this namespace");
  }

  return ns;
}

/**
 * Look up which namespace an entity belongs to, then verify access.
 */
export async function assertEntityAccess(
  db: D1Database,
  entityId: string,
  email: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT namespace_id FROM entities WHERE id = ?`)
    .bind(entityId)
    .first<{ namespace_id: string }>();

  if (!row) {
    throw new AccessDeniedError("Entity not found");
  }

  await assertNamespaceAccess(db, row.namespace_id, email);
  return row.namespace_id;
}

/**
 * Look up which namespace a memory belongs to, then verify access.
 */
export async function assertMemoryAccess(
  db: D1Database,
  memoryId: string,
  email: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT namespace_id FROM memories WHERE id = ?`)
    .bind(memoryId)
    .first<{ namespace_id: string }>();

  if (!row) {
    throw new AccessDeniedError("Memory not found");
  }

  await assertNamespaceAccess(db, row.namespace_id, email);
  return row.namespace_id;
}

/**
 * Look up which namespace a conversation belongs to, then verify access.
 */
export async function assertConversationAccess(
  db: D1Database,
  conversationId: string,
  email: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT namespace_id FROM conversations WHERE id = ?`)
    .bind(conversationId)
    .first<{ namespace_id: string }>();

  if (!row) {
    throw new AccessDeniedError("Conversation not found");
  }

  await assertNamespaceAccess(db, row.namespace_id, email);
  return row.namespace_id;
}

/**
 * Look up which namespace a relation belongs to, then verify access.
 */
export async function assertRelationAccess(
  db: D1Database,
  relationId: string,
  email: string,
): Promise<string> {
  const row = await db
    .prepare(`SELECT namespace_id FROM relations WHERE id = ?`)
    .bind(relationId)
    .first<{ namespace_id: string }>();

  if (!row) {
    throw new AccessDeniedError("Relation not found");
  }

  await assertNamespaceAccess(db, row.namespace_id, email);
  return row.namespace_id;
}
