import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'api-gap-rules.spec.ts',
    'business-date-slices.spec.ts',
    'permission-denied-dialogs.spec.ts',
    'placement-rights-rules.spec.ts',
    'forces-link-gating.spec.ts',
    'event-capabilities.spec.ts',
    'backend-layout.spec.ts',
    'daily-employees-batch.spec.ts',
  ],
  workers: 1,
  reporter: 'line',
})
