import { defineConfig } from '@playwright/test'
import smoke from './playwright.smoke.config'

// Run against a separately compiled mock frontend (see mock-contract.spec.ts).
// Live-suite setup/teardown must never reserve dates or remove server fixtures here.
if (!process.env.SMOKE_MOCK_APP) {
  throw new Error('Mock browser suite requires SMOKE_MOCK_APP pointing to the separate mock frontend')
}

export default defineConfig({
  ...smoke,
  testMatch: ['mock-contract.spec.ts', 'mock-visit-object-stages.spec.ts'],
  globalSetup: undefined,
  globalTeardown: undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/mock-contract',
  use: {
    ...smoke.use,
    baseURL: process.env.SMOKE_MOCK_APP,
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
