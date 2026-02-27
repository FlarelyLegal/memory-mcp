import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateId,
  now,
  parseJson,
  toJson,
  toISO,
  chunks,
  escapeLike,
  ftsEscape,
  decayScore,
  handleFtsError,
} from "../../src/utils.js";

describe("generateId", () => {
  it("returns a valid UUID v4", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, generateId));
    expect(ids.size).toBe(100);
  });
});

describe("now", () => {
  it("returns epoch seconds close to Date.now()", () => {
    const ts = now();
    expect(ts).toBeCloseTo(Math.floor(Date.now() / 1000), 0);
  });
});

describe("parseJson", () => {
  it("parses valid JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for invalid JSON", () => {
    expect(parseJson("{bad}")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseJson(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJson("")).toBeNull();
  });
});

describe("toJson", () => {
  it("serializes an object", () => {
    expect(toJson({ a: 1 })).toBe('{"a":1}');
  });

  it("returns null for null", () => {
    expect(toJson(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toJson(undefined)).toBeNull();
  });
});

describe("toISO", () => {
  it("converts epoch seconds to ISO string", () => {
    expect(toISO(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("converts a known timestamp", () => {
    // 2024-01-01 00:00:00 UTC = 1704067200
    expect(toISO(1704067200)).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("chunks", () => {
  it("splits evenly", () => {
    expect(chunks([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("handles remainder", () => {
    expect(chunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunks([], 5)).toEqual([]);
  });

  it("handles size=1", () => {
    expect(chunks([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("handles size larger than array", () => {
    expect(chunks([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe("escapeLike", () => {
  it("escapes percent", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscore", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes backslash", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes combinations", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });

  it("returns empty string unchanged", () => {
    expect(escapeLike("")).toBe("");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("handles unicode", () => {
    expect(escapeLike("über_100%")).toBe("über\\_100\\%");
  });

  it("handles multiple wildcards in sequence", () => {
    expect(escapeLike("%%__")).toBe("\\%\\%\\_\\_");
  });
});

describe("ftsEscape", () => {
  it("wraps terms in quotes with prefix match", () => {
    expect(ftsEscape("hello world")).toBe('"hello"* "world"*');
  });

  it("strips double quotes", () => {
    expect(ftsEscape('"hello"')).toBe('"hello"*');
  });

  it("strips parentheses", () => {
    expect(ftsEscape("(test)")).toBe('"test"*');
  });

  it("strips asterisks", () => {
    expect(ftsEscape("test*")).toBe('"test"*');
  });

  it("strips colons and carets", () => {
    expect(ftsEscape("field:value^2")).toBe('"field"* "value"* "2"*');
  });

  it("handles AND/OR/NOT as regular terms", () => {
    // FTS5 treats these as operators when unquoted, but we quote them
    expect(ftsEscape("cats AND dogs")).toBe('"cats"* "AND"* "dogs"*');
  });

  it("returns empty quoted string for empty input", () => {
    expect(ftsEscape("")).toBe('""');
  });

  it("returns empty quoted string for whitespace-only input", () => {
    expect(ftsEscape("   ")).toBe('""');
  });

  it("returns empty quoted string for special-chars-only input", () => {
    expect(ftsEscape('":*()[]')).toBe('""');
  });

  it("handles curly braces and backslashes", () => {
    expect(ftsEscape("{test}\\value")).toBe('"test"* "value"*');
  });
});

describe("decayScore", () => {
  it("returns ~1.0 for just-accessed high-importance item", () => {
    const ts = now();
    const score = decayScore(ts, 1.0);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("returns ~0.4 * importance for very old items", () => {
    // 1 year ago — time factor should be ~0
    const ts = now() - 365 * 24 * 3600;
    const score = decayScore(ts, 1.0);
    expect(score).toBeCloseTo(0.4, 1);
  });

  it("returns ~0.7 at half-life with importance=1", () => {
    // At half-life (168h = 7 days), timeFactor = 0.5
    // score = 1.0 * 0.4 + 0.5 * 0.6 = 0.7
    const ts = now() - 7 * 24 * 3600;
    const score = decayScore(ts, 1.0);
    expect(score).toBeCloseTo(0.7, 1);
  });

  it("respects custom half-life", () => {
    const ts = now() - 3600; // 1 hour ago
    // halfLife=1h → at exactly 1 half-life, timeFactor = 0.5
    const score = decayScore(ts, 1.0, 1);
    expect(score).toBeCloseTo(0.7, 1);
  });

  it("scales with importance", () => {
    const ts = now();
    const low = decayScore(ts, 0.2);
    const high = decayScore(ts, 1.0);
    expect(high).toBeGreaterThan(low);
  });
});

describe("handleFtsError", () => {
  it("silently ignores FTS not-set-up errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleFtsError(new Error("no such table: entities_fts"));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs unexpected errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleFtsError(new Error("disk I/O error"));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("handles non-Error values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleFtsError("some string error");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
