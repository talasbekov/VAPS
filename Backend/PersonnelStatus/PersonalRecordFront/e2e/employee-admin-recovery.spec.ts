import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
async function setup(page: Page, failed = '', globalAccounts = true) {
  const state = { failed, permissions: ['*'], permissionReads: 0, writes: [] as any[], release: () => {}, hold: false };
  const held = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => { state.permissionReads++; return route.fulfill({ json: { permissions: state.permissions, global_permissions: globalAccounts ? ['*'] : [], roles: [] } }); });
  await page.route('**/api/core/service-employees/**', route => route.fulfill({ json: route.request().url().includes('/options/') ? { divisions: [{ id: 3, name: 'Отдел', level: 0 }], statuses: [] } : route.request().url().includes('/1/') ? { id: 1, full_name: 'Исходный Сотрудник', callsign: '', division: { id: 3, name: 'Отдел' } } : { count: 0, results: [] } }));
  for (const kind of ['ranks', 'positions']) await page.route(`**/api/dictionaries/${kind}/**`, route => route.fulfill(state.failed === kind ? { status: 403, json: { detail: 'Fixture failure' } } : { json: { results: [{ id: 7, name: 'Архивное значение', is_active: false }, { id: 8, name: 'Активное значение', is_active: true }, { id: 9, name: 'Другое архивное', is_active: false }] } }));
  await page.route('**/api/**/accounts/**', route => route.fulfill(state.failed === 'accounts' ? { status: 403, json: { detail: 'Fixture account failure' } } : { json: { results: new URL(route.request().url()).searchParams.get('search') ? [{ id: 12, username: 'other', full_name: 'Другой' }] : [{ id: 11, username: 'selected', full_name: 'Выбранный' }], count: 1 } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', async route => {
    if (route.request().method() !== 'GET') {
      state.writes.push(route.request().postDataJSON());
      if (state.hold) await held;
      return route.fulfill({ status: 400, json: { detail: 'Fixture save rejected' } });
    }
    return route.fulfill(state.failed === 'staffing' ? { status: 503, json: { detail: 'Fixture failure' } } : { json: { staff_units: [{ id: 1, employee: { id: 1, first_name: 'Сотрудник', last_name: 'Исходный' }, division: { id: 3, name: 'Отдел' }, position: { id: 7, name: 'Архивное значение' }, management: { staff_unit_id: 1, middle_name: '', callsign: '', rank_id: 7, user: { id: 10, username: 'original' }, is_active: true } }] } });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/service-employees/?edit=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  return state;
}

test.describe('employee admin recovery', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated browser with all non-auth writes intercepted');
  test('new account selection survives search and rejected save', async ({ page }) => {
    const state = await setup(page);
    await page.locator('#staff-user').selectOption('11');
    await page.locator('#staff-last-name').fill('Черновик');
    await page.locator('#staff-account-search').fill('other');
    await expect(page.locator('#staff-user option[value="12"]')).toHaveCount(1);
    await expect(page.locator('#staff-user')).toHaveValue('11');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].employees[0].user).toBe(11);
    expect(state.writes[0].employees[0].rank).toBe(7);
    expect(state.writes[0].staff_units[0].position).toBe(7);
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    await expect(page.locator('#staff-user')).toHaveValue('11');
    await expect(page.locator('#staff-last-name')).toHaveValue('Черновик');
    await expect(page.locator('#staff-rank option[value="9"]')).toHaveCount(0);
  });
  for (const failed of ['ranks', 'positions', 'staffing']) test(`${failed} failure blocks save and recovers`, async ({ page }) => {
    const state = await setup(page, failed);
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    expect(state.writes).toHaveLength(0);
    state.failed = '';
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.locator('#staff-rank')).toHaveValue('7');
    await expect(page.locator('#staff-position')).toHaveValue('7');
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  });
  test('pending save ignores dismissal and duplicate submission', async ({ page }) => {
    const state = await setup(page);
    state.hold = true;
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    state.release();
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    expect(state.writes).toHaveLength(1);
  });
  test('account retry retains the draft and original binding', async ({ page }) => {
    const state = await setup(page, 'accounts');
    await page.locator('#staff-last-name').fill('Черновик');
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible({ timeout: 30000 });
    state.failed = '';
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.locator('#staff-user option[value="11"]')).toHaveCount(1);
    await expect(page.locator('#staff-last-name')).toHaveValue('Черновик');
    await expect(page.locator('#staff-user')).toHaveValue('10');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].employees[0].user).toBe(10);
  });
  test('scoped administrator omits the account binding', async ({ page }) => {
    const state = await setup(page, '', false);
    await expect(page.locator('#staff-user')).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].employees[0]).not.toHaveProperty('user');
  });
  test('revoked permissions close an open draft and returning grants do not restore it', async ({ page }) => {
    const state = await setup(page);
    await page.goto(`${APP}/service-employees/`);
    await page.getByRole('button', { name: 'Добавить сотрудника', exact: true }).click();
    await page.locator('#staff-last-name').fill('Черновик');
    state.permissions = ['status.view'];
    const before = state.permissionReads;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: 'Добавить сотрудника', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    state.permissions = ['*'];
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('button', { name: 'Добавить сотрудника', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });
});
