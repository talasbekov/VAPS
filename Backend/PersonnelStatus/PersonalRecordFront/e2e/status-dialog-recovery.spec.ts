import { expect, test, type Page } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
async function prepare(page: Page) {
  const state = { permissions: ['status.view', 'status.workspace', 'status.manage', 'forces.allocate'], scope: [3] as number[] | undefined, permissionFailure: false, permissionReads: 0,
    writes: [] as string[], failRead: false, rejectWrite: false, hold: false, release: () => {}, staffReads: 0 };
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/')
    ? route.fulfill({ status: 403, json: { detail: 'Unmocked writes forbidden' } }) : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => {
    state.permissionReads++;
    return state.permissionFailure ? route.fulfill({ status: 403, json: { detail: 'Permission read failed' } }) : route.fulfill({ json: {
      permissions: state.permissions, global_permissions: [], status_manage_division_ids: state.scope,
      roles: [{ code: 'DEPARTMENT_EXPENSE_OFFICER', name: 'Ответственный', scope_division_id: 2, scope_division_name: 'Департамент' }],
    } });
  });
  const current = { id: 5256, status_type: 'vacation', state: 'active', start_date: '2026-10-09', end_date: '2026-10-30', comment: '' };
  const unit = { id: 10, index: 1, parent_id: null, vacancy: null, division: { id: 3, name: 'Управление' }, directorate_id: 3, directorate_name: 'Управление', employee: { id: 1, last_name: 'Тестовый', first_name: 'Сотрудник', current_status: current }, position: { id: 1, name: 'Инспектор', level: 1 } };
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => { state.staffReads++; return route.fulfill({ json: { division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false } }); });
  await page.route('**/api/statuses/statuses/planned/**', route => state.failRead ? route.fulfill({ status: 503, json: { detail: 'Read unavailable after accepted mutation' } }) : route.fulfill({ json: { current: state.writes.length ? null : current, planned: [] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 1, next: null, results: [{ id: 1, code: 'IN_SERVICE', name: 'В строю', report_column_code: 'ready', is_active: true }] } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'В строю', color: '' }, { code: 'vacation', label: 'В отпуске', color: '' }] }));
  await page.route('**/api/statuses/statuses/5256/terminate/**', async route => {
    expect(route.request().method()).toBe('POST');
    state.writes.push('terminate');
    if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
    await route.fulfill({ status: state.rejectWrite ? 400 : 200, json: state.rejectWrite ? { error: 'Mutation rejected by fixture' } : { ...current, state: 'completed' } });
  });
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-10', blocked: false, laggards: [] } }));
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  expect((await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } })).ok()).toBeTruthy();
  return state;
}
async function openPlanned(page: Page) {
  await page.goto(APP + '/statuses/');
  await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Запланированные статусы', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Текущий статус', { exact: true })).toBeVisible();
  return dialog;
}
async function planned(page: Page) {
  const dialog = await openPlanned(page);
  await dialog.getByRole('button', { name: 'Завершить досрочно', exact: true }).click();
  await dialog.getByLabel('Причина', { exact: false }).fill('Сохранённая причина');
  return dialog;
}
async function daily(page: Page) {
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
    { id: '2', name: 'Департамент', parent_id: null, division_type: 'department', without_status: 0 },
    { id: '3', name: 'Управление', parent_id: '2', division_type: 'directorate', without_status: 1 },
  ] } }));
  const row = (id: number, count: number) => ({ division_id: id, name: String(id), list_total: count, staff_total: count, vacancies: 0, attached: 0, off_list: 0, columns: { ready: count }, event: { group: 0, squad: 0 } });
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: '2026-10-09', columns: ['ready'], column_labels: { ready: 'В строю' }, rows: [row(2, 0), row(3, 1)], totals: row(2, 1), warnings: [] } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [{ id: '1', full_name: 'Тестовый Сотрудник', rank_code: 'Майор', division_id: '3' }] } }));
  await page.goto(APP + '/employees?view=daily&businessDate=2026-10-09');
  const screen = page.getByRole('region', { name: 'Расход департамента', exact: true });
  await screen.getByRole('table').getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first().click();
  await screen.getByRole('table').getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first().click();
  await screen.getByRole('button', { name: 'Проставить статус: Тестовый Сотрудник', exact: true }).click();
  return page.getByRole('dialog');
}

