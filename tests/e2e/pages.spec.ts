/**
 * Browser tests for HTML pages: landing page and service token bind UI.
 *
 * Uses a real Chromium browser (via Playwright) against the live Worker.
 * Service token headers (CF-Access-Client-Id / CF-Access-Client-Secret)
 * are injected via extraHTTPHeaders in the Playwright config, so
 * Cloudflare Access authenticates every browser request automatically.
 *
 * Screenshots are saved to tests/e2e/screenshots/ for visual review.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "fs";

const SCREENSHOT_DIR = "tests/e2e/screenshots";

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

// ── Landing page ──────────────────────────────────────────────────

test.describe("landing page", () => {
  test("renders with correct title and health status", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Memory MCP Server");

    // Health status pill should resolve to "online"
    const status = page.locator("#st");
    await expect(status).toHaveText("online", { timeout: 10_000 });
    await expect(status).toHaveClass(/ok/);
  });

  test("displays about section and quick links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=About")).toBeVisible();
    await expect(page.locator("text=Quick links")).toBeVisible();
    await expect(page.locator('a[href="/api/docs"]')).toBeVisible();
    await expect(page.locator('a[href="/api/v1/admin/service-tokens/bind"]')).toBeVisible();
  });

  test("screenshot", async ({ page }) => {
    await page.goto("/");
    // Wait for health check to resolve
    await expect(page.locator("#st")).toHaveText("online", { timeout: 10_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/landing.png`, fullPage: true });
  });
});

// ── Service token bind UI ─────────────────────────────────────────

test.describe("bind UI page", () => {
  test("renders with form fields and token list", async ({ page }) => {
    await page.goto("/api/v1/admin/service-tokens/bind");
    await expect(page).toHaveTitle("Service Token Management");

    // Form fields present
    await expect(page.locator("#ci")).toBeVisible();
    await expect(page.locator("#cs")).toBeVisible();
    await expect(page.locator("#lb")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("shows signed-in email in header", async ({ page }) => {
    await page.goto("/api/v1/admin/service-tokens/bind");
    // The header should show the authenticated user's email
    const header = page.locator("header p");
    await expect(header).not.toBeEmpty();
  });

  test("loads bound token list", async ({ page }) => {
    await page.goto("/api/v1/admin/service-tokens/bind");
    // Token list area should resolve (either shows tokens or "No tokens bound")
    const tokenList = page.locator("#tl");
    await expect(tokenList).not.toHaveText("Loading...", { timeout: 10_000 });
  });

  test("client-side validation rejects bad client ID", async ({ page }) => {
    await page.goto("/api/v1/admin/service-tokens/bind");

    // Fill invalid client ID (too short, missing .access suffix)
    await page.fill("#ci", "not-valid");
    await page.fill("#cs", "a".repeat(64));
    await page.click('button[type="submit"]');

    // Status message should show validation error
    const status = page.locator("#status");
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/error/);
  });

  test("screenshot", async ({ page }) => {
    await page.goto("/api/v1/admin/service-tokens/bind");
    // Wait for token list to load
    await expect(page.locator("#tl")).not.toHaveText("Loading...", { timeout: 10_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/bind-ui.png`, fullPage: true });
  });
});
