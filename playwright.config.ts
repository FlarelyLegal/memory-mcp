import { defineConfig } from "@playwright/test";

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
    baseURL: process.env.API_BASE_URL ?? "https://memory.schenanigans.com",
    extraHTTPHeaders: {
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    },
  },
});
