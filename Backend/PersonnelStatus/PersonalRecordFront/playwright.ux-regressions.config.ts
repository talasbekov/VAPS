import { defineConfig } from '@playwright/test';
import ux from './playwright.ux.config';

if (process.env.SMOKE_API !== 'http://127.0.0.1:18349' || process.env.SMOKE_APP !== 'http://127.0.0.1:3353') {
  throw new Error('Live UX regressions require the isolated copy: app 3353 and API 18349.');
}
if (process.env.SMOKE_LIVE === '1' && !process.env.E2E_FIXTURE_DATE_RANGE_START) {
  throw new Error('Reserve E2E fixture dates in the isolated database before running live placement scenarios.');
}

export default defineConfig(ux, {
  testMatch: [
    'e2e/placement-reopen.spec.ts',
    'e2e/placement-pool.spec.ts',
    'e2e/placement-rights-rules.spec.ts',
    'e2e/forces-request-banner-from-menu.spec.ts',
  ],
  timeout: 180_000,
});
