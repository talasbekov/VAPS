import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page) {
  const rows = Array.from({ length: 51 }, (_, index) => ({ id: index + 1, division: { id: 7, name: 'Отдел проверки' }, position: { id: 1, name: 'Сотрудник' },
    employee: { id: index + 1, first_name: String(index + 1), last_name: 'Проверка', current_status: null } }));
  const state = { hold: false, fail: false, staff: 62, reportReads: 0, hasStatus: false, end: '2026-10-14', date: '2026-10-13', holdNextDay: false, nextDayReads: 0, release: () => {} };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  state.release = release;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route('**/api/operations/strength-report/**', async route => {
    state.reportReads++;
    if (state.hold) await waiting;
    if (state.fail) return route.fulfill({ status: 503, json: { detail: 'Расход временно недоступен' } });
    return route.fulfill({ json: { business_date: state.date, rows: [{ division_id: 7, name: 'Отдел проверки', staff_total: state.staff, list_total: 51, columns: { IN_SERVICE: 51 } }],
      totals: { staff_total: state.staff, list_total: 51, columns: { IN_SERVICE: 51 } } } });
  });
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [{ code: 'IN_SERVICE', name: 'В строю', is_active: true, report_column_code: 'IN_SERVICE' }] } }));
  await page.route('**/api/operations/statuses/**', async route => {
    if (new URL(route.request().url()).searchParams.get('business_date') === '2026-10-14') {
      state.nextDayReads++;
      if (state.holdNextDay) await waiting;
    }
    return route.fulfill({ json: { count: state.hasStatus ? 1 : 0, next: null, results: state.hasStatus ? [
      { id: 1, employee_id: 1, status_type_code: 'IN_SERVICE', date_start: '2026-10-13', date_end: state.end, state: 'ACTIVE' } ] : [] } });
  });
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: rows.map(row => ({ id: String(row.employee.id), full_name: `Проверка ${row.employee.id}`, rank_code: '', division_id: 7 })) } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', route => {
    const params = new URL(route.request().url()).searchParams;
    const matched = params.has('employee_ids') ? rows.filter(row => String(row.employee.id) === params.get('employee_ids')) : rows;
    const number = Number(params.get('page') || 1), size = Number(params.get('page_size') || matched.length);
    const paged = params.has('page');
    return route.fulfill({ json: { division: null, staff_units: paged ? matched.slice((number - 1) * size, number * size) : matched,
      total_count: Math.min(size, matched.length), matched_count: matched.length, page: number, page_size: size, has_next: number * size < matched.length } });
  });
  await signIn(page);
  return state;
}

const values = (page: Page) => page.getByRole('group', { name: 'Личный состав на сбор', exact: true }).locator('[data-slot="stat-value"]');

test('gathering placeholders distinguish an unanswered report from a confirmed zero', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.hold = true;
  await page.goto('/employees/?view=forces&tab=table');
  try {
    await expect.poll(() => state.reportReads).toBeGreaterThan(0);
    await expect.poll(() => values(page).allTextContents()).toEqual(['…', '…', '…', '…', '…']);
    await expect(page.getByRole('tab', { name: 'Участие в ОМ (…)', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'В строю (…)', exact: true })).toBeVisible();
  } finally { state.hold = false; state.release(); }
  await expect.poll(() => values(page).allTextContents()).toEqual(['62', '51', '51', '0', '51']);
  await expect(page.getByRole('tab', { name: 'Участие в ОМ (0)', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a failed gathering report shows unavailable figures and recovers through its own retry', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.fail = true;
  await page.goto('/employees/?view=forces&tab=table');
  await expect(page.getByText('Не удалось загрузить показатели сбора.', { exact: true })).toBeVisible();
  await expect.poll(() => values(page).allTextContents()).toEqual(['—', '—', '—', '—', '—']);
  await expect(page.getByRole('tab', { name: 'В строю (—)', exact: true })).toBeVisible();
  state.fail = false;
  await page.getByRole('button', { name: 'Повторить показатели сбора', exact: true }).click();
  await expect.poll(() => values(page).allTextContents()).toEqual(['62', '51', '51', '0', '51']);
  expect(businessWrites).toEqual([]);
});

test('refreshing forces updates the report figures while retaining page and work context', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto('/employees/?view=forces&tab=table&page=2&businessDate=2026-10-13');
  await expect.poll(() => values(page).allTextContents()).toEqual(['62', '51', '51', '0', '51']);
  const before = state.reportReads;
  state.staff = 70;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => values(page).allTextContents()).toEqual(['70', '51', '51', '0', '51']);
  expect(state.reportReads).toBeGreaterThan(before);
  const params = new URL(page.url()).searchParams;
  expect(params.get('page')).toBe('2');
  expect(params.get('tab')).toBe('table');
  expect(params.get('view')).toBe('forces');
  expect(params.get('businessDate')).toBe('2026-10-13');
  expect(businessWrites).toEqual([]);
});

test('refreshing an operational profile also updates the displayed period from its report source', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.hasStatus = true;
  await page.goto('/employees/?view=forces&tab=in-service&employee=1&businessDate=2026-10-13');
  const lastDay = page.getByRole('tabpanel').getByText('Статус по', { exact: true }).locator('..');
  await expect(lastDay).toHaveText(/13 октября 2026/);
  state.end = '2026-10-15';
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(lastDay).toHaveText(/14 октября 2026/);
  expect(new URL(page.url()).searchParams.get('employee')).toBe('1');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('in-service');
  expect(businessWrites).toEqual([]);
});

test('refresh stays busy until the statuses for a changed report date have arrived', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto('/employees/?view=forces&tab=table');
  await expect.poll(() => values(page).allTextContents()).toEqual(['62', '51', '51', '0', '51']);
  state.date = '2026-10-14';
  state.holdNextDay = true;
  const refresh = page.getByRole('button', { name: 'Обновить', exact: true });
  await refresh.click();
  try {
    await expect.poll(() => state.nextDayReads).toBeGreaterThan(0);
    await expect.poll(() => values(page).allTextContents()).toEqual(['…', '…', '…', '…', '…']);
    await expect(refresh).toBeDisabled();
    await expect(refresh.locator('svg')).toHaveClass(/animate-spin/);
  } finally { state.holdNextDay = false; state.release(); }
  await expect.poll(() => values(page).allTextContents()).toEqual(['62', '51', '51', '0', '51']);
  await expect(refresh).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('the forces heading and an empty participation group describe the current work and business date', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?view=forces&tab=assigned&businessDate=2026-10-13');
  await expect(page.getByText('Личный состав', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByText('На 13.10.2026 активных участников ОМ в разрезе сбора нет.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Участие в ОМ (0)', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(businessWrites).toEqual([]);
});
