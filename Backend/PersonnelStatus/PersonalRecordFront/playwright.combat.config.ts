import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: ['combat-day-live.spec.ts', 'combat-smoke-safety.spec.ts'], workers: 1, retries: 0, timeout: 300_000,
  reporter: [['list']], use: { ...devices['Desktop Chrome'], channel: 'msedge', baseURL: process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3317', headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Qyzylorda', locale: 'ru-RU', actionTimeout: 20_000, trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
