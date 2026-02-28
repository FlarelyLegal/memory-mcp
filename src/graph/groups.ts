import type { DbHandle } from "../db.js";
import { withRetry } from "../db.js";
import type { GroupMemberRow, GroupPrivacy, GroupRole, GroupRow, MemberStatus } from "../types.js";
import { generateId, now, toJson } from "../utils.js";
export { generateSlug } from "./group-slug.js";

type GroupUpdates = {
  name?: string;
  slug?: string;
  description?: string;
  privacy?: GroupPrivacy;
  settings?: Record<string, unknown>;
  parent_group_id?: string | null;
};
type ListMembersOpts = { status?: MemberStatus; limit?: number; offset?: number };

export async function createGroup(
  db: DbHandle,
  opts: {
    name: string;
    slug: string;
    description?: string;
    created_by: string;
    parent_group_id?: string | null;
  },
): Promise<string> {
  const id = generateId();
  await withRetry(() =>
    db
      .prepare(
        `INSERT INTO groups (id, name, slug, description, created_by, parent_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        opts.name,
        opts.slug,
        opts.description ?? null,
        opts.created_by,
        opts.parent_group_id ?? null,
      )
      .run(),
  );
  return id;
}

export async function getGroup(db: DbHandle, id: string): Promise<GroupRow | null> {
  return db.prepare(`SELECT * FROM groups WHERE id = ?`).bind(id).first<GroupRow>();
}
export async function getGroupBySlug(db: DbHandle, slug: string): Promise<GroupRow | null> {
  return db.prepare(`SELECT * FROM groups WHERE slug = ?`).bind(slug).first<GroupRow>();
}

export async function listUserGroups(db: DbHandle, email: string): Promise<GroupRow[]> {
  const result = await db
    .prepare(
      `SELECT g.*
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.email = ? AND gm.status = 'active' AND g.deleted_at IS NULL
       ORDER BY g.created_at DESC`,
    )
    .bind(email)
    .all<GroupRow>();
  return result.results;
}

export async function updateGroup(db: DbHandle, id: string, updates: GroupUpdates): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];
  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.slug !== undefined) {
    sets.push("slug = ?");
    params.push(updates.slug);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.privacy !== undefined) {
    sets.push("privacy = ?");
    params.push(updates.privacy);
  }
  if (updates.settings !== undefined) {
    sets.push("settings = ?");
    params.push(toJson(updates.settings));
  }
  if (updates.parent_group_id !== undefined) {
    sets.push("parent_group_id = ?");
    params.push(updates.parent_group_id);
  }
  params.push(id);
  await withRetry(() =>
    db
      .prepare(`UPDATE groups SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run(),
  );
}

export async function deleteGroup(db: DbHandle, id: string): Promise<void> {
  const ts = now();
  await withRetry(() =>
    db
      .prepare(`UPDATE groups SET deleted_at = ?, updated_at = ? WHERE id = ?`)
      .bind(ts, ts, id)
      .run(),
  );
}

export async function addGroupMember(
  db: DbHandle,
  opts: {
    group_id: string;
    email: string;
    role: GroupRole;
    invited_by?: string;
    status?: MemberStatus;
  },
): Promise<string> {
  const id = generateId();
  const ts = now();
  await withRetry(() =>
    db
      .prepare(
        `INSERT INTO group_members
         (id, group_id, email, role, status, invited_by, invited_at, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        opts.group_id,
        opts.email,
        opts.role,
        opts.status ?? "active",
        opts.invited_by ?? null,
        opts.invited_by ? ts : null,
        opts.status === "pending" ? null : ts,
      )
      .run(),
  );
  return id;
}

export async function removeGroupMember(
  db: DbHandle,
  groupId: string,
  email: string,
): Promise<void> {
  await withRetry(() =>
    db
      .prepare(`DELETE FROM group_members WHERE group_id = ? AND email = ?`)
      .bind(groupId, email)
      .run(),
  );
}

export async function updateGroupMemberRole(
  db: DbHandle,
  groupId: string,
  email: string,
  role: GroupRole,
): Promise<void> {
  await withRetry(() =>
    db
      .prepare(`UPDATE group_members SET role = ? WHERE group_id = ? AND email = ?`)
      .bind(role, groupId, email)
      .run(),
  );
}

export async function listGroupMembers(
  db: DbHandle,
  groupId: string,
  opts?: ListMembersOpts,
): Promise<GroupMemberRow[]> {
  const clauses = ["group_id = ?"];
  const params: unknown[] = [groupId];
  if (opts?.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  params.push(opts?.limit ?? 100, opts?.offset ?? 0);
  const result = await db
    .prepare(
      `SELECT * FROM group_members
       WHERE ${clauses.join(" AND ")}
       ORDER BY added_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params)
    .all<GroupMemberRow>();
  return result.results;
}

export async function getGroupMembership(
  db: DbHandle,
  groupId: string,
  email: string,
): Promise<GroupMemberRow | null> {
  return db
    .prepare(`SELECT * FROM group_members WHERE group_id = ? AND email = ?`)
    .bind(groupId, email)
    .first<GroupMemberRow>();
}

export async function getUserGroupIds(db: DbHandle, email: string): Promise<string[]> {
  const result = await db
    .prepare(`SELECT group_id FROM group_members WHERE email = ? AND status = 'active'`)
    .bind(email)
    .all<{ group_id: string }>();
  return result.results.map((r) => r.group_id);
}

export async function countGroupOwners(db: DbHandle, groupId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND role = 'owner' AND status = 'active'`,
    )
    .bind(groupId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function incrementMemberCount(
  db: DbHandle,
  groupId: string,
  delta: number,
): Promise<void> {
  await withRetry(() =>
    db
      .prepare(
        `UPDATE groups SET member_count = MAX(member_count + ?, 0), updated_at = ? WHERE id = ?`,
      )
      .bind(delta, now(), groupId)
      .run(),
  );
}
