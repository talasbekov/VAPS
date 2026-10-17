import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
test.describe('portal permission refresh recovery', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated frontend');
  for (const path of ['/statuses/', '/dashboard/']) {
    test(`${path} distinguishes a failed permission check from denied access`, async ({ page }) => {
      await page.route('**/api/**', route => {
        const request = route.request();
        return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
          ? route.abort('blockedbyclient') : route.continue();
      });
      let failed = false;
      let reads = 0;
      await page.route('**/api/operations/my-permissions/**', route => {
        reads++;
        return failed
          ? route.fulfill({ status: 503, json: { detail: 'Temporary permission failure' } })
          : route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } });
      });
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
      const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
      });
      expect((await login.json()).url).not.toContain('error=');
      await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' });
      await expect.poll(() => reads).toBeGreaterThan(0);
      const initialReads = reads;
      failed = true;
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
      await expect.poll(() => reads).toBeGreaterThan(initialReads);
      const unavailable = page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true });
      await expect(unavailable).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toHaveCount(0);
      failed = false;
      await page.getByRole('button', { name: 'Повторить', exact: true }).click();
      await expect(unavailable).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toHaveCount(0);
    });
  }
});
