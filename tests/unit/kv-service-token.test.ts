import { describe, expect, it } from "vitest";
import { decodeServiceToken, encodeServiceToken } from "../../src/kv.js";

describe("decodeServiceToken", () => {
  const valid = {
    v: "1.0" as const,
    email: "user@memory.flarelylegal.com",
    label: "CI Bot",
    created_at: 1700000000,
  };

  it("decodes versioned payload", () => {
    const result = decodeServiceToken(valid);
    expect(result?.email).toBe("user@memory.flarelylegal.com");
    expect(result?.v).toBe("1.0");
  });

  it("preserves revoked_at when present", () => {
    const result = decodeServiceToken({ ...valid, revoked_at: 1700001000 });
    expect(result?.revoked_at).toBe(1700001000);
  });

  it("omits revoked_at when absent", () => {
    const result = decodeServiceToken(valid);
    expect(result).not.toHaveProperty("revoked_at");
  });

  it("returns null for null input", () => {
    expect(decodeServiceToken(null)).toBeNull();
  });

  it("returns null for missing v", () => {
    const { v: _, ...rest } = valid;
    expect(decodeServiceToken(rest)).toBeNull();
  });

  it("returns null when email is missing", () => {
    expect(decodeServiceToken({ v: "1.0", label: "x", created_at: 1 })).toBeNull();
  });

  it("returns null when created_at is wrong type", () => {
    expect(
      decodeServiceToken({ v: "1.0", email: "a@b.com", label: "x", created_at: "nope" }),
    ).toBeNull();
  });
});

describe("encodeServiceToken", () => {
  it("produces versioned JSON", () => {
    const parsed = JSON.parse(
      encodeServiceToken({
        email: "user@memory.flarelylegal.com",
        label: "CI",
        created_at: 1700000000,
      }),
    );
    expect(parsed.v).toBe("1.0");
    expect(parsed.email).toBe("user@memory.flarelylegal.com");
  });

  it("round-trips through decode", () => {
    const mapping = {
      email: "user@memory.flarelylegal.com",
      label: "CI Bot",
      created_at: 1700000000,
      revoked_at: 1700001000,
    };
    const result = decodeServiceToken(JSON.parse(encodeServiceToken(mapping)));
    expect(result?.email).toBe(mapping.email);
    expect(result?.revoked_at).toBe(mapping.revoked_at);
  });
});
