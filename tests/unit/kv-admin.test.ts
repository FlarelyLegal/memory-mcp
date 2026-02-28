import { describe, expect, it } from "vitest";
import { decodeAdminEmails, encodeAdminEmails } from "../../src/kv.js";

describe("decodeAdminEmails", () => {
  it("decodes versioned JSON payload", () => {
    const json = JSON.stringify({ v: "1.0", emails: ["A@b.com", "c@D.com"] });
    expect(decodeAdminEmails(json)).toEqual(["a@b.com", "c@d.com"]);
  });

  it("returns empty array for null", () => {
    expect(decodeAdminEmails(null)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(decodeAdminEmails("")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(decodeAdminEmails("{bad")).toEqual([]);
  });

  it("returns empty array for wrong version", () => {
    expect(decodeAdminEmails(JSON.stringify({ v: "2.0", emails: ["a@b.com"] }))).toEqual([]);
  });

  it("returns empty array for missing v field", () => {
    expect(decodeAdminEmails(JSON.stringify({ emails: ["a@b.com"] }))).toEqual([]);
  });

  it("filters non-string entries from emails array", () => {
    const json = JSON.stringify({ v: "1.0", emails: ["a@b.com", 42, null, "c@d.com"] });
    expect(decodeAdminEmails(json)).toEqual(["a@b.com", "c@d.com"]);
  });
});

describe("encodeAdminEmails", () => {
  it("produces versioned JSON", () => {
    const parsed = JSON.parse(encodeAdminEmails(["a@b.com", "c@d.com"]));
    expect(parsed.v).toBe("1.0");
    expect(parsed.emails).toEqual(["a@b.com", "c@d.com"]);
  });

  it("round-trips through decode", () => {
    const emails = ["tim@memory.flarelylegal.com", "admin@memory.flarelylegal.com"];
    expect(decodeAdminEmails(encodeAdminEmails(emails))).toEqual(emails);
  });
});
