/**
 * Unit tests for the shared HTML layout shell and helpers.
 *
 * Tests HTML escaping, date formatting, page shell output (CSP, breadcrumbs,
 * Inter font, title escaping).
 */
import { describe, it, expect } from "vitest";
import { esc, fmtDate, htmlPage } from "../../src/api/html/layout.js";

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

describe("esc", () => {
  it("escapes HTML special characters", () => {
    expect(esc('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("returns empty string for null/undefined", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

describe("fmtDate", () => {
  it("formats Unix timestamp as YYYY-MM-DD", () => {
    // 2025-01-15T00:00:00Z
    expect(fmtDate(1736899200)).toBe("2025-01-15");
  });

  it("formats ISO string as YYYY-MM-DD", () => {
    expect(fmtDate("2025-06-01T12:00:00Z")).toBe("2025-06-01");
  });

  it("returns -- for null/undefined", () => {
    expect(fmtDate(null)).toBe("--");
    expect(fmtDate(undefined)).toBe("--");
  });
});

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

describe("htmlPage", () => {
  it("returns a Response with text/html content type", () => {
    const res = htmlPage("<p>test</p>", { title: "Test" });
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("includes CSP header", () => {
    const res = htmlPage("<p>test</p>", { title: "Test" });
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("renders breadcrumbs when provided", async () => {
    const res = htmlPage("<p>test</p>", {
      title: "Test",
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Current" }],
    });
    const html = await res.text();
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toContain('<span class="current">Current</span>');
  });

  it("includes Inter font link", async () => {
    const res = htmlPage("", { title: "T" });
    const html = await res.text();
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Inter");
  });

  it("escapes title", async () => {
    const res = htmlPage("", { title: "A <b> Test" });
    const html = await res.text();
    expect(html).toContain("A &lt;b&gt; Test");
  });
});
