import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'e2e/ux-*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.UX_RESULTS_DIR ? path.join(process.env.UX_RESULTS_DIR, 'artifacts') : 'test-results/ux',
  reporter: process.env.UX_RESULTS_DIR
    ? [['list'], ['json', { outputFile: path.join(process.env.UX_RESULTS_DIR, 'results.json') }]]
    : 'list',
  use: {
    baseURL: process.env.SMOKE_APP ?? 'http://127.0.0.1:3352',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 15_000,
    serviceWorkers: 'block',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: process.env.UX_GRAPHICS_MODE === 'hardware'
        ? ['--enable-gpu', '--use-gl=angle', '--use-angle=d3d11']
        : undefined,
    },
  },
});
