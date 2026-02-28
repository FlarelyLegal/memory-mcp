/**
 * Unit tests for identity cache busting utilities.
 *
 * Tests single/multi key deletion, group fan-out (active members only),
 * and namespace fan-out (direct grantees + group members + explicit emails).
 */
import { describe, expect, it, vi } from "vitest";
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

function makeDb() {
  const grants = [
    {
      namespace_id: "ns1",
      email: "direct@memory.flarelylegal.com",
      group_id: null,
      role: "viewer",
      status: "active",
    },
    { namespace_id: "ns1", email: null, group_id: "g1", role: "editor", status: "active" },
  ];
  const members = [
    { group_id: "g1", email: "a@memory.flarelylegal.com", status: "active" },
    { group_id: "g1", email: "b@memory.flarelylegal.com", status: "active" },
    { group_id: "g1", email: "c@memory.flarelylegal.com", status: "suspended" },
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

describe("bustIdentityCache", () => {
  it("busts single and multiple identity cache keys", async () => {
    const users = makeKv({
      "a@memory.flarelylegal.com": { ok: true },
      "b@memory.flarelylegal.com": { ok: true },
    });
    await bustIdentityCache(users as never, "a@memory.flarelylegal.com");
    await bustIdentityCaches(users as never, [
      "b@memory.flarelylegal.com",
      "B@MEMORY.FLARELYLEGAL.COM",
      "",
    ]);
    expect(users.size()).toBe(0);
  });
});

describe("bustIdentityCacheForGroup", () => {
  it("busts cache for all active group members", async () => {
    const users = makeKv({
      "a@memory.flarelylegal.com": { ok: true },
      "b@memory.flarelylegal.com": { ok: true },
    });
    const db = makeDb();

    await bustIdentityCacheForGroup(db as never, users as never, "g1");
    expect(users.has("a@memory.flarelylegal.com")).toBe(false);
    expect(users.has("b@memory.flarelylegal.com")).toBe(false);
  });
});

describe("bustIdentityCacheForNamespace", () => {
  it("busts cache for grantees, group members, and explicit emails", async () => {
    const users = makeKv({
      "a@memory.flarelylegal.com": { ok: true },
      "b@memory.flarelylegal.com": { ok: true },
      "direct@memory.flarelylegal.com": { ok: true },
      "owner@memory.flarelylegal.com": { ok: true },
    });
    const db = makeDb();

    await bustIdentityCacheForNamespace(db as never, users as never, "ns1", [
      "owner@memory.flarelylegal.com",
    ]);
    expect(users.has("direct@memory.flarelylegal.com")).toBe(false);
    expect(users.has("owner@memory.flarelylegal.com")).toBe(false);
  });
});
