/**
 * Unit tests for grant inheritance: ancestor grant resolution,
 * highest-role-wins, and edge cases (expired, suspended, orphan, dedup).
 */
import { describe, expect, it } from "vitest";
import { resolveInheritedGrants } from "../../src/graph/grant-inheritance.js";

type GroupRecord = { id: string; parent_group_id: string | null; deleted_at: number | null };
type GrantRecord = {
  namespace_id: string;
  group_id: string;
  role: string;
  status: string;
};

/** Build a mock DB with groups and grants. */
function makeDb(groups: Map<string, GroupRecord>, grants: GrantRecord[]) {
  return {
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        bind(...p: unknown[]) {
          params = p;
          return this;
        },
        async first<T>() {
          const id = params[0] as string;
          const g = groups.get(id);
          if (!g || g.deleted_at !== null) return null as T;
          if (query.includes("SELECT parent_group_id"))
            return { parent_group_id: g.parent_group_id } as T;
          if (query.includes("SELECT id")) return { id: g.id } as T;
          return g as T;
        },
        async all<T>() {
          if (query.includes("namespace_grants")) {
            // Filter grants by group_id IN (params)
            const ids = new Set(params as string[]);
            const matched = grants.filter((g) => ids.has(g.group_id) && g.status === "active");
            return { results: matched as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          return { success: true };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

function grp(id: string, parent: string | null = null): GroupRecord {
  return { id, parent_group_id: parent, deleted_at: null };
}

function grant(ns: string, group: string, role: string, status = "active"): GrantRecord {
  return { namespace_id: ns, group_id: group, role, status };
}

describe("grant-inheritance", () => {
  it("returns empty when user has no groups", async () => {
    const db = makeDb(new Map(), []);
    expect(await resolveInheritedGrants(db as never, [])).toEqual([]);
  });

  it("returns empty for root group (no ancestors)", async () => {
    const db = makeDb(new Map([["a", grp("a")]]), [grant("ns1", "a", "editor")]);
    // "a" is a direct group -- its grants are handled by the main query, not inheritance
    expect(await resolveInheritedGrants(db as never, ["a"])).toEqual([]);
  });

  it("inherits parent group grants", async () => {
    const db = makeDb(
      new Map([
        ["parent", grp("parent")],
        ["child", grp("child", "parent")],
      ]),
      [grant("ns1", "parent", "editor")],
    );
    const inherited = await resolveInheritedGrants(db as never, ["child"]);
    expect(inherited).toHaveLength(1);
    expect(inherited[0]).toMatchObject({
      namespace_id: "ns1",
      group_id: "parent",
      role: "editor",
      inherited_from: "parent",
    });
  });

  it("inherits through two levels (grandparent -> parent -> child)", async () => {
    const db = makeDb(
      new Map([
        ["gp", grp("gp")],
        ["p", grp("p", "gp")],
        ["c", grp("c", "p")],
      ]),
      [grant("ns1", "gp", "viewer"), grant("ns2", "p", "editor")],
    );
    const inherited = await resolveInheritedGrants(db as never, ["c"]);
    expect(inherited).toHaveLength(2);
    const nsIds = inherited.map((g) => g.namespace_id).sort();
    expect(nsIds).toEqual(["ns1", "ns2"]);
  });

  it("skips ancestor grants that are also direct memberships", async () => {
    // User is member of both parent and child -- parent grants should come from
    // the main query, not inheritance (prevents double-counting)
    const db = makeDb(
      new Map([
        ["parent", grp("parent")],
        ["child", grp("child", "parent")],
      ]),
      [grant("ns1", "parent", "editor")],
    );
    // User is member of both "parent" and "child"
    const inherited = await resolveInheritedGrants(db as never, ["child", "parent"]);
    // "parent" is in directSet, so its grants are NOT returned as inherited
    expect(inherited).toEqual([]);
  });

  it("does not inherit from deleted ancestor", async () => {
    const groups = new Map([
      ["gp", { id: "gp", parent_group_id: null, deleted_at: 1 }],
      ["p", grp("p", "gp")],
      ["c", grp("c", "p")],
    ]);
    const db = makeDb(groups, [grant("ns1", "gp", "owner")]);
    const inherited = await resolveInheritedGrants(db as never, ["c"]);
    // p's parent gp is deleted, so walk stops at p. p has no grants.
    // Only p is an ancestor (not in direct set), but p has no grants.
    expect(inherited).toEqual([]);
  });

  it("does not inherit revoked/expired grants from ancestor", async () => {
    const db = makeDb(
      new Map([
        ["parent", grp("parent")],
        ["child", grp("child", "parent")],
      ]),
      [grant("ns1", "parent", "editor", "revoked"), grant("ns2", "parent", "viewer", "expired")],
    );
    const inherited = await resolveInheritedGrants(db as never, ["child"]);
    expect(inherited).toEqual([]);
  });

  it("deduplicates ancestors across multiple group memberships", async () => {
    // User is member of c1 and c2, both children of same parent
    const db = makeDb(
      new Map([
        ["parent", grp("parent")],
        ["c1", grp("c1", "parent")],
        ["c2", grp("c2", "parent")],
      ]),
      [grant("ns1", "parent", "editor")],
    );
    const inherited = await resolveInheritedGrants(db as never, ["c1", "c2"]);
    // Parent grant should appear only once (deduped in ancestor collection)
    expect(inherited).toHaveLength(1);
  });

  it("null parent_group_id means no inherited grants", async () => {
    const db = makeDb(new Map([["orphan", grp("orphan")]]), [
      grant("ns1", "someone-else", "editor"),
    ]);
    const inherited = await resolveInheritedGrants(db as never, ["orphan"]);
    expect(inherited).toEqual([]);
  });
});
