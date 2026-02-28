import type { DbHandle } from "./db.js";
import type { NamespaceRole, UserIdentity } from "./types.js";

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

function parseIdentity(raw: unknown): UserIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const groups = Array.isArray(rec.groups)
    ? rec.groups.filter((v): v is string => typeof v === "string")
    : [];
  const ownedNamespaces = Array.isArray(rec.ownedNamespaces)
    ? rec.ownedNamespaces.filter((v): v is string => typeof v === "string")
    : [];
  const directGrants = Object.fromEntries(
    Object.entries((rec.directGrants as Record<string, unknown>) ?? {}).filter(([, role]) =>
      isNamespaceRole(role),
    ) as [string, NamespaceRole][],
  );
  const groupGrants = Object.fromEntries(
    Object.entries((rec.groupGrants as Record<string, unknown>) ?? {}).filter(([, role]) =>
      isNamespaceRole(role),
    ) as [string, NamespaceRole][],
  );
  return {
    groups,
    isAdmin: Boolean(rec.isAdmin),
    ownedNamespaces,
    directGrants,
    groupGrants,
  };
}

async function loadAdminFlag(flagsKv: KVNamespace, email: string): Promise<boolean> {
  const raw = await flagsKv.get(ADMIN_KEY, { cacheTtl: IDENTITY_CACHE_TTL });
  if (!raw) return false;
  const admins = raw.split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
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
  const parsed = parseIdentity(cached);
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

  void usersKv.put(email, JSON.stringify(identity), { expirationTtl: IDENTITY_TTL });
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
