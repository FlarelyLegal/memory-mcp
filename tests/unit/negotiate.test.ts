/**
 * Unit tests for Accept header content negotiation.
 *
 * The wantsHtml helper determines whether a request prefers HTML (browser)
 * or JSON (API client) based on the Accept header ordering.
 */
import { describe, it, expect } from "vitest";
import { wantsHtml } from "../../src/api/html/negotiate.js";

describe("wantsHtml", () => {
  it("returns true for typical browser Accept header", () => {
    const req = new Request("https://x.test/api/v1/namespaces", {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    expect(wantsHtml(req)).toBe(true);
  });

  it("returns false for explicit JSON Accept", () => {
    const req = new Request("https://x.test/api/v1/namespaces", {
      headers: { Accept: "application/json" },
    });
    expect(wantsHtml(req)).toBe(false);
  });

  it("returns false when Accept is missing", () => {
    const req = new Request("https://x.test/api/v1/namespaces");
    expect(wantsHtml(req)).toBe(false);
  });

  it("returns false when JSON appears before HTML", () => {
    const req = new Request("https://x.test/", {
      headers: { Accept: "application/json, text/html" },
    });
    expect(wantsHtml(req)).toBe(false);
  });

  it("returns true when HTML appears before JSON", () => {
    const req = new Request("https://x.test/", {
      headers: { Accept: "text/html, application/json" },
    });
    expect(wantsHtml(req)).toBe(true);
  });

  it("returns true when only text/html is present", () => {
    const req = new Request("https://x.test/", {
      headers: { Accept: "text/html" },
    });
    expect(wantsHtml(req)).toBe(true);
  });
});
