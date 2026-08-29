import { defineConfig } from '@playwright/test'
import path from 'node:path'
export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  testMatch: ['role-accounts-walk.spec.ts'],
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  use: { viewport: { width: 1440, height: 900 } },
})
