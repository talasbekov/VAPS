import path from 'node:path';
import { defineConfig } from '@playwright/test';

// The suite reads a separately provisioned synthetic Django/PostgreSQL stand.
// Discovery is offline; execution must opt in with an explicit origin and fixture.
const listing = process.argv.includes('--list');
const origin = process.env.ASSISTANT_ACCEPTANCE_BASE_URL;
if (!origin && !listing) throw new Error('Set ASSISTANT_ACCEPTANCE_BASE_URL to the isolated loopback stand. This suite never starts a server.');
const url = new URL(origin || 'http://127.0.0.1:3398');
if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('ASSISTANT_ACCEPTANCE_BASE_URL must be a loopback HTTP origin without credentials or a path.');
}
if (!listing && (!process.env.ASSISTANT_ACCEPTANCE_FIXTURE_PATH || !process.env.ASSISTANT_ACCEPTANCE_PASSWORD)) {
  throw new Error('Set ASSISTANT_ACCEPTANCE_FIXTURE_PATH and ASSISTANT_ACCEPTANCE_PASSWORD for the two synthetic accounts.');
}

if (!listing && !/^[a-f0-9]{64}$/.test(process.env.ASSISTANT_ACCEPTANCE_BACKEND_CONTAINER || '')) {
  throw new Error('Set ASSISTANT_ACCEPTANCE_BACKEND_CONTAINER to the full ID of the newly owned synthetic backend.');
}

export default defineConfig({
  testDir: './e2e', testMatch: 'om-assistant-real.spec.ts', workers: 1, retries: 0,
  timeout: 240_000, expect: { timeout: 12_000 },
  outputDir: process.env.ASSISTANT_ACCEPTANCE_RESULTS_DIR
    ? path.join(process.env.ASSISTANT_ACCEPTANCE_RESULTS_DIR, 'cases') : 'test-results/assistant-acceptance',
  reporter: 'list',
  use: {
    baseURL: url.origin, serviceWorkers: 'block', actionTimeout: 15_000,
    viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
});
