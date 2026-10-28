import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const date = '2026-10-13';
async function prepare(page: Page) {
  const state = { hold: false, fail: false, active: true, reads: 0, failures: 0, writes: [] as object[], release: () => {} };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  state.release = release;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.manage', 'forces.select'], global_permissions: [], status_manage_division_ids: [3],
    roles: [{ code: 'DIRECTORATE_HEAD', name: 'Начальник управления', scope_division_id: 3, scope_division_name: 'Управление' }] } }));
  // A denied leadership read invalidates sibling daily data under the same
  // authority. Model the real empty native response instead of a missing API.
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pageSize = Number(new URL(route.request().url()).searchParams.get('page_size') || 50);
    return route.fulfill({ json: { staff_units: [], total_count: 0, matched_count: 0,
      page: 1, page_size: pageSize, has_next: false } });
  });
  const row = { division_id: 3, name: 'Управление', list_total: 1, staff_total: 1, vacancies: 0, attached: 0, off_list: 0, columns: { IN_SERVICE: 1 }, event: { group: 0, squad: 0 } };
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: date, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' }, rows: [row], totals: row, warnings: [] } }));
  await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: { business_date: date, nodes: [] } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-14', blocked: false, laggards: [] } }));
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [{ id: '3', name: 'Управление', division_type: 'directorate', ancestors: [], can_submit: false, can_correct: false }] } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ json: { results: [{ id: 95001, division_id: '3', business_date: date, version: 1, is_current: true,
    event: 'CHANGED', submitted_by: 'Fixture', submitted_at: `${date}T09:30:00+05:00`, late: false, sent_at: null, sent_by: '', incomplete_reason: '' }] } }));
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [{ id: '1', full_name: 'Тестовый Сотрудник', rank_code: 'Майор', division_id: 3 }] } }));
  await page.route('**/api/operations/status-types/**', async route => {
    state.reads++;
    if (state.hold) await waiting;
    if (state.fail) { state.failures++; return route.fulfill({ status: 503, json: { detail: 'Каталог временно недоступен' } }); }
    return route.fulfill({ json: { count: 3, next: null, results: [
      { id: 1, code: 'IN_SERVICE', name: 'В строю', is_active: true, report_column_code: 'IN_SERVICE' },
      { id: 2, code: 'VACATION', name: 'Отпуск', is_active: state.active, report_column_code: 'VACATION' },
      { id: 3, code: 'IN_EVENT', name: 'Участие в ОМ', is_active: true, report_column_code: 'IN_SERVICE' } ] } });
  });
  await page.route('**/api/operations/statuses/**', route => {
    if (route.request().method() === 'POST') { state.writes.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { id: 987 } }); }
    return route.fulfill({ json: { count: 0, next: null, results: [] } });
  });
  await signIn(page);
  await page.goto('/employees/?view=daily&businessDate=' + date);
  const group = page.getByRole('group', { name: 'Управление', exact: true });
  await group.getByRole('button', { expanded: false }).click();
  await group.getByRole('button', { name: 'Проставить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Статус', exact: true }).click();
  await page.getByRole('option', { name: 'Отпуск', exact: true }).click();
  return { state, dialog };
}

async function refresh(page: Page) {
  await page.clock.fastForward(6 * 60_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('the daily status draft waits for a catalog refresh and keeps the chosen type', async ({ page, businessWrites }) => {
  await page.clock.install();
  const { state, dialog } = await prepare(page);
  state.hold = true;
  const before = state.reads;
  await refresh(page);
  try {
    await expect.poll(() => state.reads).toBeGreaterThan(before);
    await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
    expect(state.writes).toEqual([]);
  } finally { state.hold = false; state.release(); }
  await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('a failed daily status catalog blocks its retained draft until an in-place retry succeeds', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  const { state, dialog } = await prepare(page);
  state.fail = true;
  await refresh(page);
  await expect(dialog.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
  state.fail = false;
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
  expect(state.writes).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('deactivating the chosen daily type retains its label and requires another active type', async ({ page, businessWrites }) => {
  await page.clock.install();
  const { state, dialog } = await prepare(page);
  state.active = false;
  const before = state.reads;
  await refresh(page);
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(dialog.getByText('Выбранный тип больше недоступен. Выберите другой активный статус.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveText('Отпуск');
  await expect(dialog.getByRole('button', { name: 'Проставить', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Статус', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Участие в ОМ', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'В строю', exact: true }).click();
  await dialog.getByRole('button', { name: 'Проставить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toEqual([{ employee_id: 1, status_type_code: 'IN_SERVICE', date_start: date, date_end: '2026-10-14', participations: [] }]);
  expect(businessWrites).toEqual([]);
});

test('the daily form explains its one-day period and sends the existing exclusive end', async ({ page, businessWrites }) => {
  const { state, dialog } = await prepare(page);
  await expect(dialog.getByText('Статус будет действовать один день: 13 октября 2026 г.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Проставить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toEqual([{ employee_id: 1, status_type_code: 'VACATION', date_start: date, date_end: '2026-10-14', participations: [] }]);
  expect(businessWrites).toEqual([]);
});
