import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  assertEntityReadAccess,
  assertNamespaceOwnerAccess,
  assertNamespaceReadAccess,
  assertNamespaceWriteAccess,
} from "../../src/auth.js";
import type { NamespaceRow, UserIdentity } from "../../src/types.js";

const NS_PRIVATE: NamespaceRow = {
  id: "ns-private",
  name: "Private",
  description: null,
  owner: "owner@memory.flarelylegal.com",
  shard_id: "core",
  visibility: "private",
  metadata: null,
  created_at: 1,
  updated_at: 1,
};

const NS_PUBLIC: NamespaceRow = { ...NS_PRIVATE, id: "ns-public", visibility: "public" };

function identity(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    groups: [],
    isAdmin: false,
    ownedNamespaces: [],
    directGrants: {},
    groupGrants: {},
    ...overrides,
  };
}

function makeDb(namespaces: NamespaceRow[]) {
  const nsById = new Map(namespaces.map((n) => [n.id, n]));
  const entityNs = new Map<string, string>([["ent-1", "ns-public"]]);
  return {
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        bind(...p: unknown[]) {
          params = p;
          return this;
        },
        async first<T>() {
          if (query.includes("FROM namespaces WHERE id = ?")) {
            return (nsById.get(params[0] as string) ?? null) as T | null;
          }
          if (query.includes("FROM entities r") && query.includes("JOIN namespaces")) {
            const ns = nsById.get(entityNs.get(params[0] as string) ?? "");
            if (!ns) return null;
            return { namespace_id: ns.id, owner: ns.owner, visibility: ns.visibility } as T;
          }
          return null;
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

describe("auth with identity RBAC", () => {
  it("allows owner/editor/viewer and group grants correctly", async () => {
    const db = makeDb([NS_PRIVATE]);
    await expect(
      assertNamespaceOwnerAccess(
        db as never,
        "ns-private",
        identity({ ownedNamespaces: ["ns-private"] }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      assertNamespaceWriteAccess(
        db as never,
        "ns-private",
        identity({ directGrants: { "ns-private": "editor" } }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      assertNamespaceReadAccess(
        db as never,
        "ns-private",
        identity({ groupGrants: { "ns-private": "viewer" } }),
      ),
    ).resolves.toBeTruthy();
  });

  it("uses highest grant when direct + group differ", async () => {
    const db = makeDb([NS_PRIVATE]);
    const id = identity({
      directGrants: { "ns-private": "viewer" },
      groupGrants: { "ns-private": "editor" },
    });
    await expect(assertNamespaceWriteAccess(db as never, "ns-private", id)).resolves.toBeTruthy();
  });

  it("allows public read and admin write on public namespace", async () => {
    const db = makeDb([NS_PUBLIC]);
    await expect(
      assertNamespaceReadAccess(db as never, "ns-public", identity()),
    ).resolves.toBeTruthy();
    await expect(
      assertNamespaceWriteAccess(db as never, "ns-public", identity({ isAdmin: true })),
    ).resolves.toBeTruthy();
  });

  it("denies private access without ownership or grants", async () => {
    const db = makeDb([NS_PRIVATE]);
    await expect(
      assertNamespaceReadAccess(db as never, "ns-private", identity()),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("denies write for expired/revoked equivalent (not active in identity)", async () => {
    const db = makeDb([NS_PRIVATE]);
    const id = identity({ directGrants: {} });
    await expect(assertNamespaceWriteAccess(db as never, "ns-private", id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("supports resource-level read checks via namespace visibility/grants", async () => {
    const db = makeDb([NS_PUBLIC]);
    await expect(assertEntityReadAccess(db as never, "ent-1", identity())).resolves.toBe(
      "ns-public",
    );
  });
});
