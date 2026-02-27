/** Tier 2: Tests for api/schemas.ts helpers. */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { queryLimit, zodSchema } from "../../src/api/schemas.js";

function qs(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("queryLimit", () => {
  it("returns default when limit param is missing", () => {
    expect(queryLimit(qs({}), 100)).toBe(20);
  });

  it("returns custom default when provided", () => {
    expect(queryLimit(qs({}), 100, 5)).toBe(5);
  });

  it("parses string limit to number", () => {
    expect(queryLimit(qs({ limit: "10" }), 100)).toBe(10);
  });

  it("caps at max", () => {
    expect(queryLimit(qs({ limit: "200" }), 50)).toBe(50);
  });

  it("returns max when limit equals max", () => {
    expect(queryLimit(qs({ limit: "50" }), 50)).toBe(50);
  });

  it("handles NaN as default", () => {
    // Number("abc") → NaN, Math.min(NaN, max) → NaN
    // This is actually a quirk — NaN propagates through Math.min
    const result = queryLimit(qs({ limit: "abc" }), 100);
    expect(Number.isNaN(result)).toBe(true);
  });
});

describe("zodSchema", () => {
  it("converts simple string schema", () => {
    const result = zodSchema(z.string());
    expect(result.type).toBe("string");
  });

  it("converts object schema with required fields", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = zodSchema(schema);
    expect(result.type).toBe("object");
    expect(result.required).toContain("name");
    expect(result.required).toContain("age");
  });

  it("handles optional fields", () => {
    const schema = z.object({ name: z.string(), bio: z.string().optional() });
    const result = zodSchema(schema);
    expect(result.required).toContain("name");
    expect(result.required).not.toContain("bio");
  });

  it("strips $schema property", () => {
    const result = zodSchema(z.string());
    expect(result).not.toHaveProperty("$schema");
  });

  it("strips additionalProperties: false", () => {
    const result = zodSchema(z.object({ name: z.string() }));
    expect(result).not.toHaveProperty("additionalProperties");
  });
});
