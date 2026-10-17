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

test.describe('role assignments: complete list and trustworthy scope', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal; all administration data uses browser-only fixtures');

  test('later active assignments and missing scope names remain visible; failed scopes block ordinary grants', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['admin.roles'], global_permissions: ['admin.roles'], roles: [],
    } }));
    const account = { id: 42, username: 'scope-fixture', first_name: 'Тест', last_name: 'Назначений', full_name: 'Тест Назначений', email: '', is_active: true, last_login: null, employee_id: null };
    await page.route('**/api/operations/accounts/**', route => route.fulfill({ json: {
      count: 1, next: null, previous: null, results: route.request().url().includes('employee-options') ? [] : [account],
    } }));
    await page.route('**/api/operations/accounts/42/', route => route.fulfill({ json: account }));
    await page.route('**/api/operations/roles/**', route => route.fulfill({ json: {
      count: 2, next: null, previous: null, results: [
        { code: 'READER', name: 'Чтение', permissions: ['status.view'], is_active: true },
        { code: 'GLOBAL_ADMIN', name: 'Администратор', permissions: ['*'], is_active: true },
      ],
    } }));
    let assignmentPages = 0;
    await page.route('**/api/operations/user-roles/**', route => {
      expect(route.request().method()).toBe('GET');
      assignmentPages++;
      const later = new URL(route.request().url()).searchParams.has('offset');
      const assignment = { user_id: '42', user_login: account.username, role_code: 'READER', role_name: 'Чтение', scope_division_id: 77, scope_division_name: null };
      return route.fulfill({ json: {
        count: 51, previous: null, next: later ? null : 'http://backend.test/api/operations/user-roles/?user_id=42&offset=50&limit=50',
        results: later ? [{ ...assignment, id: 51, is_active: true }] : Array.from({ length: 50 }, (_, index) => ({ ...assignment, id: index + 1, is_active: false })),
      } });
    });
    let scopesRecover = false;
    await page.route('**/api/divisions/divisions_tree/**', route => route.fulfill(scopesRecover
      ? { json: { id: 77, name: 'Управление теста', children: [] } }
      : { status: 503, json: { detail: 'Browser fixture: scopes unavailable' } }));
    await authenticate(page);
    await page.goto(APP + '/settings/users/?user=42', { waitUntil: 'domcontentloaded' });
    const grant = page.getByRole('button', { name: 'Выдать', exact: true });
    await page.getByLabel('Роль', { exact: true }).selectOption('READER');
    await expect(grant).toBeDisabled();
    await expect(page.getByText('Подразделение #77', { exact: false })).toBeVisible();
    expect(assignmentPages).toBe(2);
    await page.getByRole('button', { name: 'Снять', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Подразделение #77');
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    const scopeFailure = page.getByRole('alert').filter({ hasText: 'области назначения' });
    await expect(scopeFailure).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('Область', { exact: true })).toBeDisabled();
    await page.getByLabel('Роль', { exact: true }).selectOption('GLOBAL_ADMIN');
    await expect(grant).toBeEnabled();
    await expect(page.getByLabel('Область', { exact: true })).toHaveValue('WHOLE_SERVICE');
    await page.getByLabel('Роль', { exact: true }).selectOption('READER');
    await expect(grant).toBeDisabled();
    scopesRecover = true;
    await scopeFailure.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByLabel('Область', { exact: true })).toBeEnabled();
    await page.getByLabel('Область', { exact: true }).selectOption('77');
    await expect(grant).toBeEnabled();
    // No assignment is created or revoked by this scenario.
  });
});
