import { describe, expect, it } from "vitest";
import { decodeBindChallenge, encodeBindChallenge } from "../../src/kv.js";

describe("decodeBindChallenge", () => {
  const valid = {
    v: "1.0" as const,
    common_name: "client-id-123",
    email: "admin@memory.flarelylegal.com",
    label: "My Token",
    created_at: 1700000000,
    expires_at: 1700000600,
  };

  it("decodes versioned payload", () => {
    const result = decodeBindChallenge(valid);
    expect(result?.common_name).toBe("client-id-123");
    expect(result?.v).toBe("1.0");
  });

  it("returns null for null input", () => {
    expect(decodeBindChallenge(null)).toBeNull();
  });

  it("returns null for missing v", () => {
    const { v: _, ...rest } = valid;
    expect(decodeBindChallenge(rest)).toBeNull();
  });

  it("returns null when common_name is missing", () => {
    const { common_name: _, ...rest } = valid;
    expect(decodeBindChallenge(rest)).toBeNull();
  });

  it("returns null when expires_at is missing", () => {
    const { expires_at: _, ...rest } = valid;
    expect(decodeBindChallenge(rest)).toBeNull();
  });
});

describe("encodeBindChallenge", () => {
  it("produces versioned JSON", () => {
    const parsed = JSON.parse(
      encodeBindChallenge({
        common_name: "client-id-123",
        email: "admin@memory.flarelylegal.com",
        label: "My Token",
        created_at: 1700000000,
        expires_at: 1700000600,
      }),
    );
    expect(parsed.v).toBe("1.0");
    expect(parsed.common_name).toBe("client-id-123");
  });

  it("round-trips through decode", () => {
    const challenge = {
      common_name: "client-id-123",
      email: "admin@memory.flarelylegal.com",
      label: "My Token",
      created_at: 1700000000,
      expires_at: 1700000600,
    };
    const result = decodeBindChallenge(JSON.parse(encodeBindChallenge(challenge)));
    expect(result?.common_name).toBe(challenge.common_name);
    expect(result?.expires_at).toBe(challenge.expires_at);
  });
});
