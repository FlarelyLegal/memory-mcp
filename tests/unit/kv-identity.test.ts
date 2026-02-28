import { describe, expect, it } from "vitest";
import { decodeIdentity, encodeIdentity } from "../../src/kv.js";

describe("decodeIdentity", () => {
  const valid = {
    v: "1.0" as const,
    groups: ["g1"],
    isAdmin: false,
    ownedNamespaces: ["ns1"],
    directGrants: { ns2: "editor" },
    groupGrants: { ns3: "viewer" },
  };

  it("decodes versioned payload", () => {
    const result = decodeIdentity(valid);
    expect(result?.ownedNamespaces).toEqual(["ns1"]);
    expect(result?.directGrants).toEqual({ ns2: "editor" });
  });

  it("returns null for null input", () => {
    expect(decodeIdentity(null)).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(decodeIdentity("string")).toBeNull();
  });

  it("returns null for missing v field", () => {
    const { v: _, ...rest } = valid;
    expect(decodeIdentity(rest)).toBeNull();
  });

  it("returns null for wrong version", () => {
    expect(decodeIdentity({ ...valid, v: "2.0" })).toBeNull();
  });

  it("returns null when directGrants is missing", () => {
    expect(decodeIdentity({ v: "1.0", groups: [], ownedNamespaces: [] })).toBeNull();
  });

  it("returns null when directGrants is an array", () => {
    expect(
      decodeIdentity({
        v: "1.0",
        groups: [],
        ownedNamespaces: [],
        directGrants: [],
        groupGrants: {},
      }),
    ).toBeNull();
  });

  it("filters invalid roles from grants", () => {
    const result = decodeIdentity({
      ...valid,
      directGrants: { ns1: "editor", ns2: "bogus" },
    });
    expect(result?.directGrants).toEqual({ ns1: "editor" });
  });

  it("filters non-string values from groups", () => {
    const result = decodeIdentity({ ...valid, groups: ["g1", 42, null, "g2"] });
    expect(result?.groups).toEqual(["g1", "g2"]);
  });
});

describe("encodeIdentity", () => {
  it("produces versioned JSON", () => {
    const identity = {
      groups: ["g1"],
      isAdmin: false,
      ownedNamespaces: ["ns1"],
      directGrants: { ns2: "editor" as const },
      groupGrants: {},
    };
    const parsed = JSON.parse(encodeIdentity(identity));
    expect(parsed.v).toBe("1.0");
    expect(parsed.groups).toEqual(["g1"]);
  });

  it("round-trips through decode", () => {
    const identity = {
      groups: ["g1", "g2"],
      isAdmin: true,
      ownedNamespaces: ["ns1"],
      directGrants: { ns2: "editor" as const },
      groupGrants: { ns3: "viewer" as const },
    };
    const result = decodeIdentity(JSON.parse(encodeIdentity(identity)));
    expect(result).toEqual(identity);
  });
});