test.describe('status dialog recovery and current authorization', () => {
  test.setTimeout(45_000);
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated UI; all non-auth writes intercepted');
  test('accepted termination followed by read failure only offers a read retry', async ({ page }) => {
    const state = await prepare(page); const dialog = await planned(page); const before = state.staffReads;
    state.failRead = true;
    await dialog.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(dialog.getByText(/Изменение сохранено/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Завершить', exact: true })).toHaveCount(0);
    await expect.poll(() => state.staffReads).toBeGreaterThan(before);
    expect(state.writes).toEqual(['terminate']);
    state.failRead = false;
    await dialog.getByRole('button', { name: 'Повторить загрузку статусов', exact: true }).click();
    await expect(dialog.getByText('Текущий активный статус отсутствует.')).toBeVisible();
    expect(state.writes).toEqual(['terminate']);
  });
  test('pending termination cannot be dismissed and rejected mutation keeps its draft', async ({ page }) => {
    const state = await prepare(page); const dialog = await planned(page);
    state.hold = true; state.rejectWrite = true;
    await dialog.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    try {
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    } finally { state.release(); }
    await expect(dialog.getByText('Mutation rejected by fixture')).toBeVisible();
    await expect(dialog.getByLabel('Причина', { exact: false })).toHaveValue('Сохранённая причина');
    expect(state.writes).toEqual(['terminate']);
  });
  for (const action of ['extend', 'edit'] as const) test(`accepted ${action} followed by read failure never replays the mutation`, async ({ page }) => {
    const state = await prepare(page);
    const current = { id: 5256, status_type: 'vacation', state: 'active', start_date: '2026-10-09', end_date: '2026-10-30', comment: '' };
    const future = { ...current, id: 5257, state: 'planned', state_display: 'Запланирован', start_date: '2026-11-05', end_date: '2026-11-10', comment: 'Исходный комментарий' };
    await page.route('**/api/statuses/statuses/planned/**', route => state.failRead
      ? route.fulfill({ status: 503, json: { detail: 'Read unavailable after accepted mutation' } })
      : route.fulfill({ json: { current, planned: [future] } }));
    await page.route(action === 'extend' ? '**/api/statuses/statuses/5256/extend/**' : '**/api/statuses/statuses/5257/**', route => {
      state.writes.push(action);
      if (action === 'extend') { expect(route.request().postDataJSON().new_end_date).toBe('2026-10-31'); current.end_date = '2026-10-31'; }
      else { expect(route.request().method()).toBe('PATCH'); future.comment = route.request().postDataJSON().comment; }
      return route.fulfill({ json: action === 'extend' ? current : future });
    });
    const dialog = await openPlanned(page);
    if (action === 'extend') {
      await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
      await dialog.locator('#extend-date').click();
      const day = await page.evaluate(() => new Date('2026-10-31T12:00:00').toLocaleDateString());
      await page.locator(`[data-slot="calendar"] button[data-day="${day}"]`).click();
    } else {
      await dialog.getByRole('button', { name: 'Изменить запланированный статус: Запланирован', exact: true }).click();
      await dialog.getByRole('textbox').fill('Новый комментарий');
    }
    state.failRead = true;
    await dialog.getByRole('button', { name: action === 'extend' ? 'Продлить' : 'Сохранить', exact: true }).click();
    await expect(dialog.getByText(/Изменение сохранено/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Запланировать статус: Тестовый Сотрудник', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    expect(state.writes).toEqual([action]);
    state.failRead = false;
    await dialog.getByRole('button', { name: 'Повторить загрузку статусов', exact: true }).click();
    await expect(dialog.getByText(/Изменение сохранено/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Запланировать статус: Тестовый Сотрудник', exact: true })).toBeEnabled();
    expect(state.writes).toEqual([action]);
  });
  for (const change of ['revoke', 'scope', 'unknown scope'] as const) test(`daily draft survives ${change} while save is disabled`, async ({ page }) => {
    const state = await prepare(page); const dialog = await daily(page);
    await dialog.getByRole('textbox', { name: 'Комментарий', exact: false }).fill('Черновик расхода');
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    if (change === 'revoke') state.permissions = ['status.view', 'status.workspace', 'forces.allocate'];
    if (change === 'scope') state.scope = [99];
    if (change === 'unknown scope') state.scope = undefined;
    const before = state.permissionReads;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Комментарий', exact: false })).toHaveValue('Черновик расхода');
    state.permissions = ['status.view', 'status.workspace', 'status.manage', 'forces.allocate']; state.scope = [3]; state.permissionFailure = false;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
    expect(state.writes).toEqual([]);
  });
});
