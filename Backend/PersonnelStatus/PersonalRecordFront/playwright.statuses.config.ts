import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'status-directorate-groups.spec.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  outputDir: 'test-results/status-directorate-groups',
  use: {
    baseURL: process.env.STATUS_TEST_BASE_URL ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3341',
    headless: true,
    serviceWorkers: 'block',
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
})
