/**
 * Group hierarchy utilities: ancestor walk, cycle detection, child discovery.
 *
 * Groups form a tree via `parent_group_id` (FK to self, ON DELETE SET NULL).
 * Max depth is capped at 10 levels to prevent unbounded recursion.
 */
import type { DbHandle } from "../db.js";

/** Hard cap on hierarchy depth. Reject if exceeded. */
export const MAX_GROUP_DEPTH = 10;

/**
 * Walk the ancestor chain from a group up to the root (or depth cap).
 * Returns an ordered array of ancestor group IDs (parent first, root last).
 * Does NOT include the starting group itself.
 */
export async function walkAncestors(db: DbHandle, groupId: string): Promise<string[]> {
  const ancestors: string[] = [];
  let currentId: string | null = groupId;

  for (let i = 0; i < MAX_GROUP_DEPTH; i++) {
    // Look up current node to find its parent
    const row: { parent_group_id: string | null } | null = await db
      .prepare(`SELECT parent_group_id FROM groups WHERE id = ? AND deleted_at IS NULL`)
      .bind(currentId!)
      .first<{ parent_group_id: string | null }>();
    if (!row?.parent_group_id) break;
    const parentId: string = row.parent_group_id;
    // Verify the parent itself exists and is active
    const parent: { id: string } | null = await db
      .prepare(`SELECT id FROM groups WHERE id = ? AND deleted_at IS NULL`)
      .bind(parentId)
      .first<{ id: string }>();
    if (!parent) break;
    ancestors.push(parentId);
    currentId = parentId;
  }
  return ancestors;
}

/**
 * Collect all descendant group IDs (children, grandchildren, etc.) via
 * iterative BFS. Does NOT include the starting group itself.
 */
export async function walkDescendants(db: DbHandle, groupId: string): Promise<string[]> {
  const descendants: string[] = [];
  const queue = [groupId];
  const visited = new Set<string>([groupId]);

  while (queue.length > 0 && descendants.length < 200) {
    const current = queue.shift()!;
    const rows = await db
      .prepare(`SELECT id FROM groups WHERE parent_group_id = ? AND deleted_at IS NULL`)
      .bind(current)
      .all<{ id: string }>();
    for (const row of rows.results) {
      if (!visited.has(row.id)) {
        visited.add(row.id);
        descendants.push(row.id);
        queue.push(row.id);
      }
    }
  }
  return descendants;
}

export type ParentValidation = { ok: true } | { ok: false; code: 400 | 409; message: string };

/**
 * Validate that setting `parentId` as the parent of `groupId` is safe:
 * - Not self-referential (groupId === parentId)
 * - parentId exists and is not deleted
 * - parentId is not a descendant of groupId (would create a cycle)
 * - Resulting depth does not exceed MAX_GROUP_DEPTH
 *
 * If parentId is null, always valid (detaching from parent).
 */
export async function validateParentGroup(
  db: DbHandle,
  groupId: string,
  parentId: string | null,
): Promise<ParentValidation> {
  if (parentId === null) return { ok: true };

  if (groupId === parentId) {
    return { ok: false, code: 409, message: "Group cannot be its own parent" };
  }

  // Verify parent exists
  const parent = await db
    .prepare(`SELECT id FROM groups WHERE id = ? AND deleted_at IS NULL`)
    .bind(parentId)
    .first<{ id: string }>();
  if (!parent) {
    return { ok: false, code: 400, message: "Parent group not found" };
  }

  // Check that parentId is not a descendant of groupId (would create cycle)
  const descendants = await walkDescendants(db, groupId);
  if (descendants.includes(parentId)) {
    return {
      ok: false,
      code: 409,
      message: "Circular reference: proposed parent is a descendant of this group",
    };
  }

  // Check total depth: ancestors of parentId + parentId itself + groupId + descendants of groupId
  const ancestorsOfParent = await walkAncestors(db, parentId);
  const maxDescendantDepth = await getMaxDescendantDepth(db, groupId);
  // Total depth = ancestors above parent + parent + groupId + deepest descendant path
  const totalDepth = ancestorsOfParent.length + 1 + 1 + maxDescendantDepth;
  if (totalDepth > MAX_GROUP_DEPTH) {
    return {
      ok: false,
      code: 400,
      message: `Hierarchy depth would exceed maximum of ${MAX_GROUP_DEPTH} levels`,
    };
  }

  return { ok: true };
}

/**
 * Get the maximum depth of descendants below a group.
 * Returns 0 if the group has no children.
 */
async function getMaxDescendantDepth(db: DbHandle, groupId: string): Promise<number> {
  let maxDepth = 0;
  const queue: Array<{ id: string; depth: number }> = [{ id: groupId, depth: 0 }];
  const visited = new Set<string>([groupId]);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const rows = await db
      .prepare(`SELECT id FROM groups WHERE parent_group_id = ? AND deleted_at IS NULL`)
      .bind(id)
      .all<{ id: string }>();
    for (const row of rows.results) {
      if (!visited.has(row.id)) {
        visited.add(row.id);
        const childDepth = depth + 1;
        if (childDepth > maxDepth) maxDepth = childDepth;
        queue.push({ id: row.id, depth: childDepth });
      }
    }
  }
  return maxDepth;
}

/**
 * Get direct child group IDs (one level only).
 */
export async function getChildGroupIds(db: DbHandle, groupId: string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT id FROM groups WHERE parent_group_id = ? AND deleted_at IS NULL`)
    .bind(groupId)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}
