import { defineConfig } from '@playwright/test'
import path from 'node:path'
export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  testMatch: ['role-access.spec.ts'],
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.SMOKE_API ?? 'http://127.0.0.1:8100',
    viewport: { width: 1440, height: 900 },
  },
})
