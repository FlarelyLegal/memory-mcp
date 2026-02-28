/**
 * Unit tests for shared SQL predicates.
 */
import { describe, expect, it } from "vitest";
import { NOT_EXPIRED } from "../../src/sql.js";

describe("NOT_EXPIRED", () => {
  it("is a valid SQL fragment for expiry filtering", () => {
    expect(NOT_EXPIRED).toBe("(expires_at IS NULL OR expires_at > unixepoch())");
  });

  it("can be interpolated into a WHERE clause", () => {
    const query = `SELECT * FROM namespace_grants WHERE status = 'active' AND ${NOT_EXPIRED}`;
    expect(query).toContain("expires_at IS NULL OR expires_at > unixepoch()");
    expect(query).toContain("status = 'active'");
  });
});
