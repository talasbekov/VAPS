import { defineConfig } from '@playwright/test';

// The shared fixture validates credentials while importing, even for discovery.
if (process.argv.includes('--list')) process.env.SMOKE_PASSWORD ??= 'list-only-no-authentication';

// This configuration never launches a server. Runtime tests need a separately
// authorized fixture stand; --list only checks scenario discovery.
export default defineConfig({
  testDir: './e2e', testMatch: 'om-assistant.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: 'test-results/assistant-dialogue', reporter: 'list',
  use: {
    baseURL: process.env.ASSISTANT_DIALOGUE_BASE_URL || 'http://127.0.0.1:3390',
    serviceWorkers: 'block', actionTimeout: 15_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
