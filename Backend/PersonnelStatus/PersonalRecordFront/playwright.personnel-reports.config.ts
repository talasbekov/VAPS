import { defineConfig } from "@playwright/test";

if (process.env.SMOKE_LIVE === "1" && (!process.env.SMOKE_APP || !process.env.SMOKE_API)) {
  throw new Error("Set SMOKE_APP and SMOKE_API explicitly for the isolated report test stand.");
}

// Read-only regression: the externally managed stand owns its lifecycle.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "personnel-reports.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: "test-results/personnel-reports",
  use: {
    baseURL: process.env.SMOKE_APP ?? "http://localhost:3106",
    headless: true,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
