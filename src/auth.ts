/**
 * Per-user authorization helpers.
 *
 * Namespaces have an `owner` column (email). These helpers enforce that the
 * authenticated user can only access namespaces they own. Unowned namespaces
 * must be claimed via the claim_namespaces admin action before use.
 */

import type { NamespaceRow } from "./types.js";

const ADMIN_KEY = "admin:emails";

/**
 * Check if an email is in the admin allowlist stored in KV.
 * Key: `admin:emails`, value: comma-separated emails.
 * Returns false when the key is missing (fail-closed).
 */
export async function isAdmin(kv: KVNamespace, email: string): Promise<boolean> {
  const raw = await kv.get(ADMIN_KEY);
  if (!raw) return false;
  const admins = raw.split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export class AccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/**
 * Verify the authenticated user owns the given namespace.
 * Unowned namespaces (owner IS NULL) are inaccessible — claim them first.
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

  if (ns.owner !== email) {
    throw new AccessDeniedError("You do not have access to this namespace");
  }

  return ns;
}

/**
 * Generic: look up a resource's namespace and verify ownership in a single JOIN.
 * Returns the namespace_id on success.
 */
async function assertResourceAccess(
  db: D1Database,
  table: string,
  resourceId: string,
  resourceLabel: string,
  email: string,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT r.namespace_id, n.owner FROM ${table} r ` +
        `JOIN namespaces n ON n.id = r.namespace_id WHERE r.id = ?`,
    )
    .bind(resourceId)
    .first<{ namespace_id: string; owner: string | null }>();

  if (!row) throw new AccessDeniedError(`${resourceLabel} not found`);
  if (row.owner !== email) throw new AccessDeniedError("You do not have access to this namespace");
  return row.namespace_id;
}

/** Look up which namespace an entity belongs to, then verify access. */
export function assertEntityAccess(db: D1Database, id: string, email: string): Promise<string> {
  return assertResourceAccess(db, "entities", id, "Entity", email);
}

/** Look up which namespace a memory belongs to, then verify access. */
export function assertMemoryAccess(db: D1Database, id: string, email: string): Promise<string> {
  return assertResourceAccess(db, "memories", id, "Memory", email);
}

/** Look up which namespace a conversation belongs to, then verify access. */
export function assertConversationAccess(
  db: D1Database,
  id: string,
  email: string,
): Promise<string> {
  return assertResourceAccess(db, "conversations", id, "Conversation", email);
}

/** Look up which namespace a relation belongs to, then verify access. */
export function assertRelationAccess(db: D1Database, id: string, email: string): Promise<string> {
  return assertResourceAccess(db, "relations", id, "Relation", email);
}
