/**
 * Unit tests for group hierarchy: cycle detection, ancestor/descendant walks,
 * and parent validation.
 */
import { describe, expect, it } from "vitest";
import {
  walkAncestors,
  walkDescendants,
  validateParentGroup,
  MAX_GROUP_DEPTH,
} from "../../src/graph/group-hierarchy.js";

type GroupRecord = { id: string; parent_group_id: string | null; deleted_at: number | null };

/** Build a mock DB from a map of group records. */
function makeDb(groups: Map<string, GroupRecord>) {
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
          const parentId = params[0] as string;
          const children = [...groups.values()].filter(
            (g) => g.parent_group_id === parentId && g.deleted_at === null,
          );
          return { results: children.map((g) => ({ id: g.id })) as T[] };
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

function g(id: string, parent: string | null = null, deleted = false): GroupRecord {
  return { id, parent_group_id: parent, deleted_at: deleted ? 1 : null };
}

describe("group-hierarchy", () => {
  describe("walkAncestors", () => {
    it("returns empty for root group", async () => {
      const db = makeDb(new Map([["root", g("root")]]));
      expect(await walkAncestors(db as never, "root")).toEqual([]);
    });

    it("walks parent chain: C -> B -> A", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b", "a")],
          ["c", g("c", "b")],
        ]),
      );
      expect(await walkAncestors(db as never, "c")).toEqual(["b", "a"]);
    });

    it("stops at deleted ancestor", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b", "a", true)],
          ["c", g("c", "b")],
        ]),
      );
      // b is deleted, so walking from c stops (b not found as active)
      expect(await walkAncestors(db as never, "c")).toEqual([]);
    });
  });

  describe("walkDescendants", () => {
    it("returns empty for leaf group", async () => {
      const db = makeDb(new Map([["leaf", g("leaf")]]));
      expect(await walkDescendants(db as never, "leaf")).toEqual([]);
    });

    it("finds all descendants via BFS", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b", "a")],
          ["c", g("c", "a")],
          ["d", g("d", "b")],
        ]),
      );
      const desc = await walkDescendants(db as never, "a");
      expect(desc).toContain("b");
      expect(desc).toContain("c");
      expect(desc).toContain("d");
      expect(desc).toHaveLength(3);
    });

    it("excludes deleted descendants", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b", "a", true)],
          ["c", g("c", "a")],
        ]),
      );
      expect(await walkDescendants(db as never, "a")).toEqual(["c"]);
    });
  });

  describe("validateParentGroup", () => {
    it("accepts null parent (detach)", async () => {
      const db = makeDb(new Map([["x", g("x", "y")]]));
      const result = await validateParentGroup(db as never, "x", null);
      expect(result).toEqual({ ok: true });
    });

    it("rejects self-referential parent", async () => {
      const db = makeDb(new Map([["x", g("x")]]));
      const result = await validateParentGroup(db as never, "x", "x");
      expect(result).toEqual({
        ok: false,
        code: 409,
        message: "Group cannot be its own parent",
      });
    });

    it("rejects nonexistent parent", async () => {
      const db = makeDb(new Map([["x", g("x")]]));
      const result = await validateParentGroup(db as never, "x", "missing");
      expect(result).toEqual({
        ok: false,
        code: 400,
        message: "Parent group not found",
      });
    });

    it("rejects deleted parent", async () => {
      const db = makeDb(
        new Map([
          ["x", g("x")],
          ["y", g("y", null, true)],
        ]),
      );
      const result = await validateParentGroup(db as never, "x", "y");
      expect(result).toEqual({
        ok: false,
        code: 400,
        message: "Parent group not found",
      });
    });

    it("rejects A->B->A cycle", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a", "b")],
          ["b", g("b", "a")],
        ]),
      );
      // Trying to set b as parent of a -- but a is already a descendant of... wait.
      // a currently has parent b. We want to set a's parent to b -- that's already the case.
      // The cycle test: b has parent a. Setting a's parent to b would create A->B->A.
      // walkDescendants(a) = [b] (since b.parent = a). So b is a descendant of a.
      // Setting parent of a to b: parentId=b is in descendants of a -> reject.
      const result = await validateParentGroup(db as never, "a", "b");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(409);
        expect(result.message).toContain("Circular reference");
      }
    });

    it("rejects deep cycle A->B->C->A", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b", "a")],
          ["c", g("c", "b")],
        ]),
      );
      // c is descendant of a. Setting a's parent to c would create cycle.
      const result = await validateParentGroup(db as never, "a", "c");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(409);
    });

    it("accepts valid reparenting", async () => {
      const db = makeDb(
        new Map([
          ["a", g("a")],
          ["b", g("b")],
          ["c", g("c", "b")],
        ]),
      );
      // Setting c's parent to a (c has no descendants, a is not a descendant of c)
      const result = await validateParentGroup(db as never, "c", "a");
      expect(result).toEqual({ ok: true });
    });

    it("rejects depth exceeding MAX_GROUP_DEPTH", async () => {
      // Build a chain of MAX_GROUP_DEPTH groups: g0 -> g1 -> ... -> g(MAX-1)
      const groups = new Map<string, GroupRecord>();
      for (let i = 0; i < MAX_GROUP_DEPTH; i++) {
        groups.set(`g${i}`, g(`g${i}`, i > 0 ? `g${i - 1}` : null));
      }
      // Add a leaf at the bottom
      groups.set("leaf", g("leaf", `g${MAX_GROUP_DEPTH - 1}`));
      // Add a new group to attach as parent of g0 -- this would make depth MAX+2
      groups.set("top", g("top"));
      const db = makeDb(groups);
      // Trying to set g0's parent to "top" -- chain would be top -> g0 -> g1 -> ... -> leaf
      const result = await validateParentGroup(db as never, "g0", "top");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(400);
        expect(result.message).toContain("depth");
      }
    });
  });
});
