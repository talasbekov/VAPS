import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

test('overview keeps totals visible and reveals status details on demand', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires real scoped overview data');
  const csrf = await (await page.request.get('/api/auth/csrf/')).json();
  const login = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto('/dashboard/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Всего сотрудников', { exact: true })).toBeVisible();
  await expect(page.getByText('Всего отсутствий', { exact: true })).toBeVisible();
  const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Подробная сводка статусов' }) });
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByText('Отпуска', { exact: true })).not.toBeVisible();
  await details.locator('summary').click();
  await expect(page.getByText('Отпуска', { exact: true })).toBeVisible();
  await expect(page.getByText('Больничные', { exact: true })).toBeVisible();
  await details.locator('summary').click();
  await expect(page.getByText('Больничные', { exact: true })).not.toBeVisible();
});
