import { defineConfig } from '@playwright/test';
const baseURL = process.env.AI_SETTINGS_BASE_URL || 'http://127.0.0.1:3391';

// Isolated frontend with synthetic authentication; every API request is intercepted.
export default defineConfig({
  testDir: './e2e', testMatch: 'ai-settings.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: 'test-results/ai-settings', reporter: 'list',
  use: { baseURL, serviceWorkers: 'block', actionTimeout: 15_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ['--host-resolver-rules=MAP smart-http.test 127.0.0.1'] } },
  webServer: process.env.AI_SETTINGS_BASE_URL ? undefined : {
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3391',
    url: 'http://127.0.0.1:3391', reuseExistingServer: false, timeout: 180_000,
    env: { NEXTAUTH_SECRET: 'ai-settings-browser-fixture-only', NEXTAUTH_URL: 'http://127.0.0.1:3391',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3391', BACKEND_URL: 'http://127.0.0.1:1',
      NEXT_DIST_DIR: '.next-ai-settings', NEXT_PUBLIC_OPS_MOCK_DOMAINS: '', NEXT_PUBLIC_OPS_DATA_SOURCE: 'api' },
  },
});
