import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
const account = { id: 42, username: 'selected-account', full_name: 'Выбранный пользователь', first_name: '', last_name: '', email: '', employee_id: null, employee_name: null, is_active: true, last_login: null };

async function prepare(page: Page) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['admin.roles'], global_permissions: ['admin.roles'], roles: [] } }));
  await page.route('**/api/operations/accounts/**', route => {
    const url = new URL(route.request().url());
    if (/\/42\/$/.test(url.pathname)) return route.fulfill({ json: account });
    if (url.pathname.includes('employee-options')) {
      const other = url.searchParams.get('search') === 'other';
      return route.fulfill({ json: { count: 1, results: [{ id: other ? 8 : 7, name: other ? 'Другой сотрудник' : 'Выбранный сотрудник', personnel_number: other ? 'P8' : 'P7', user_id: null }] } });
    }
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return route.fulfill({ json: { count: 51, previous: offset ? '/api/operations/accounts/' : null, next: offset ? null : '/api/operations/accounts/?offset=50', results: offset ? [{ ...account, id: 51, username: 'later-account' }] : [account] } });
  });
  for (const endpoint of ['roles', 'user-roles']) {
    await page.route(`**/api/operations/${endpoint}/**`, route => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
  }
  await page.route('**/api/divisions/divisions_tree/**', route => route.fulfill({ json: { id: 0, name: 'Служба', children: [] } }));
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  expect((await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } })).ok()).toBeTruthy();
}

test.describe('account administration preserves form state', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal with explicit browser-only account fixtures');

  test('later registry page keeps selected account; searching keeps chosen employee visible', async ({ page }) => {
    await prepare(page);
    await page.goto(APP + '/settings/users/?user=42');
    await expect(page.getByText(account.full_name, { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByRole('button', { name: 'later-account', exact: true })).toBeVisible();
    await expect(page.getByText(account.username, { exact: true })).toBeVisible();
    await page.locator('#account-employee').selectOption('7');
    await page.getByLabel('Поиск сотрудника для учётной записи').fill('other');
    await expect(page.locator('#account-employee option[value="8"]')).toHaveCount(1);
    await expect(page.locator('#account-employee')).toHaveValue('7');
    await expect(page.locator('#account-employee option:checked')).toContainText('Выбранный сотрудник');
    await page.getByLabel('Поиск по учётным записям').fill('new-search');
    await expect(page).toHaveURL(/search=new-search/);
    expect(new URL(page.url()).searchParams.has('offset')).toBe(false);
    await expect(page.locator('#account-employee')).toHaveValue('7');
  });

  test('pending creation survives Escape and reveals its one-time result', async ({ page }) => {
    await prepare(page);
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let submitted = false;
    await page.route('**/api/operations/accounts/', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      submitted = true;
      await delayed;
      await route.fulfill({ status: 201, json: { ...account, username: 'created-fixture', temporary_password: 'browser-fixture-only' } });
    });
    await page.goto(APP + '/settings/users/');
    await page.getByRole('button', { name: 'Завести учётку', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Логин', { exact: true }).fill('created-fixture');
    await dialog.getByRole('button', { name: 'Завести', exact: true }).click();
    await expect.poll(() => submitted).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(page.getByRole('dialog')).toContainText('browser-fixture-only');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toContainText('browser-fixture-only');
    await page.getByRole('dialog').locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
