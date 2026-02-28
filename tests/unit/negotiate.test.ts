/**
 * Unit tests for Accept header content negotiation.
 *
 * The wantsHtml helper compares quality weights (q=) of text/html vs
 * application/json per RFC 7231 Section 5.3.1. Media types without an
 * explicit q default to 1.0.
 */
import { describe, it, expect } from "vitest";
import { wantsHtml } from "../../src/api/html/negotiate.js";

function req(accept?: string): Request {
  const headers: Record<string, string> = {};
  if (accept !== undefined) headers.Accept = accept;
  return new Request("https://x.test/api/v1/namespaces", { headers });
}

describe("wantsHtml", () => {
  it("returns true for typical browser Accept header", () => {
    expect(wantsHtml(req("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"))).toBe(
      true,
    );
  });

  it("returns false for explicit JSON Accept", () => {
    expect(wantsHtml(req("application/json"))).toBe(false);
  });

  it("returns false when Accept is missing", () => {
    expect(wantsHtml(req())).toBe(false);
  });

  it("returns false when Accept is empty string", () => {
    expect(wantsHtml(req(""))).toBe(false);
  });

  it("returns true when only text/html is present", () => {
    expect(wantsHtml(req("text/html"))).toBe(true);
  });

  // q-value tests (RFC 7231 compliance)

  it("returns false when JSON has higher q than HTML", () => {
    expect(wantsHtml(req("text/html;q=0.1, application/json;q=0.9"))).toBe(false);
  });

  it("returns true when HTML has higher q than JSON", () => {
    expect(wantsHtml(req("application/json;q=0.9, text/html;q=1.0"))).toBe(true);
  });

  it("returns false when both have equal q (tie goes to JSON)", () => {
    expect(wantsHtml(req("text/html;q=0.5, application/json;q=0.5"))).toBe(false);
  });

  it("returns false when both default to q=1.0 (equal, JSON wins)", () => {
    // No explicit q, both default to 1.0 -- tie goes to JSON
    expect(wantsHtml(req("application/json, text/html"))).toBe(false);
    expect(wantsHtml(req("text/html, application/json"))).toBe(false);
  });

  it("returns true when HTML is q=1.0 and JSON has explicit lower q", () => {
    expect(wantsHtml(req("text/html, application/json;q=0.8"))).toBe(true);
  });

  it("handles mixed media types with q-values", () => {
    // Real-world: browser with JSON preference override
    expect(
      wantsHtml(req("text/html;q=0.9, application/xhtml+xml;q=0.9, application/json;q=1.0")),
    ).toBe(false);
  });

  it("ignores wildcard and irrelevant types", () => {
    // Only wildcard, no explicit html or json
    expect(wantsHtml(req("*/*"))).toBe(false);
    expect(wantsHtml(req("text/plain, image/png"))).toBe(false);
  });
});
