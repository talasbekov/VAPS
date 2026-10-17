import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
test.skip(process.env.SMOKE_LIVE !== '1', 'Requires the authenticated live portal');
test.beforeEach(async ({ page }) => {
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const response = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).url).not.toContain('error=');
});

for (const width of [390, 768]) {
  for (const [route, heading] of [
    ['/settings/permissions/', 'Права'], ['/settings/roles/', 'Роли'],
    ['/settings/users/', 'Пользователи'], ['/security-ops/persons/', 'Охраняемые лица'],
    ['/security-ops/ratings/', 'Оперативный рейтинг'],
  ]) {
    test(`${route}: content stays within ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(APP + route);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      if (route.startsWith('/settings/')) {
        await expect(page.locator('main tbody tr').first()).toBeVisible();
      } else if (route.includes('/persons/')) {
        await expect(page.getByRole('button', { name: /^Редактировать / }).first()).toBeVisible();
      } else {
        await expect(page.getByLabel('Сотрудник', { exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      if (route.includes('/ratings/')) {
        const select = await page.getByLabel('Сотрудник', { exact: true }).boundingBox();
        expect(select!.x + select!.width).toBeLessThanOrEqual(width);
      }
    });
  }
}

test('rating keeps the result visible and explains its limits on demand', async ({ page }) => {
  await page.goto(APP + '/security-ops/ratings/');
  await expect(page.getByRole('heading', { name: 'Оперативный рейтинг', exact: true })).toBeVisible();
  const help = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Как читать рейтинг' }) });
  await expect(help).toBeVisible();
  const calculation = help.getByRole('listitem').filter({ hasText: 'Дежурства учитываются отдельно от оперативного рейтинга.' });
  const privacy = help.getByRole('listitem').filter({ hasText: 'Здесь доступен общий результат, без раскрытия отдельных оценок.' });
  await expect(calculation).toBeHidden();
  await help.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(calculation).toBeVisible();
  await expect(privacy).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(privacy).toBeHidden();
});
