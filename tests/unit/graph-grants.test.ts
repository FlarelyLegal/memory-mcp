import { describe, expect, it } from "vitest";
import {
  getNamespaceGrant,
  grantAccess,
  listAllNamespaceGrants,
  listNamespaceGrants,
  revokeAccess,
  revokeAccessByPrincipal,
} from "../../src/graph/grants.js";

type Grant = {
  id: string;
  namespace_id: string;
  email: string | null;
  group_id: string | null;
  role: string;
  status: string;
  revoked_by: string | null;
};

function makeDb() {
  const grants = new Map<string, Grant>();
  const byPrincipal = (ns: string, email?: string, groupId?: string) =>
    [...grants.values()].find(
      (g) =>
        g.namespace_id === ns &&
        g.status === "active" &&
        g.email === (email ?? null) &&
        g.group_id === (groupId ?? null),
    );

  const db = {
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        bind(...p: unknown[]) {
          params = p;
          return this;
        },
        async run() {
          if (query.startsWith("INSERT INTO namespace_grants")) {
            const [id, ns, email, groupId, role] = params as [
              string,
              string,
              string | null,
              string | null,
              string,
            ];
            grants.set(id, {
              id,
              namespace_id: ns,
              email,
              group_id: groupId,
              role,
              status: "active",
              revoked_by: null,
            });
            return { success: true };
          }
          if (query.includes("SET role = ?")) {
            const [role, , , , id] = params as [
              string,
              number | null,
              string | null,
              number,
              string,
            ];
            const g = grants.get(id)!;
            g.role = role;
            return { success: true };
          }
          if (query.includes("WHERE id = ?")) {
            const [revokedBy, , , id] = params as [string, number, number, string];
            const g = grants.get(id)!;
            g.status = "revoked";
            g.revoked_by = revokedBy;
            return { success: true };
          }
          if (query.includes("WHERE namespace_id = ?") && query.includes("status = 'active'")) {
            const [revokedBy, , , ns, principal] = params as [
              string,
              number,
              number,
              string,
              string,
            ];
            for (const g of grants.values()) {
              if (g.namespace_id !== ns || g.status !== "active") continue;
              if (query.includes("email = ?") && g.email === principal) {
                g.status = "revoked";
                g.revoked_by = revokedBy;
              }
              if (query.includes("group_id = ?") && g.group_id === principal) {
                g.status = "revoked";
                g.revoked_by = revokedBy;
              }
            }
            return { success: true };
          }
          return { success: true };
        },
        async first<T>() {
          if (query.includes("SELECT id FROM namespace_grants")) {
            const [ns, principal] = params as [string, string];
            if (query.includes("email = ?")) {
              const g = byPrincipal(ns, principal);
              return (g ? ({ id: g.id } as T) : null) as T | null;
            }
            const g = byPrincipal(ns, undefined, principal);
            return (g ? ({ id: g.id } as T) : null) as T | null;
          }
          if (query.includes("WHERE id = ?")) {
            return (grants.get(params[0] as string) ?? null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (query.includes("WHERE namespace_id = ? AND status = 'active'")) {
            const ns = params[0] as string;
            return {
              results: [...grants.values()].filter(
                (g) => g.namespace_id === ns && g.status === "active",
              ) as T[],
            };
          }
          if (query.includes("WHERE namespace_id = ?")) {
            const ns = params[0] as string;
            return { results: [...grants.values()].filter((g) => g.namespace_id === ns) as T[] };
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

describe("graph/grants", () => {
  it("creates active grants and lists active/all", async () => {
    const db = makeDb();
    const id = await grantAccess(db as never, {
      namespace_id: "ns1",
      email: "user@memory.flarelylegal.com",
      role: "viewer",
      granted_by: "admin@x.com",
    });
    expect(await getNamespaceGrant(db as never, id)).not.toBeNull();
    expect((await listNamespaceGrants(db as never, "ns1")).length).toBe(1);
    expect((await listAllNamespaceGrants(db as never, "ns1")).length).toBe(1);
  });

  it("upserts existing active grant instead of duplicating", async () => {
    const db = makeDb();
    const first = await grantAccess(db as never, {
      namespace_id: "ns1",
      email: "user@memory.flarelylegal.com",
      role: "viewer",
      granted_by: "admin@x.com",
    });
    const second = await grantAccess(db as never, {
      namespace_id: "ns1",
      email: "user@memory.flarelylegal.com",
      role: "editor",
      granted_by: "admin@x.com",
    });
    expect(second).toBe(first);
    expect((await listAllNamespaceGrants(db as never, "ns1")).length).toBe(1);
    expect((await getNamespaceGrant(db as never, first))?.role).toBe("editor");
  });

  it("revokes by id and by principal", async () => {
    const db = makeDb();
    const id = await grantAccess(db as never, {
      namespace_id: "ns1",
      group_id: "g1",
      role: "viewer",
      granted_by: "admin@x.com",
    });
    await revokeAccess(db as never, id, "admin@x.com");
    expect((await getNamespaceGrant(db as never, id))?.status).toBe("revoked");

    await grantAccess(db as never, {
      namespace_id: "ns1",
      email: "user@memory.flarelylegal.com",
      role: "viewer",
      granted_by: "admin@x.com",
    });
    await revokeAccessByPrincipal(
      db as never,
      "ns1",
      { email: "user@memory.flarelylegal.com" },
      "admin@x.com",
    );
    expect((await listNamespaceGrants(db as never, "ns1")).length).toBe(0);
  });
});
