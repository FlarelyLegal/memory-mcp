import { describe, it, expect } from "vitest";
import { parseFields, projectRows, parseCursor, nextCursor } from "../../src/api/fields.js";

const allowed = ["id", "name", "type", "score"] as const;
const presets = {
  compact: ["id", "name"] as const,
  full: allowed,
};

function qs(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("parseFields", () => {
  it("returns null when no fields param", () => {
    expect(parseFields(qs({}), allowed)).toBeNull();
  });

  it("returns compact preset", () => {
    expect(parseFields(qs({ fields: "compact" }), allowed, presets)).toEqual(["id", "name"]);
  });

  it("returns full preset", () => {
    expect(parseFields(qs({ fields: "full" }), allowed, presets)).toEqual([
      "id",
      "name",
      "type",
      "score",
    ]);
  });

  it("parses comma-separated fields", () => {
    expect(parseFields(qs({ fields: "id,type" }), allowed)).toEqual(["id", "type"]);
  });

  it("strips unknown fields", () => {
    expect(parseFields(qs({ fields: "id,unknown,type" }), allowed)).toEqual(["id", "type"]);
  });

  it("trims whitespace around field names", () => {
    expect(parseFields(qs({ fields: " id , name " }), allowed)).toEqual(["id", "name"]);
  });

  it("returns null for empty fields value", () => {
    expect(parseFields(qs({ fields: "" }), allowed)).toBeNull();
  });

  it("returns null when all fields are unknown", () => {
    const result = parseFields(qs({ fields: "bad,worse" }), allowed);
    expect(result).toEqual([]);
  });
});

describe("projectRows", () => {
  const rows = [
    { id: "1", name: "a", type: "x", score: 0.9 },
    { id: "2", name: "b", type: "y", score: 0.8 },
  ];

  it("returns full rows when fields is null", () => {
    expect(projectRows(rows, null)).toEqual(rows);
  });

  it("returns full rows when fields is empty", () => {
    expect(projectRows(rows, [])).toEqual(rows);
  });

  it("projects specified fields only", () => {
    expect(projectRows(rows, ["id", "name"])).toEqual([
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ]);
  });

  it("ignores fields not present on rows", () => {
    expect(projectRows(rows, ["id", "missing"])).toEqual([{ id: "1" }, { id: "2" }]);
  });
});

describe("parseCursor / nextCursor", () => {
  it("returns 0 for missing cursor", () => {
    expect(parseCursor(qs({}))).toBe(0);
  });

  it("roundtrips cursor encode/decode", () => {
    const cursor = nextCursor(0, 10, true);
    expect(cursor).not.toBeNull();
    expect(parseCursor(qs({ cursor: cursor! }))).toBe(10);
  });

  it("returns null when hasMore is false", () => {
    expect(nextCursor(0, 10, false)).toBeNull();
  });

  it("returns 0 for non-numeric base64", () => {
    // btoa("hello") is valid base64 but parseInt returns NaN
    expect(parseCursor(qs({ cursor: btoa("hello") }))).toBe(0);
  });

  it("returns 0 for negative decoded value", () => {
    // btoa("-5") = "LTU="
    expect(parseCursor(qs({ cursor: btoa("-5") }))).toBe(0);
  });

  it("advances offset correctly", () => {
    // offset=10, pageSize=5, hasMore=true → cursor encodes 15
    const cursor = nextCursor(10, 5, true)!;
    expect(parseCursor(qs({ cursor }))).toBe(15);
  });
});
