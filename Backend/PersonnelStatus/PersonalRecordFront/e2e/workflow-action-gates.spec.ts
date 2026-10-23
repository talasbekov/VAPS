import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
async function prepare(page: Page, permissions: string[]) {
  await page.route('**/api/**', route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')) {
      return route.fulfill({ status: 403, json: { detail: 'Browser fixture forbids unmocked mutations' } });
    }
    return route.fallback();
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: [], status_manage_division_ids: [3], roles: [] } }));
  const units = [3, 5].map((division, index) => ({ id: 10 + index, division: { id: division, name: `Отдел ${division}` }, directorate_id: division, directorate_name: `Управление ${division}`, department_name: 'Департамент', index, vacancy: null, parent_id: null, employees: [{ position: { id: 1, name: 'Инспектор', level: 1 }, employee: { id: index + 1, first_name: index ? 'B' : 'A', last_name: 'Сотрудник', personnel_number: `TEST-${index}`, current_status: null } }] }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { division: null, staff_units: units, total_count: 2, matched_count: 2, page: 1, page_size: 50, has_next: false, summary: { employees: 2, without_status: 2, overdue: 0, scheduled: 0 } } });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  expect((await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } })).ok()).toBeTruthy();
}
test.describe('actions match effective rights and workflow state', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal; effective grants and staff use explicit browser fixtures');
  test('own division remains editable while another division stays readable without retired actions', async ({ page }) => {
    await prepare(page, ['status.view', 'status.manage', 'forces.select']);
    await page.goto(APP + '/statuses/');
    const own = page.locator('tr[data-employee-id="1"]');
    const other = page.locator('tr[data-employee-id="2"]');
    await own.getByRole('button', { name: 'Действия: Сотрудник A', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Изменить статус', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await other.getByRole('button', { name: 'Действия: Сотрудник B', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Изменить статус', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Только просмотр — правка статусов закрыта' })).toBeVisible();
    await page.keyboard.press('Escape');
    await own.getByRole('checkbox').check();
    await expect(other.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Таблица сотрудников', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Календарь статусов', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Массовое обновление', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Прикомандировать', exact: true })).toHaveCount(0);
  });
  test('daily report generator is not offered the protected audit journal', async ({ page }) => {
    await prepare(page, ['daily_report.generate']);
    await page.goto(APP + '/reports/');
    await expect(page.getByRole('heading', { name: 'Отчеты', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть журнал', exact: true })).toHaveCount(0);
  });
});
