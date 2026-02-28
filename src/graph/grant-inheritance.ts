/**
 * Grant inheritance: resolve effective grants by walking group ancestors.
 *
 * When a user belongs to group C, and C's parent is B, and B's parent is A,
 * then grants on A and B are inherited by C members. Inheritance is resolved
 * at read time -- no materialized rows.
 */
import type { DbHandle } from "../db.js";
import { NOT_EXPIRED } from "../sql.js";
import type { NamespaceRole } from "../types.js";
import { MAX_GROUP_DEPTH } from "./group-hierarchy.js";

type InheritedGrant = {
  namespace_id: string;
  group_id: string;
  role: NamespaceRole;
  inherited_from: string;
};

/**
 * For a set of group IDs, walk each group's ancestor chain and collect
 * all active grants from ancestor groups. Returns grants annotated with
 * `inherited_from` (the ancestor group that owns the grant).
 *
 * Deduplicates ancestor IDs across groups to avoid redundant queries.
 */
export async function resolveInheritedGrants(
  db: DbHandle,
  groupIds: string[],
): Promise<InheritedGrant[]> {
  if (groupIds.length === 0) return [];

  // Collect all unique ancestor group IDs across all user groups
  const ancestorSet = new Set<string>();
  const directSet = new Set(groupIds);

  for (const gid of groupIds) {
    let currentId: string | null = gid;
    for (let depth = 0; depth < MAX_GROUP_DEPTH; depth++) {
      const row: { parent_group_id: string | null } | null = await db
        .prepare(`SELECT parent_group_id FROM groups WHERE id = ? AND deleted_at IS NULL`)
        .bind(currentId!)
        .first<{ parent_group_id: string | null }>();
      if (!row?.parent_group_id) break;
      const parentId: string = row.parent_group_id;
      // Verify the parent itself is active
      const parent: { id: string } | null = await db
        .prepare(`SELECT id FROM groups WHERE id = ? AND deleted_at IS NULL`)
        .bind(parentId)
        .first<{ id: string }>();
      if (!parent) break;
      // Only add ancestors that aren't already direct memberships
      if (!directSet.has(parentId)) {
        ancestorSet.add(parentId);
      }
      currentId = parentId;
    }
  }

  if (ancestorSet.size === 0) return [];

  const ancestorIds = Array.from(ancestorSet);
  const placeholders = ancestorIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT namespace_id, group_id, role
       FROM namespace_grants
       WHERE status = 'active' AND ${NOT_EXPIRED}
         AND group_id IN (${placeholders})`,
    )
    .bind(...ancestorIds)
    .all<{ namespace_id: string; group_id: string; role: NamespaceRole }>();

  return result.results.map((r) => ({
    namespace_id: r.namespace_id,
    group_id: r.group_id,
    role: r.role,
    inherited_from: r.group_id,
  }));
}
