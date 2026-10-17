import { expect, test, type Page } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
const date = '2026-10-09';

async function setup(page: Page, scenario = 'allowed') {
  const state = { permissions: scenario === 'reader' ? ['status.view', 'forces.select'] : scenario === 'corrector' ? ['status.view', 'daily_report.correct', 'forces.select'] : ['status.view', 'status.manage', 'forces.select'], scope: [3] as number[] | undefined,
    permissionError: false, permissionReads: 0, reportFail: false, reportFailures: 0, writes: [] as any[], blockedWrites: [] as string[],
    hold: false, reject: false, release: () => {} };
  await page.route('**/api/**', route => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || new URL(request.url()).pathname.startsWith('/api/auth/')) return route.fallback();
    state.blockedWrites.push(new URL(request.url()).pathname);
    return route.fulfill({ status: 403, json: { detail: 'Unmocked writes forbidden' } });
  });
  await page.route('**/api/operations/my-permissions/**', route => {
    state.permissionReads++;
    return state.permissionError ? route.fulfill({ status: 403, json: { detail: 'Permission refresh failed' } }) : route.fulfill({ json: {
      permissions: state.permissions, global_permissions: [], status_manage_division_ids: state.scope,
      roles: ['reader', 'corrector'].includes(scenario) ? [] : [{ code: 'DIRECTORATE_HEAD', name: 'Начальник управления', scope_division_id: 3, scope_division_name: 'Управление' }],
    } });
  });
  const row = { division_id: 3, name: 'Управление', list_total: 1, staff_total: 1, vacancies: 0, attached: 0, off_list: 0, columns: { IN_SERVICE: 1 }, event: { group: 0, squad: 0 } };
  await page.route('**/api/operations/strength-report/**', route => {
    if (state.reportFail) { state.reportFailures++; return route.fulfill({ status: 503, json: { detail: 'Report temporarily unavailable' } }); }
    return route.fulfill({ json: { business_date: date, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' }, rows: [row], totals: row, warnings: [] } });
  });
  await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: { business_date: date, nodes: [] } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-10', blocked: false, laggards: [] } }));
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [{ id: '3', name: 'Управление', division_type: 'directorate', ancestors: [], can_submit: false, can_correct: scenario === 'corrector' }] } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ json: { results: [{ id: 95001, division_id: '3', business_date: date, version: 1, is_current: true,
    event: 'CHANGED', submitted_by: 'Fixture', submitted_at: `${date}T09:30:00+05:00`, late: false, sent_at: null, sent_by: '', incomplete_reason: '' }] } }));
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [{ id: '1', full_name: 'Тестовый Сотрудник', rank_code: 'Майор',
    ...(scenario === 'missing division' ? {} : { division_id: scenario === 'foreign division' ? 99 : 3 }) }] } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 2, next: null, results: [
    { id: 1, code: 'IN_SERVICE', name: 'В строю', is_active: true, report_column_code: 'IN_SERVICE' },
    { id: 2, code: 'VACATION', name: 'Отпуск', is_active: true, report_column_code: 'VACATION' },
  ] } }));
  await page.route('**/api/operations/statuses/**', async route => {
    if (route.request().method() === 'POST') {
      state.writes.push(route.request().postDataJSON());
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      return route.fulfill(state.reject ? { status: 400, json: { error_code: 'VALIDATION_ERROR', message: 'Отказ проверки записи', details: {}, request_id: null } } : { status: 201, json: { id: 987 } });
    }
    return route.fulfill({ json: { count: 0, next: null, results: [] } });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(APP + '/employees?view=daily&businessDate=' + date);
  const group = page.getByRole('group', { name: 'Управление', exact: true });
  await group.getByRole('button', { expanded: false }).click();
  await expect(group.getByText('Тестовый Сотрудник', { exact: true })).toBeVisible();
  return { state, group };
}
async function pick(page: Page) {
  await page.getByRole('group', { name: 'Управление', exact: true }).getByRole('button', { name: 'Проставить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Статус на ' + date });
  await dialog.getByRole('combobox', { name: 'Статус', exact: true }).click();
  await page.getByRole('option', { name: 'Отпуск', exact: true }).click();
  return dialog;
}
test.describe('generic expense status access', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated UI; all non-auth writes intercepted');
  test.setTimeout(45_000);
  for (const outcome of ['success', 'failure']) test(`a corrector without submission scope keeps its open draft through list revalidation (${outcome})`, async ({ page }) => {
    await page.clock.install();
    const { state, group } = await setup(page, 'corrector');
    await group.getByRole('button', { name: 'Исправить сдачу', exact: true }).click();
    await group.getByLabel('Причина', { exact: true }).fill('Уточнение после проверки');
    await group.getByLabel('Санкция', { exact: true }).fill('Согласовано начальником');
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    let fail = outcome === 'failure';
    await page.route('**/api/ops/daily/daily-submissions/**', async route => {
      if (new URL(route.request().url()).searchParams.has('division_id')) { await route.fallback(); return; }
      reads++; await pending;
      if (fail) await route.fulfill({ status: 503, json: { detail: 'Submission temporarily unavailable' } });
      else await route.fallback();
    });
    try {
      await page.clock.fastForward(6 * 60_000);
      await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(group.getByRole('form', { name: 'Исправление сдачи' })).toBeHidden();
      release();
      if (fail) {
        await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
        await expect(group.getByText('Не удалось узнать, сдан ли день', { exact: true })).toBeVisible();
        await expect(group.getByRole('form', { name: 'Исправление сдачи' })).toBeHidden();
        fail = false;
        await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
      }
      await expect(group.getByLabel('Причина', { exact: true })).toHaveValue('Уточнение после проверки');
      await expect(group.getByLabel('Санкция', { exact: true })).toHaveValue('Согласовано начальником');
      await expect(group.getByRole('button', { name: 'Подтвердить исправление', exact: true })).toBeEnabled();
      expect(state.writes).toEqual([]); expect(state.blockedWrites).toEqual([]);
    } finally { release(); }
  });
  test('failed expense refresh blocks an open status draft without losing its selection', async ({ page }) => {
    await page.clock.install();
    const { state } = await setup(page); const dialog = await pick(page);
    state.reportFail = true;
    await page.clock.fastForward(6 * 60_000);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reportFailures).toBe(2);
    await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
    state.reportFail = false;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeEnabled();
    expect(state.writes).toEqual([]); expect(state.blockedWrites).toEqual([]);
  });
  for (const scenario of ['reader', 'foreign division', 'missing division']) test(`${scenario} sees people without a forbidden edit action`, async ({ page }) => {
    const { state, group } = await setup(page, scenario);
    await expect(group.getByRole('button', { name: 'Проставить', exact: true })).toHaveCount(0);
    expect(state.writes).toEqual([]); expect(state.blockedWrites).toEqual([]);
  });
  for (const change of ['revoke', 'scope', 'unknown scope']) test(`open short draft survives ${change} and saves one day after rights recover`, async ({ page }) => {
    const { state } = await setup(page); const dialog = await pick(page);
    if (change === 'revoke') state.permissions = ['status.view', 'forces.select'];
    if (change === 'scope') state.scope = [99];
    if (change === 'unknown scope') state.scope = undefined;
    const before = state.permissionReads;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
    await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
    await expect(dialog.getByText(/Нет подтверждённого права/)).toBeVisible();
    expect(state.writes).toEqual([]);
    state.permissions = ['status.view', 'status.manage', 'forces.select']; state.scope = [3];
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Проставить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.writes).toEqual([{ employee_id: 1, status_type_code: 'VACATION', date_start: date, date_end: '2026-10-10', participations: [] }]);
    expect(state.blockedWrites).toEqual([]);
  });
  test('failed permission refresh closes the workspace without a write', async ({ page }) => {
    const { state } = await setup(page); await pick(page); state.permissionError = true;
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Не удалось загрузить права рабочего места.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toEqual([]); expect(state.blockedWrites).toEqual([]);
  });
  for (const result of ['success', 'rejection']) test(`pending short status locks editing, closing and duplicate writes until ${result}`, async ({ page }) => {
    const { state } = await setup(page); const dialog = await pick(page);
    state.hold = true; state.reject = result === 'rejection';
    await dialog.getByRole('button', { name: 'Проставить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    try {
      await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Сохранение…', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      // A programmatic repeat must not create another request either.
      await dialog.getByRole('button', { name: 'Сохранение…', exact: true }).evaluate(button => {
        (button as HTMLButtonElement).disabled = false; (button as HTMLButtonElement).click();
      });
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0].status_type_code).toBe('VACATION');
    } finally { state.release(); }
    if (result === 'success') await expect(dialog).toHaveCount(0);
    else {
      await expect(dialog.getByText('Отказ проверки записи', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toBeEnabled();
      await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
      await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeEnabled();
    }
    expect(state.writes).toHaveLength(1); expect(state.blockedWrites).toEqual([]);
  });
});
