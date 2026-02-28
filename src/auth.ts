import { getAccessLevel } from "./identity.js";
import type { DbHandle } from "./db.js";
import type { NamespaceRow, UserIdentity } from "./types.js";

const ADMIN_KEY = "admin:emails";

/**
 * Check if an email is in the admin allowlist stored in FLAGS KV.
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

type AccessPrincipal =
  | { mode: "legacy"; email: string; admin: boolean }
  | { mode: "identity"; identity: UserIdentity };

function isUserIdentity(value: unknown): value is UserIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.groups) &&
    Array.isArray(v.ownedNamespaces) &&
    typeof v.directGrants === "object" &&
    v.directGrants !== null &&
    typeof v.groupGrants === "object" &&
    v.groupGrants !== null &&
    typeof v.isAdmin === "boolean"
  );
}

function principalFrom(identityOrEmail: UserIdentity | string, admin = false): AccessPrincipal {
  if (isUserIdentity(identityOrEmail)) return { mode: "identity", identity: identityOrEmail };
  return { mode: "legacy", email: identityOrEmail, admin };
}

async function fetchNamespace(db: DbHandle, namespaceId: string): Promise<NamespaceRow> {
  const ns = await db
    .prepare(`SELECT * FROM namespaces WHERE id = ?`)
    .bind(namespaceId)
    .first<NamespaceRow>();
  if (!ns) throw new AccessDeniedError("Namespace not found");
  return ns;
}

function canRead(ns: NamespaceRow, principal: AccessPrincipal): boolean {
  if (principal.mode === "identity") {
    return getAccessLevel(principal.identity, ns.id) >= 1 || ns.visibility === "public";
  }
  return ns.owner === principal.email || ns.visibility === "public";
}

function canWrite(ns: NamespaceRow, principal: AccessPrincipal): boolean {
  if (principal.mode === "identity") {
    return (
      getAccessLevel(principal.identity, ns.id) >= 2 ||
      (principal.identity.isAdmin && ns.visibility === "public")
    );
  }
  return ns.owner === principal.email || (principal.admin && ns.visibility === "public");
}

function canOwn(ns: NamespaceRow, principal: AccessPrincipal): boolean {
  if (principal.mode === "identity") {
    return getAccessLevel(principal.identity, ns.id) >= 3 || principal.identity.isAdmin;
  }
  return ns.owner === principal.email || principal.admin;
}

export async function assertNamespaceReadAccess(
  db: DbHandle,
  namespaceId: string,
  identityOrEmail: UserIdentity | string,
): Promise<NamespaceRow> {
  const ns = await fetchNamespace(db, namespaceId);
  if (!canRead(ns, principalFrom(identityOrEmail))) {
    throw new AccessDeniedError("You do not have access to this namespace");
  }
  return ns;
}

export async function assertNamespaceWriteAccess(
  db: DbHandle,
  namespaceId: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<NamespaceRow> {
  const ns = await fetchNamespace(db, namespaceId);
  if (!canWrite(ns, principalFrom(identityOrEmail, admin))) {
    throw new AccessDeniedError("You do not have write access to this namespace");
  }
  return ns;
}

export async function assertNamespaceOwnerAccess(
  db: DbHandle,
  namespaceId: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<NamespaceRow> {
  const ns = await fetchNamespace(db, namespaceId);
  if (!canOwn(ns, principalFrom(identityOrEmail, admin))) {
    throw new AccessDeniedError("You do not have owner access to this namespace");
  }
  return ns;
}

type NsJoinRow = { namespace_id: string; owner: string | null; visibility: string };

type ResourceTable = "entities" | "memories" | "conversations" | "relations";

async function fetchResourceNs(
  db: DbHandle,
  table: ResourceTable,
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

export async function assertResourceReadAccess(
  db: DbHandle,
  table: ResourceTable,
  id: string,
  label: string,
  identityOrEmail: UserIdentity | string,
): Promise<string> {
  const principal = principalFrom(identityOrEmail);
  const row = await fetchResourceNs(db, table, id, label);
  const canReadResource =
    principal.mode === "identity"
      ? getAccessLevel(principal.identity, row.namespace_id) >= 1 || row.visibility === "public"
      : row.owner === principal.email || row.visibility === "public";
  if (!canReadResource) {
    throw new AccessDeniedError("You do not have access to this namespace");
  }
  return row.namespace_id;
}

async function assertResourceWriteAccess(
  db: DbHandle,
  table: ResourceTable,
  id: string,
  label: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<string> {
  const principal = principalFrom(identityOrEmail, admin);
  const row = await fetchResourceNs(db, table, id, label);
  const canWriteResource =
    principal.mode === "identity"
      ? getAccessLevel(principal.identity, row.namespace_id) >= 2 ||
        (principal.identity.isAdmin && row.visibility === "public")
      : row.owner === principal.email || (principal.admin && row.visibility === "public");
  if (!canWriteResource) {
    throw new AccessDeniedError("You do not have write access to this namespace");
  }
  return row.namespace_id;
}

export function assertEntityAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<string> {
  return assertResourceWriteAccess(db, "entities", id, "Entity", identityOrEmail, admin);
}
export function assertMemoryAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<string> {
  return assertResourceWriteAccess(db, "memories", id, "Memory", identityOrEmail, admin);
}
export function assertConversationAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<string> {
  return assertResourceWriteAccess(db, "conversations", id, "Conversation", identityOrEmail, admin);
}
export function assertRelationAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
  admin = false,
): Promise<string> {
  return assertResourceWriteAccess(db, "relations", id, "Relation", identityOrEmail, admin);
}

export function assertEntityReadAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
): Promise<string> {
  return assertResourceReadAccess(db, "entities", id, "Entity", identityOrEmail);
}
export function assertMemoryReadAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
): Promise<string> {
  return assertResourceReadAccess(db, "memories", id, "Memory", identityOrEmail);
}
export function assertConversationReadAccess(
  db: DbHandle,
  id: string,
  identityOrEmail: UserIdentity | string,
): Promise<string> {
  return assertResourceReadAccess(db, "conversations", id, "Conversation", identityOrEmail);
}
