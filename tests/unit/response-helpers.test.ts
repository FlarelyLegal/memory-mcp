import { describe, it, expect } from "vitest";
import { txt, ok, err, cap, trunc } from "../../src/response-helpers.js";

describe("txt", () => {
  it("wraps data as JSON text content", () => {
    const result = txt({ foo: 1 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: 1 });
  });

  it("does not set isError", () => {
    expect(txt("hello").isError).toBeUndefined();
  });
});

describe("ok", () => {
  it("returns plain text content", () => {
    const result = ok("done");
    expect(result.content[0].text).toBe("done");
  });

  it("does not set isError", () => {
    expect(ok("done").isError).toBeUndefined();
  });
});

describe("err", () => {
  it("returns plain text content", () => {
    const result = err("failed");
    expect(result.content[0].text).toBe("failed");
  });

  it("sets isError to true", () => {
    expect(err("failed").isError).toBe(true);
  });
});

describe("cap", () => {
  it("returns default when n is undefined", () => {
    expect(cap(undefined, 20, 10)).toBe(10);
  });

  it("caps at max", () => {
    expect(cap(50, 20, 10)).toBe(20);
  });

  it("returns n when within bounds", () => {
    expect(cap(5, 20, 10)).toBe(5);
  });

  it("returns max when n equals max", () => {
    expect(cap(20, 20, 10)).toBe(20);
  });

  it("handles zero", () => {
    // 0 is falsy but still a valid number — should not fall back to default
    expect(cap(0, 20, 10)).toBe(0);
  });
});

describe("trunc", () => {
  it("returns null for null", () => {
    expect(trunc(null)).toBeNull();
  });

  it("returns undefined for undefined", () => {
    expect(trunc(undefined)).toBeUndefined();
  });

  it("returns string unchanged when under max", () => {
    expect(trunc("short")).toBe("short");
  });

  it("returns string unchanged when exactly at max", () => {
    const s = "a".repeat(400);
    expect(trunc(s)).toBe(s);
  });

  it("truncates with ellipsis when over max", () => {
    const s = "a".repeat(401);
    const result = trunc(s);
    expect(result).toHaveLength(403); // 400 + "..."
    expect(result!.endsWith("...")).toBe(true);
  });

  it("respects custom max", () => {
    const result = trunc("hello world", 5);
    expect(result).toBe("hello...");
  });

  it("handles empty string", () => {
    expect(trunc("")).toBe("");
  });
});
