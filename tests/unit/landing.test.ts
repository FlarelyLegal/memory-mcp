/**
 * Unit tests for the landing page renderer (GET /).
 *
 * Tests HTML output, CSP headers, cache control, health check script,
 * and quick links.
 */
import { describe, it, expect } from "vitest";
import { renderLandingPage } from "../../src/landing.js";

describe("renderLandingPage", () => {
  it("returns HTML with correct content-type", () => {
    const res = renderLandingPage();
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("includes CSP with inline script allowed", () => {
    const res = renderLandingPage();
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("sets public cache control", () => {
    const res = renderLandingPage();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("includes version and repo link", async () => {
    const res = renderLandingPage();
    const html = await res.text();
    expect(html).toContain("Memory MCP Server");
    expect(html).toContain("github.com");
  });

  it("includes health check script", async () => {
    const res = renderLandingPage();
    const html = await res.text();
    expect(html).toContain("fetch('/health')");
  });

  it("includes quick links", async () => {
    const res = renderLandingPage();
    const html = await res.text();
    expect(html).toContain("/api/docs");
    expect(html).toContain("/api/v1/admin/service-tokens/bind");
  });
});
