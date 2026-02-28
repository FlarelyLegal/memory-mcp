import type { DbHandle } from "../db.js";
import * as graph from "../graph/index.js";
import type { GroupRole } from "../types.js";

export const ADMIN_ROLES: GroupRole[] = ["owner", "admin"];

export async function resolveGroup(db: DbHandle, id?: string, slug?: string) {
  if (!id && !slug) return null;
  const group = id ? await graph.getGroup(db, id) : await graph.getGroupBySlug(db, slug as string);
  if (!group || group.deleted_at) return null;
  return group;
}

export async function requireMembership(
  db: DbHandle,
  groupId: string,
  email: string,
  allowed?: GroupRole[],
) {
  const membership = await graph.getGroupMembership(db, groupId, email);
  if (!membership || membership.status !== "active") return null;
  if (allowed && !allowed.includes(membership.role)) return null;
  return membership;
}
