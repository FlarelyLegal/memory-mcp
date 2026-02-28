import type { DbHandle } from "./db.js";
import type { NamespaceRole, UserIdentity } from "./types.js";
import { decodeAdminEmails, decodeIdentity, encodeIdentity } from "./kv.js";

const ADMIN_KEY = "admin:emails";
const IDENTITY_TTL = 300;
const IDENTITY_CACHE_TTL = 30;

const ROLE_LEVEL: Record<NamespaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

type GrantRow = {
  namespace_id: string;
  email: string | null;
  group_id: string | null;
  role: NamespaceRole;
};

function maxRole(a: NamespaceRole | undefined, b: NamespaceRole): NamespaceRole {
  if (!a) return b;
  return ROLE_LEVEL[b] > ROLE_LEVEL[a] ? b : a;
}

function isNamespaceRole(v: unknown): v is NamespaceRole {
  return v === "viewer" || v === "editor" || v === "owner";
}

async function loadAdminFlag(flagsKv: KVNamespace, email: string): Promise<boolean> {
  const raw = await flagsKv.get(ADMIN_KEY, { cacheTtl: IDENTITY_CACHE_TTL });
  return decodeAdminEmails(raw).includes(email.toLowerCase());
}

function coalesceIdentity(
  groups: string[],
  ownedNamespaces: string[],
  grants: GrantRow[],
  isAdmin: boolean,
): UserIdentity {
  const directGrants: Record<string, NamespaceRole> = {};
  const groupGrants: Record<string, NamespaceRole> = {};
  for (const grant of grants) {
    if (!isNamespaceRole(grant.role)) continue;
    if (grant.email) {
      directGrants[grant.namespace_id] = maxRole(directGrants[grant.namespace_id], grant.role);
      continue;
    }
    if (grant.group_id) {
      groupGrants[grant.namespace_id] = maxRole(groupGrants[grant.namespace_id], grant.role);
    }
  }
  return {
    groups,
    isAdmin,
    ownedNamespaces,
    directGrants,
    groupGrants,
  };
}

export async function loadIdentity(
  db: DbHandle,
  usersKv: KVNamespace,
  flagsKv: KVNamespace,
  email: string,
): Promise<UserIdentity> {
  const cached = await usersKv.get<UserIdentity>(email, {
    type: "json",
    cacheTtl: IDENTITY_CACHE_TTL,
  });
  const parsed = decodeIdentity(cached);
  if (parsed) return parsed;

  const [groupsResult, grantsResult, ownedResult] = await db.batch([
    db
      .prepare(`SELECT group_id FROM group_members WHERE email = ? AND status = 'active'`)
      .bind(email),
    db
      .prepare(
        `SELECT namespace_id, email, group_id, role
         FROM namespace_grants
         WHERE status = 'active'
           AND (
             email = ? OR
             group_id IN (
               SELECT group_id FROM group_members WHERE email = ? AND status = 'active'
             )
           )`,
      )
      .bind(email, email),
    db.prepare(`SELECT id FROM namespaces WHERE owner = ?`).bind(email),
  ]);

  const groups = (groupsResult.results as { group_id: string }[]).map((r) => r.group_id);
  const grants = grantsResult.results as GrantRow[];
  const ownedNamespaces = (ownedResult.results as { id: string }[]).map((r) => r.id);
  const isAdmin = await loadAdminFlag(flagsKv, email);
  const identity = coalesceIdentity(groups, ownedNamespaces, grants, isAdmin);

  void usersKv.put(email, encodeIdentity(identity), { expirationTtl: IDENTITY_TTL });
  return identity;
}

export function getAccessLevel(identity: UserIdentity, namespaceId: string): number {
  let level = 0;
  if (identity.ownedNamespaces.includes(namespaceId)) level = 3;
  const directRole = identity.directGrants[namespaceId];
  if (directRole) level = Math.max(level, ROLE_LEVEL[directRole]);
  const groupRole = identity.groupGrants[namespaceId];
  if (groupRole) level = Math.max(level, ROLE_LEVEL[groupRole]);
  return level;
}

export function hasReadAccess(identity: UserIdentity, namespaceId: string): boolean {
  return getAccessLevel(identity, namespaceId) >= 1;
}

export function hasWriteAccess(identity: UserIdentity, namespaceId: string): boolean {
  return getAccessLevel(identity, namespaceId) >= 2;
}

export function hasOwnerAccess(identity: UserIdentity, namespaceId: string): boolean {
  return getAccessLevel(identity, namespaceId) >= 3;
}
