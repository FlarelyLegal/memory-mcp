/**
 * Per-user authorization helpers.
 *
 * Namespaces have an `owner` column and a `visibility` column:
 * - `private`: only the owner can read or write.
 * - `public`: any authenticated user can read; only owner or admin can write.
 *
 * Unowned namespaces (owner IS NULL) are inaccessible — claim them first.
 */

import type { NamespaceRow } from "./types.js";
import type { DbHandle } from "./db.js";

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

// ---------------------------------------------------------------------------
// Namespace-level access checks
// ---------------------------------------------------------------------------

/** Fetch a namespace or throw. */
async function fetchNamespace(db: DbHandle, namespaceId: string): Promise<NamespaceRow> {
  const ns = await db
    .prepare(`SELECT * FROM namespaces WHERE id = ?`)
    .bind(namespaceId)
    .first<NamespaceRow>();
  if (!ns) throw new AccessDeniedError("Namespace not found");
  return ns;
}

/** Can the user read? Owner always can; public namespaces allow any authenticated user. */
function canRead(ns: NamespaceRow, email: string): boolean {
  return ns.owner === email || ns.visibility === "public";
}

/** Can the user write? Owner always can; admins can write to public namespaces. */
function canWrite(ns: NamespaceRow, email: string, admin: boolean): boolean {
  return ns.owner === email || (admin && ns.visibility === "public");
}

/**
 * Assert the user can read the namespace.
 * Allowed if: owner OR namespace is public.
 */
export async function assertNamespaceReadAccess(
  db: DbHandle,
  namespaceId: string,
  email: string,
): Promise<NamespaceRow> {
  const ns = await fetchNamespace(db, namespaceId);
  if (!canRead(ns, email)) throw new AccessDeniedError("You do not have access to this namespace");
  return ns;
}

/**
 * Assert the user can write to the namespace.
 * Allowed if: owner OR (admin AND namespace is public).
 */
export async function assertNamespaceWriteAccess(
  db: DbHandle,
  namespaceId: string,
  email: string,
  admin = false,
): Promise<NamespaceRow> {
  const ns = await fetchNamespace(db, namespaceId);
  if (!canWrite(ns, email, admin)) {
    throw new AccessDeniedError("You do not have write access to this namespace");
  }
  return ns;
}

/**
 * Legacy alias — equivalent to assertNamespaceWriteAccess without admin bypass.
 * Kept for backward compatibility; prefer the explicit read/write variants.
 */
export async function assertNamespaceAccess(
  db: DbHandle,
  namespaceId: string,
  email: string,
): Promise<NamespaceRow> {
  return assertNamespaceWriteAccess(db, namespaceId, email, false);
}

// ---------------------------------------------------------------------------
// Resource-level access checks (JOIN to namespace)
// ---------------------------------------------------------------------------

type NsJoinRow = { namespace_id: string; owner: string | null; visibility: string };

async function fetchResourceNs(
  db: DbHandle,
  table: string,
  resourceId: string,
  label: string,
): Promise<NsJoinRow> {
  const row = await db
    .prepare(
      `SELECT r.namespace_id, n.owner, n.visibility FROM ${table} r ` +
        `JOIN namespaces n ON n.id = r.namespace_id WHERE r.id = ?`,
    )
    .bind(resourceId)
    .first<NsJoinRow>();
  if (!row) throw new AccessDeniedError(`${label} not found`);
  return row;
}

/** Assert read access to a resource's namespace. */
export async function assertResourceReadAccess(
  db: DbHandle,
  table: string,
  id: string,
  label: string,
  email: string,
): Promise<string> {
  const row = await fetchResourceNs(db, table, id, label);
  if (row.owner !== email && row.visibility !== "public") {
    throw new AccessDeniedError("You do not have access to this namespace");
  }
  return row.namespace_id;
}

/** Assert write access to a resource's namespace. */
async function assertResourceWriteAccess(
  db: DbHandle,
  table: string,
  id: string,
  label: string,
  email: string,
): Promise<string> {
  const row = await fetchResourceNs(db, table, id, label);
  if (row.owner !== email) {
    throw new AccessDeniedError("You do not have write access to this namespace");
  }
  return row.namespace_id;
}

// --- Write access (owner only) ---
export function assertEntityAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceWriteAccess(db, "entities", id, "Entity", email);
}
export function assertMemoryAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceWriteAccess(db, "memories", id, "Memory", email);
}
export function assertConversationAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceWriteAccess(db, "conversations", id, "Conversation", email);
}
export function assertRelationAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceWriteAccess(db, "relations", id, "Relation", email);
}

// --- Read access (owner OR public) ---
export function assertEntityReadAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceReadAccess(db, "entities", id, "Entity", email);
}
export function assertMemoryReadAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceReadAccess(db, "memories", id, "Memory", email);
}
export function assertConversationReadAccess(
  db: DbHandle,
  id: string,
  email: string,
): Promise<string> {
  return assertResourceReadAccess(db, "conversations", id, "Conversation", email);
}
export function assertRelationReadAccess(db: DbHandle, id: string, email: string): Promise<string> {
  return assertResourceReadAccess(db, "relations", id, "Relation", email);
}
