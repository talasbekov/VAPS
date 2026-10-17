import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
async function authenticate(page: Page) {
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
}
test.describe('direct service summary permissions', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal; permission responses are browser-only fixtures');

  test('duty role without status.view cannot mount summary data queries', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: [], roles: [{ code: 'DUTY_OFFICER', name: 'Дежурный', scope_division_id: null }],
    } }));
    const reads: string[] = [];
    page.on('request', request => {
      if (/\/api\/operations\/(tomorrow-block|traffic-light|daily-submissions)\//.test(request.url())) reads.push(request.url());
    });
    await authenticate(page);
    await page.goto(APP + '/security-ops/service-summary/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Недостаточно прав для просмотра свода по Службе.', { exact: true })).toBeVisible();
    expect(reads).toEqual([]);
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Свод по Службе', exact: true })).toHaveCount(0);
  });

  test('failed permission refresh hides a previously loaded admin summary and retry recovers', async ({ page }) => {
    await page.route('**/api/operations/service-summary-context/**', route => route.fulfill({ json: { root_division_id: 1, root_name: 'Служба' } }));
    let failing = false;
    let permissionReads = 0;
    await page.route('**/api/operations/my-permissions/**', route => {
      permissionReads++;
      return route.fulfill(failing
        ? { status: 503, json: { error_code: 'UNAVAILABLE', message: 'Browser fixture: permissions unavailable' } }
        : { json: { permissions: ['*'], global_permissions: ['*'], roles: [] } });
    });
    await authenticate(page);
    await page.goto(APP + '/security-ops/service-summary/', { waitUntil: 'domcontentloaded' });
    const summary = page.getByRole('region', { name: 'Свод по Службе', exact: true });
    await expect(summary).toBeVisible();
    const initialReads = permissionReads;
    failing = true;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => permissionReads).toBeGreaterThan(initialReads);
    // The security-ops segment owns refresh failures and unmounts its pages.
    const failure = page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true });
    await expect(failure).toBeVisible({ timeout: 20000 });
    await expect(summary).toHaveCount(0);
    await expect(page).toHaveURL(/\/security-ops\/service-summary\/?$/);
    failing = false;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(summary).toBeVisible();
    await expect(failure).toHaveCount(0);
  });
});
