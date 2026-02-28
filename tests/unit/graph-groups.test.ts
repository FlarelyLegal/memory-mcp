import { describe, expect, it } from "vitest";
import {
  addGroupMember,
  countGroupOwners,
  createGroup,
  deleteGroup,
  generateSlug,
  getGroup,
  getGroupBySlug,
  getGroupMembership,
  getUserGroupIds,
  incrementMemberCount,
  listGroupMembers,
  removeGroupMember,
  updateGroup,
  updateGroupMemberRole,
} from "../../src/graph/groups.js";

type Group = Record<string, unknown>;
type Member = {
  id: string;
  group_id: string;
  email: string;
  role: string;
  status: string;
  added_at: number;
};

function makeDb() {
  const groups = new Map<string, Group>();
  const members = new Map<string, Member>();
  const now = () => Math.floor(Date.now() / 1000);

  const db = {
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        bind(...p: unknown[]) {
          params = p;
          return this;
        },
        async run() {
          if (query.startsWith("INSERT INTO groups")) {
            const [id, name, slug, description, created_by] = params as string[];
            groups.set(id, {
              id,
              name,
              slug,
              description,
              created_by,
              privacy: "visible",
              member_count: 0,
              created_at: now(),
              updated_at: now(),
              deleted_at: null,
            });
            return { success: true };
          }
          if (query.startsWith("UPDATE groups SET member_count")) {
            const [delta, , id] = params as [number, number, string];
            const g = groups.get(id)!;
            g.member_count = Math.max((g.member_count as number) + delta, 0);
            return { success: true };
          }
          if (query.startsWith("UPDATE groups SET deleted_at")) {
            const [deletedAt, updatedAt, id] = params as [number, number, string];
            const g = groups.get(id)!;
            g.deleted_at = deletedAt;
            g.updated_at = updatedAt;
            return { success: true };
          }
          if (query.startsWith("UPDATE groups SET")) {
            const id = params[params.length - 1] as string;
            const g = groups.get(id)!;
            if (query.includes("name = ?")) g.name = params[1];
            if (query.includes("slug = ?")) g.slug = params[query.includes("name = ?") ? 2 : 1];
            return { success: true };
          }
          if (query.startsWith("INSERT INTO group_members")) {
            const [id, group_id, email, role, status] = params as [
              string,
              string,
              string,
              string,
              string,
            ];
            members.set(`${group_id}:${email}`, {
              id,
              group_id,
              email,
              role,
              status,
              added_at: now(),
            });
            return { success: true };
          }
          if (query.startsWith("DELETE FROM group_members")) {
            const [groupId, email] = params as [string, string];
            members.delete(`${groupId}:${email}`);
            return { success: true };
          }
          if (query.startsWith("UPDATE group_members SET role")) {
            const [role, groupId, email] = params as [string, string, string];
            const m = members.get(`${groupId}:${email}`)!;
            m.role = role;
            return { success: true };
          }
          return { success: true };
        },
        async first<T>() {
          if (query.includes("FROM groups WHERE id = ?"))
            return (groups.get(params[0] as string) ?? null) as T | null;
          if (query.includes("FROM groups WHERE slug = ?")) {
            const found = [...groups.values()].find((g) => g.slug === params[0]);
            return (found ?? null) as T | null;
          }
          if (query.includes("FROM group_members WHERE group_id = ? AND email = ?")) {
            return (members.get(`${params[0]}:${params[1]}`) ?? null) as T | null;
          }
          if (query.includes("COUNT(*) AS count")) {
            const groupId = params[0] as string;
            const count = [...members.values()].filter(
              (m) => m.group_id === groupId && m.role === "owner" && m.status === "active",
            ).length;
            return { count } as T;
          }
          if (query.includes("SELECT id FROM groups WHERE slug = ?")) {
            const found = [...groups.values()].find((g) => g.slug === params[0]);
            return (found ? ({ id: found.id } as T) : null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (query.includes("FROM group_members") && query.includes("status = 'active'")) {
            const email = params[0] as string;
            const rows = [...members.values()]
              .filter((m) => m.email === email && m.status === "active")
              .map((m) => ({ group_id: m.group_id }));
            return { results: rows as T[] };
          }
          if (query.includes("SELECT * FROM group_members")) {
            const groupId = params[0] as string;
            const rows = [...members.values()].filter((m) => m.group_id === groupId);
            return { results: rows as T[] };
          }
          return { results: [] as T[] };
        },
      };
    },
    async batch() {
      return [];
    },
  };

  return db;
}

describe("graph/groups", () => {
  it("creates and reads groups", async () => {
    const db = makeDb();
    const id = await createGroup(db as never, {
      name: "Team One",
      slug: "team-one",
      description: "desc",
      created_by: "user@memory.flarelylegal.com",
    });
    const byId = await getGroup(db as never, id);
    const bySlug = await getGroupBySlug(db as never, "team-one");
    expect(byId?.name).toBe("Team One");
    expect(bySlug?.id).toBe(id);
  });

  it("updates and soft deletes groups", async () => {
    const db = makeDb();
    const id = await createGroup(db as never, {
      name: "Old",
      slug: "old",
      created_by: "user@memory.flarelylegal.com",
    });
    await updateGroup(db as never, id, { name: "New", slug: "new" });
    expect((await getGroup(db as never, id))?.name).toBe("New");
    await deleteGroup(db as never, id);
    expect((await getGroup(db as never, id))?.deleted_at).not.toBeNull();
  });

  it("manages members and owner counts", async () => {
    const db = makeDb();
    const gid = await createGroup(db as never, {
      name: "Owners",
      slug: "owners",
      created_by: "user@memory.flarelylegal.com",
    });
    await addGroupMember(db as never, {
      group_id: gid,
      email: "a@x.com",
      role: "owner",
      status: "active",
    });
    await addGroupMember(db as never, {
      group_id: gid,
      email: "b@x.com",
      role: "member",
      status: "active",
    });
    await incrementMemberCount(db as never, gid, 2);
    expect(await countGroupOwners(db as never, gid)).toBe(1);
    await updateGroupMemberRole(db as never, gid, "b@x.com", "owner");
    expect(await countGroupOwners(db as never, gid)).toBe(2);
    await removeGroupMember(db as never, gid, "a@x.com");
    expect(await getGroupMembership(db as never, gid, "a@x.com")).toBeNull();
    expect((await listGroupMembers(db as never, gid)).length).toBe(1);
    expect((await getUserGroupIds(db as never, "b@x.com"))[0]).toBe(gid);
  });

  it("generates unique slugs", async () => {
    const db = makeDb();
    await createGroup(db as never, {
      name: "User Name",
      slug: "user-name",
      created_by: "user@memory.flarelylegal.com",
    });
    await createGroup(db as never, {
      name: "User Name",
      slug: "user-name-2",
      created_by: "user@memory.flarelylegal.com",
    });
    const next = await generateSlug(db as never, "User Name");
    expect(next).toBe("user-name-3");
  });
});
