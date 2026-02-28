/**
 * Unit tests for grant and group membership expiry.
 *
 * Tests the data-layer functions that transition past-due rows
 * from status='active' to status='expired' and return affected emails.
 */
import { describe, expect, it } from "vitest";
import { expireGrants, expireGroupMembers } from "../../src/grant-expiry.js";

type GrantRecord = {
  id: string;
  email: string | null;
  group_id: string | null;
  status: string;
  expires_at: number | null;
  updated_at?: number;
};

type MemberRecord = {
  id: string;
  email: string;
  group_id: string;
  status: string;
  expires_at: number | null;
  updated_at?: number;
};

const PAST = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
const FUTURE = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

function makeDb(grants: GrantRecord[], members: MemberRecord[] = []) {
  return {
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        bind(...p: unknown[]) {
          params = p;
          return this;
        },
        async first<T>() {
          return null as T;
        },
        async all<T>() {
          // expireGrants: find expired grants
          if (query.includes("namespace_grants") && query.includes("expires_at")) {
            const ts = params[0] as number;
            const matched = grants.filter(
              (g) => g.status === "active" && g.expires_at !== null && g.expires_at <= ts,
            );
            return { results: matched as T[] };
          }
          // expireGrants: resolve group members
          if (query.includes("group_members") && query.includes("DISTINCT email")) {
            const groupIds = new Set(params as string[]);
            const matched = members
              .filter((m) => groupIds.has(m.group_id) && m.status === "active")
              .map((m) => ({ email: m.email }));
            return { results: matched as T[] };
          }
          // expireGroupMembers: find expired members
          if (query.includes("group_members") && query.includes("expires_at")) {
            const ts = params[0] as number;
            const matched = members.filter(
              (m) => m.status === "active" && m.expires_at !== null && m.expires_at <= ts,
            );
            return { results: matched as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(stmts: unknown[]) {
      // Each UPDATE in the batch succeeds with 1 change
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

describe("expireGrants", () => {
  it("returns zero when no grants have expired", async () => {
    const db = makeDb([
      {
        id: "g1",
        email: "a@memory.flarelylegal.com",
        group_id: null,
        status: "active",
        expires_at: FUTURE,
      },
      {
        id: "g2",
        email: "b@memory.flarelylegal.com",
        group_id: null,
        status: "active",
        expires_at: null,
      },
    ]);
    const result = await expireGrants(db as never);
    expect(result.expired).toBe(0);
    expect(result.affected_emails).toEqual([]);
  });

  it("expires past-due direct grants and returns affected emails", async () => {
    const db = makeDb([
      {
        id: "g1",
        email: "a@memory.flarelylegal.com",
        group_id: null,
        status: "active",
        expires_at: PAST,
      },
      {
        id: "g2",
        email: "b@memory.flarelylegal.com",
        group_id: null,
        status: "active",
        expires_at: FUTURE,
      },
    ]);
    const result = await expireGrants(db as never);
    expect(result.expired).toBe(1);
    expect(result.affected_emails).toEqual(["a@memory.flarelylegal.com"]);
  });

  it("expires group-based grants and includes group member emails", async () => {
    const db = makeDb(
      [{ id: "g1", email: null, group_id: "grp1", status: "active", expires_at: PAST }],
      [
        {
          id: "m1",
          email: "x@memory.flarelylegal.com",
          group_id: "grp1",
          status: "active",
          expires_at: null,
        },
        {
          id: "m2",
          email: "y@memory.flarelylegal.com",
          group_id: "grp1",
          status: "active",
          expires_at: null,
        },
      ],
    );
    const result = await expireGrants(db as never);
    expect(result.expired).toBe(1);
    expect(result.affected_emails.sort()).toEqual([
      "x@memory.flarelylegal.com",
      "y@memory.flarelylegal.com",
    ]);
  });

  it("is idempotent -- already-expired grants are not re-processed", async () => {
    const db = makeDb([
      {
        id: "g1",
        email: "a@memory.flarelylegal.com",
        group_id: null,
        status: "expired",
        expires_at: PAST,
      },
    ]);
    const result = await expireGrants(db as never);
    expect(result.expired).toBe(0);
    expect(result.affected_emails).toEqual([]);
  });

  it("deduplicates emails across direct and group grants", async () => {
    const db = makeDb(
      [
        {
          id: "g1",
          email: "a@memory.flarelylegal.com",
          group_id: null,
          status: "active",
          expires_at: PAST,
        },
        { id: "g2", email: null, group_id: "grp1", status: "active", expires_at: PAST },
      ],
      [
        {
          id: "m1",
          email: "a@memory.flarelylegal.com",
          group_id: "grp1",
          status: "active",
          expires_at: null,
        },
      ],
    );
    const result = await expireGrants(db as never);
    expect(result.expired).toBe(2);
    // a@ appears in both direct and group -- should be deduped
    expect(result.affected_emails).toEqual(["a@memory.flarelylegal.com"]);
  });
});

describe("expireGroupMembers", () => {
  it("returns zero when no members have expired", async () => {
    const db = makeDb(
      [],
      [
        {
          id: "m1",
          email: "a@memory.flarelylegal.com",
          group_id: "g1",
          status: "active",
          expires_at: FUTURE,
        },
      ],
    );
    const result = await expireGroupMembers(db as never);
    expect(result.expired).toBe(0);
    expect(result.affected_emails).toEqual([]);
  });

  it("expires past-due members and returns affected emails", async () => {
    const db = makeDb(
      [],
      [
        {
          id: "m1",
          email: "a@memory.flarelylegal.com",
          group_id: "g1",
          status: "active",
          expires_at: PAST,
        },
        {
          id: "m2",
          email: "b@memory.flarelylegal.com",
          group_id: "g1",
          status: "active",
          expires_at: FUTURE,
        },
      ],
    );
    const result = await expireGroupMembers(db as never);
    expect(result.expired).toBe(1);
    expect(result.affected_emails).toEqual(["a@memory.flarelylegal.com"]);
  });

  it("is idempotent -- already-expired members are not re-processed", async () => {
    const db = makeDb(
      [],
      [
        {
          id: "m1",
          email: "a@memory.flarelylegal.com",
          group_id: "g1",
          status: "expired",
          expires_at: PAST,
        },
      ],
    );
    const result = await expireGroupMembers(db as never);
    expect(result.expired).toBe(0);
    expect(result.affected_emails).toEqual([]);
  });
});
