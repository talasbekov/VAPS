import { defineConfig } from '@playwright/test'
import smoke from './playwright.smoke.config'

// Isolated, read-only role routing checks must not purge shared live fixtures.
export default defineConfig({ ...smoke, globalSetup: undefined, globalTeardown: undefined,
  testMatch: ['forces-workspace.spec.ts'] })
