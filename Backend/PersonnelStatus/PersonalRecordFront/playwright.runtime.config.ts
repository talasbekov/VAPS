import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "frontend-runtime.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results/frontend-runtime",
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3300",
    viewport: { width: 1600, height: 1000 },
    headless: true,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
