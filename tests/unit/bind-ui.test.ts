/**
 * Unit tests for the service token bind UI HTML renderer.
 *
 * Tests the rendered HTML page including CSP headers with nonce,
 * input validation patterns, and XSS escaping.
 */
import { describe, it, expect } from "vitest";
import { renderBindPage } from "../../src/api/routes/bind-ui-html.js";

describe("renderBindPage", () => {
  it("returns HTML with correct content-type", () => {
    const res = renderBindPage("test@memory.flarelylegal.com", "test-nonce-123");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("includes CSP with nonce-based script-src", () => {
    const nonce = crypto.randomUUID();
    const res = renderBindPage("test@memory.flarelylegal.com", nonce);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("font-src https://fonts.gstatic.com");
  });

  it("sets no-store cache control", () => {
    const res = renderBindPage("test@memory.flarelylegal.com", "n");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("escapes email in HTML output", async () => {
    const res = renderBindPage("<script>alert(1)</script>@memory.flarelylegal.com", "n");
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>@");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the nonce attribute on script tag", async () => {
    const nonce = "abc-123-nonce";
    const res = renderBindPage("test@memory.flarelylegal.com", nonce);
    const html = await res.text();
    expect(html).toContain(`nonce="${nonce}"`);
  });

  it("renders the bind form with required fields", async () => {
    const res = renderBindPage("test@memory.flarelylegal.com", "n");
    const html = await res.text();
    expect(html).toContain('id="ci"'); // client ID input
    expect(html).toContain('id="cs"'); // client secret input
    expect(html).toContain('id="lb"'); // label input
    expect(html).toContain('type="submit"');
  });

  it("includes client ID pattern validation", async () => {
    const res = renderBindPage("test@memory.flarelylegal.com", "n");
    const html = await res.text();
    expect(html).toContain('pattern="[a-f0-9]{32}\\.access"');
  });
});
