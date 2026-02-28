import { describe, expect, it, vi } from "vitest";
import {
  getAccessLevel,
  hasOwnerAccess,
  hasReadAccess,
  hasWriteAccess,
  loadIdentity,
} from "../../src/identity.js";
import {
  bustIdentityCache,
  bustIdentityCacheForGroup,
  bustIdentityCacheForNamespace,
  bustIdentityCaches,
} from "../../src/cache-bust.js";

function makeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  return {
    async get<T = unknown>(key: string, opts?: { type?: "json" }) {
      const raw = store.get(key) ?? null;
      if (opts?.type === "json") return (raw ? (JSON.parse(raw) as T) : null) as T | null;
      return raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    has(key: string) {
      return store.has(key);
    },
    size() {
      return store.size;
    },
  };
}

describe("identity", () => {
  it("loads identity from KV cache hit", async () => {
    const users = makeKv({
      "user@memory.flarelylegal.com": {
        groups: ["g1"],
        isAdmin: false,
        ownedNamespaces: ["ns1"],
        directGrants: { ns2: "editor" },
        groupGrants: { ns3: "viewer" },
      },
    });
    const flags = { get: vi.fn().mockResolvedValue("admin@example.com") };
    const db = { batch: vi.fn(), prepare: vi.fn() };

    const identity = await loadIdentity(
      db as never,
      users as never,
      flags as never,
      "user@memory.flarelylegal.com",
    );

    expect(identity.ownedNamespaces).toEqual(["ns1"]);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("loads identity from D1 batch on cache miss and writes KV", async () => {
    const users = makeKv();
    const flags = { get: vi.fn().mockResolvedValue("user@memory.flarelylegal.com") };
    const db = {
      prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis() })),
      async batch() {
        return [
          { results: [{ group_id: "g1" }] },
          {
            results: [
              {
                namespace_id: "ns2",
                email: "user@memory.flarelylegal.com",
                group_id: null,
                role: "owner",
              },
            ],
          },
          { results: [{ id: "ns1" }] },
        ];
      },
    };

    const identity = await loadIdentity(
      db as never,
      users as never,
      flags as never,
      "user@memory.flarelylegal.com",
    );

    expect(identity.isAdmin).toBe(true);
    expect(identity.groups).toEqual(["g1"]);
    expect(identity.directGrants.ns2).toBe("owner");
    expect(users.has("user@memory.flarelylegal.com")).toBe(true);
  });

  it("computes access levels from ownership and highest grant", () => {
    const identity = {
      groups: ["g1"],
      isAdmin: false,
      ownedNamespaces: ["ns1"],
      directGrants: { ns2: "viewer" as const },
      groupGrants: { ns2: "editor" as const },
    };
    expect(getAccessLevel(identity, "ns1")).toBe(3);
    expect(getAccessLevel(identity, "ns2")).toBe(2);
    expect(hasReadAccess(identity, "ns2")).toBe(true);
    expect(hasWriteAccess(identity, "ns2")).toBe(true);
    expect(hasOwnerAccess(identity, "ns2")).toBe(false);
  });
});

describe("cache-bust", () => {
  function makeDb() {
    const grants = [
      {
        namespace_id: "ns1",
        email: "direct@x.com",
        group_id: null,
        role: "viewer",
        status: "active",
      },
      { namespace_id: "ns1", email: null, group_id: "g1", role: "editor", status: "active" },
    ];
    const members = [
      { group_id: "g1", email: "a@x.com", status: "active" },
      { group_id: "g1", email: "b@x.com", status: "active" },
      { group_id: "g1", email: "c@x.com", status: "suspended" },
    ];
    return {
      prepare(query: string) {
        let params: unknown[] = [];
        return {
          bind(...p: unknown[]) {
            params = p;
            return this;
          },
          async all<T>() {
            if (query.includes("FROM group_members")) {
              return {
                results: members.filter(
                  (m) => m.group_id === params[0] && m.status === "active",
                ) as T[],
              };
            }
            if (query.includes("FROM namespace_grants")) {
              return {
                results: grants.filter(
                  (g) => g.namespace_id === params[0] && g.status === "active",
                ) as T[],
              };
            }
            return { results: [] as T[] };
          },
        };
      },
      batch: vi.fn(),
    };
  }

  it("busts single and multiple identity cache keys", async () => {
    const users = makeKv({ "a@x.com": { ok: true }, "b@x.com": { ok: true } });
    await bustIdentityCache(users as never, "a@x.com");
    await bustIdentityCaches(users as never, ["b@x.com", "B@X.COM", ""]);
    expect(users.size()).toBe(0);
  });

  it("busts group and namespace fan-out deterministically", async () => {
    const users = makeKv({
      "a@x.com": { ok: true },
      "b@x.com": { ok: true },
      "direct@x.com": { ok: true },
      "owner@x.com": { ok: true },
    });
    const db = makeDb();

    await bustIdentityCacheForGroup(db as never, users as never, "g1");
    expect(users.has("a@x.com")).toBe(false);
    expect(users.has("b@x.com")).toBe(false);

    await bustIdentityCacheForNamespace(db as never, users as never, "ns1", ["owner@x.com"]);
    expect(users.has("direct@x.com")).toBe(false);
    expect(users.has("owner@x.com")).toBe(false);
  });
});
