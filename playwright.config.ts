import { defineConfig } from "@playwright/test";

const target = (process.env.API_TARGET ?? "a").toLowerCase();
const isB = target === "b";

const baseURL =
  (isB ? process.env.API_BASE_URL_B : process.env.API_BASE_URL_A) ??
  process.env.API_BASE_URL ??
  "https://memory.schenanigans.com";

const clientId =
  (isB ? process.env.CF_ACCESS_CLIENT_ID_B : process.env.CF_ACCESS_CLIENT_ID_A) ??
  process.env.CF_ACCESS_CLIENT_ID ??
  "";

const clientSecret =
  (isB ? process.env.CF_ACCESS_CLIENT_SECRET_B : process.env.CF_ACCESS_CLIENT_SECRET_A) ??
  process.env.CF_ACCESS_CLIENT_SECRET ??
  "";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  use: {
    baseURL,
    extraHTTPHeaders: {
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
    },
  },
});
