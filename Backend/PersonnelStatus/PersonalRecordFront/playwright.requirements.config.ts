import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/tests/personnel-requirements.spec.ts', '**/tests/status-directorate-groups.spec.ts', '**/e2e/ru-plural.spec.ts', '**/e2e/responsible-daily-expense.spec.ts'],
  // The unchanged live role smoke needs a separate stand with seeded role data.
  grepInvert: /живой расход роли/,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: 'test-results/personnel-requirements',
  use: { baseURL: process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3317', headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure', viewport: { width: 1600, height: 1000 }, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
})
