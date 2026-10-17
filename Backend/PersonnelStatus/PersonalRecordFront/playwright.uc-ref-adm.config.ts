import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "uc-ref-adm.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  outputDir: "../.playwright-mcp/uc-ref-adm",
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3300",
    viewport: { width: 1600, height: 1000 },
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
