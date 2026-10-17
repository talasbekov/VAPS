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
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated portal; effective grants and staff/secondments use explicit browser fixtures');
  test('incoming failure can retry; missing related data stays readable without invalid decisions', async ({ page }) => {
    await prepare(page, ['status.view', 'status.manage']);
    let recovered = false;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/secondments/secondment-requests/incoming/', route => route.fulfill(recovered
      ? { json: [
        { id: 1, status: 'pending', employee_detail: null, from_division_detail: null, to_division_detail: null },
        { id: 2, status: 'pending', employee_detail: { full_name: 'Сотрудник без отправителя' }, from_division_detail: null, to_division_detail: { id: 3, name: 'Получатель' } },
      ] }
      : { status: 503, json: { detail: 'Explicit incoming fixture failure' } }));
    await page.goto(APP + '/statuses/');
    await page.getByRole('button', { name: 'Прикомандировать', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const retry = dialog.getByRole('button', { name: 'Повторить загрузку', exact: true });
    await expect(retry).toBeVisible({ timeout: 30000 });
    recovered = true;
    await retry.click();
    await expect(dialog.getByText('Сотрудник не указан', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Недостаточно данных для решения', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Одобрить', exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Одобрить', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Обновить список', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test('incoming long names keep dialog content within a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, ['status.view', 'status.manage']);
    await page.route('**/api/secondments/secondment-requests/incoming/', route => route.fulfill({ json: [{
      id: 1, status: 'pending', employee_detail: { full_name: 'Константинопольский Александр Константинович' },
      from_division_detail: { id: 5, name: 'Управление организационного планирования и подготовки мероприятий' },
      to_division_detail: { id: 3, name: 'Управление обеспечения безопасности охраняемых объектов' },
      start_date: '2026-10-09', end_date: '2026-10-12',
    }] }));
    await page.goto(APP + '/statuses/');
    await page.getByRole('button', { name: 'Прикомандировать', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Одобрить', exact: true })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const button = await dialog.getByRole('button', { name: 'Отклонить', exact: true }).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(390);
  });
  test('readable B stays selectable for forces but cannot be edited or silently included in bulk status update', async ({ page }) => {
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
    await other.getByRole('checkbox').check();
    await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
    await expect(page.getByText('Среди выбранных есть сотрудники', { exact: false })).toBeVisible();
  });
  test('daily report generator is not offered the protected audit journal', async ({ page }) => {
    await prepare(page, ['daily_report.generate']);
    await page.goto(APP + '/reports/');
    await expect(page.getByRole('heading', { name: 'Отчеты', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть журнал', exact: true })).toHaveCount(0);
  });
  test('completed secondments have status labels; pending decision disables both actions until refreshed', async ({ page }) => {
    await prepare(page, ['status.view', 'status.manage']);
    let release!: () => void;
    const pendingResponse = new Promise<void>(resolve => { release = resolve; });
    let decided = false;
    await page.route('**/api/secondments/secondment-requests/incoming/', route => route.fulfill({ json: ['pending', 'approved', 'rejected', 'cancelled'].map((status, index) => ({ id: index + 1, status: index === 0 && decided ? 'approved' : status, employee_detail: { full_name: `Запрос ${index + 1}` }, from_division_detail: { id: 5, name: 'Отправитель' }, to_division_detail: { id: 3, name: 'Получатель' }, start_date: '2026-10-08', end_date: '2026-10-09' })) }));
    await page.route('**/api/secondments/secondment-requests/1/approve/', async route => { await pendingResponse; decided = true; await route.fulfill({ json: { status: 'approved' } }); });
    await page.goto(APP + '/statuses/');
    await page.getByRole('button', { name: 'Прикомандировать', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Одобрить', exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Прикомандирование завершено', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Одобрить', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Отклонить', exact: true })).toBeDisabled();
    release();
    await expect(dialog.getByRole('button', { name: 'Одобрить', exact: true })).toHaveCount(0);
  });
});
