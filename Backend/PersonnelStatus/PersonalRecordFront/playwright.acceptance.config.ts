import { defineConfig } from '@playwright/test'
import smoke from './playwright.smoke.config'

// Acceptance data must never touch the shared stand or its global cleanup.
if (!['http://localhost:3110', 'http://localhost:3108'].includes(process.env.SMOKE_APP ?? '') ||
    process.env.SMOKE_API !== 'http://127.0.0.1:8102' ||
    process.env.PR_DB_NAME !== 'personnel_records_1090' || process.env.SMOKE_LIVE !== '1') {
  throw new Error('Acceptance requires SMOKE_LIVE=1, isolated SMOKE_APP (:3110/:3108), SMOKE_API=http://127.0.0.1:8102 and PR_DB_NAME=personnel_records_1090')
}

export default defineConfig(smoke, {
  globalSetup: undefined,
  globalTeardown: undefined,
  expect: { timeout: 30_000 },
  testMatch: ['forces-workspace.spec.ts', 'role-driven-acceptance.spec.ts', 'placement-rights-rules.spec.ts', 'auto-placement-reconcile.spec.ts', 'smoke-preserve-data.spec.ts'],
  outputDir: '/tmp/1090-acceptance-results',
  use: { baseURL: process.env.SMOKE_APP, actionTimeout: 30_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
