import type { DbHandle } from "./db.js";
import { listNamespaceGrants, walkDescendants } from "./graph/index.js";

export async function bustIdentityCache(usersKv: KVNamespace, email: string): Promise<void> {
  await usersKv.delete(email);
}

export async function bustIdentityCaches(usersKv: KVNamespace, emails: string[]): Promise<void> {
  const unique = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  await Promise.all(unique.map((email) => usersKv.delete(email)));
}

export async function bustIdentityCacheForGroup(
  db: DbHandle,
  usersKv: KVNamespace,
  groupId: string,
): Promise<void> {
  const rows = await db
    .prepare(`SELECT email FROM group_members WHERE group_id = ? AND status = 'active'`)
    .bind(groupId)
    .all<{ email: string }>();
  const members = rows.results as { email: string }[];
  await Promise.all(members.map((member) => usersKv.delete(member.email)));
}

/**
 * Bust identity cache for all members of a group and all its descendants.
 * Used when hierarchy changes (reparenting, deletion) affect inherited grants.
 */
export async function bustIdentityCacheForGroupTree(
  db: DbHandle,
  usersKv: KVNamespace,
  groupId: string,
): Promise<void> {
  const descendants = await walkDescendants(db, groupId);
  const allGroupIds = [groupId, ...descendants];
  await Promise.all(allGroupIds.map((gid) => bustIdentityCacheForGroup(db, usersKv, gid)));
}

export async function bustIdentityCacheForNamespace(
  db: DbHandle,
  usersKv: KVNamespace,
  namespaceId: string,
  includeEmails: string[] = [],
): Promise<void> {
  const grants = await listNamespaceGrants(db, namespaceId);
  const emails = new Set(includeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const groups = new Set<string>();
  for (const grant of grants) {
    if (grant.email) emails.add(grant.email.toLowerCase());
    if (grant.group_id) groups.add(grant.group_id);
  }
  await Promise.all(
    Array.from(groups).map((groupId) => bustIdentityCacheForGroup(db, usersKv, groupId)),
  );
  await bustIdentityCaches(usersKv, Array.from(emails));
}
