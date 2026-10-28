import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Discovery is offline. Execution needs a separately started temporary frontend
// using NEXTAUTH_SECRET=guided-assistant-browser-fixture-only; all APIs are mocked.
// This configuration never starts a server or authenticates a real user.
const origin = process.env.GUIDED_ASSISTANT_BASE_URL;
if (!origin && !process.argv.includes('--list')) {
  throw new Error('Set GUIDED_ASSISTANT_BASE_URL to the loopback URL of a synthetic-auth frontend stand. This suite never starts a server.');
}
const url = new URL(origin || 'http://127.0.0.1:3393');
if (!['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('GUIDED_ASSISTANT_BASE_URL must be a loopback HTTP origin without credentials or a path.');
}

export default defineConfig({
  testDir: './e2e', testMatch: 'om-assistant-guided.spec.ts', workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 12_000 },
  outputDir: process.env.GUIDED_ASSISTANT_RESULTS_DIR
    ? path.join(process.env.GUIDED_ASSISTANT_RESULTS_DIR, 'cases') : 'test-results/guided-assistant',
  reporter: 'list',
  use: {
    baseURL: url.origin, serviceWorkers: 'block', actionTimeout: 15_000,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
});
