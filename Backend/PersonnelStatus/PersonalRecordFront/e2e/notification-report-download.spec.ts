import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';

test.describe('report notifications use authenticated downloads', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal; notification/report responses are explicit browser fixtures');
  for (const prefix of ['/api/reports/', '/api/reports/reports/']) {
    test(`${prefix} failure stays unread; retry downloads without API navigation`, async ({ page }) => {
      let reads = 0; let contentRequests = 0; let descriptors = 0;
      await page.route('**/api/notifications/notifications/unread/', route => route.fulfill({ json: reads ? [] : [{ id: 987654, notification_type: 'report_ready', title: 'Тестовый готовый отчёт', message: 'Скачать файл', link: `${prefix}42/download/`, is_read: false, created_at: '2026-10-08T12:00:00Z' }] }));
      await page.route('**/api/operations/notifications/**', route => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
      await page.route('**/api/notifications/notifications/987654/mark_read/', route => {
        expect(contentRequests).toBe(2);
        reads++;
        return route.fulfill({ json: { ok: true } });
      });
      await page.route('**/api/reports/reports/42/download/', route => {
        expect(route.request().isNavigationRequest()).toBe(false);
        expect(Boolean(route.request().headers().authorization?.startsWith('Bearer '))).toBe(true);
        descriptors++;
        return route.fulfill({ json: { download_url: '/api/reports/reports/42/content/' } });
      });
      await page.route('**/api/reports/reports/42/content/', route => {
        expect(route.request().isNavigationRequest()).toBe(false);
        expect(Boolean(route.request().headers().authorization?.startsWith('Bearer '))).toBe(true);
        contentRequests++;
        return contentRequests === 1
          ? route.fulfill({ status: 503, json: { detail: 'Explicit fixture failure' } })
          : route.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="fixture-report.xlsx"' }, body: 'browser fixture report' });
      });
      const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
      expect((await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } })).ok()).toBeTruthy();
      await page.goto(APP + '/dashboard/');
      const before = page.url();
      await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
      const report = page.getByRole('menuitem').filter({ hasText: 'Тестовый готовый отчёт' });
      await report.click();
      await expect(page.getByText('Не удалось скачать отчёт', { exact: true })).toBeVisible();
      expect(reads).toBe(0);
      expect(page.url()).toBe(before);
      await expect(report).toBeEnabled();
      const downloadPromise = page.waitForEvent('download');
      await report.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('fixture-report.xlsx');
      await expect.poll(() => reads).toBe(1);
      expect(descriptors).toBe(2);
      expect(page.url()).toBe(before);
    });
  }
});
