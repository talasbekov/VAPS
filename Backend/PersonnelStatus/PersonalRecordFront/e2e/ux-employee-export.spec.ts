import { readFile } from 'node:fs/promises';
import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

function unit(id: number) {
  return { id, division: { id: 7, name: 'Отдел проверки', code: 'D7' },
    position: { id: 1, name: 'Сотрудник' }, employee: { id, first_name: `Экспорт${id}`, last_name: 'Проверка',
      iin_masked: '********1234', personnel_number: String(id), current_status: { status_type: 'vacation', start_date: '2026-10-01', end_date: '2026-10-31' } } };
}

async function prepare(page: Page, fail = false) {
  const rows = Array.from({ length: 51 }, (_, index) => unit(index + 1));
  const state = { fail, wholeReads: [] as string[], downloads: 0, dialogs: [] as string[] };
  page.on('dialog', async dialog => { state.dialogs.push(dialog.message()); await dialog.dismiss(); });
  page.on('download', () => state.downloads++);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').toLocaleLowerCase('ru');
    const status = url.searchParams.get('status');
    const employeeIds = url.searchParams.get('employee_ids')?.split(',');
    const matched = rows.filter(row => (!employeeIds || employeeIds.includes(String(row.employee.id))) && `${row.employee.last_name} ${row.employee.first_name}`.toLocaleLowerCase('ru').includes(search) && (!status || row.employee.current_status.status_type === status));
    if (!url.searchParams.has('page')) {
      state.wholeReads.push(url.search);
      if (state.fail) return route.fulfill({ status: 503, json: { detail: 'Полный отбор временно недоступен' } });
      return route.fulfill({ json: { division: null, staff_units: matched, total_count: matched.length, matched_count: matched.length } });
    }
    const size = Number(url.searchParams.get('page_size') || 50);
    return route.fulfill({ json: { division: null, staff_units: matched.slice(0, size), total_count: Math.min(matched.length, size), matched_count: matched.length, page: 1, page_size: size, has_next: matched.length > size } });
  });
  await signIn(page);
  await page.goto('/employees/?view=forces&search=Экспорт');
  await expect(page.getByText('Проверка Экспорт1', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Экспорт CSV', exact: true })).toBeEnabled();
  return state;
}

test('a failed full employee export creates no partial file and can be retried without losing filters', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await prepare(page, true);
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
  await expect(page.getByText('Не удалось выгрузить весь отбор. Файл не создан.', { exact: true })).toBeVisible();
  await expect(page.getByText('Полный отбор временно недоступен', { exact: true })).toBeVisible();
  expect(state.downloads).toBe(0);
  expect(state.dialogs).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true })).toHaveValue('Экспорт');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Экспорт');
  state.fail = false;
  const downloadPromise = page.waitForEvent('download');
  const retry = page.getByRole('button', { name: 'Повторить экспорт', exact: true });
  await retry.focus();
  await retry.press('Enter');
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.trim().split('\r\n')).toHaveLength(52);
  expect(csv).toContain('Проверка Экспорт51');
  expect(state.downloads).toBe(1);
  expect(state.wholeReads).toHaveLength(2);
  for (const query of state.wholeReads) expect(new URLSearchParams(query).get('search')).toBe('Экспорт');
  await expect(page.getByText('Не удалось выгрузить весь отбор. Файл не создан.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('a successful employee CSV contains the complete filtered selection rather than the displayed page', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(download.suggestedFilename()).toBe('сотрудники.csv');
  expect(csv.trim().split('\r\n')).toHaveLength(52);
  expect(csv).toContain('Проверка Экспорт51');
  expect(state.wholeReads).toHaveLength(1);
  expect(state.dialogs).toEqual([]);
  expect(businessWrites).toEqual([]);
});

async function prepareGathering(page: Page, noStatuses = false) {
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: {
    business_date: '2026-10-13', rows: [{ division_id: 7, name: 'Отдел проверки', staff_total: 3, list_total: 3, columns: { IN_SERVICE: 3 } }],
    totals: { staff_total: 3, list_total: 3, columns: { IN_SERVICE: 3 } },
  } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [
    { code: 'IN_EVENT', name: 'Участие в ОМ', report_column_code: 'IN_SERVICE' },
    { code: 'IN_SERVICE', name: 'В строю', report_column_code: 'IN_SERVICE' },
  ] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: noStatuses ? 0 : 3, next: null, results: noStatuses ? [] : [
    { id: 11, employee_id: 1, status_type_code: 'IN_EVENT', date_start: '2026-10-13', date_end: '2026-10-14', state: 'ACTIVE' },
    { id: 12, employee_id: 2, status_type_code: 'IN_EVENT', date_start: '2026-10-13', date_end: '2026-10-14', state: 'ACTIVE' },
    { id: 13, employee_id: 3, status_type_code: 'IN_SERVICE', date_start: '2026-10-13', date_end: null, state: 'ACTIVE' },
  ] } }));
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [1, 2, 3].map(id => ({ id: String(id), full_name: `Проверка Экспорт${id}`, rank_code: '', division_id: 7 })) } }));
  return prepare(page);
}

for (const [tab, caption, expectedNames, statusLabel] of [
  ['assigned', 'Участие в ОМ (2)', ['Проверка Экспорт1', 'Проверка Экспорт2'], 'Участие в ОМ'],
  ['in-service', 'В строю (1)', ['Проверка Экспорт3'], 'В строю'],
] as const) {
  test(`the ${tab} CSV contains only its displayed gathering group and its operational status`, async ({ page, businessWrites }) => {
    await prepareGathering(page);
    await page.getByRole('tab', { name: caption, exact: true }).click();
    await expect(page.getByRole('tabpanel').locator('tr[data-employee-id]')).toHaveCount(expectedNames.length);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
    const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
    expect(csv.trim().split('\r\n')).toHaveLength(expectedNames.length + 1);
    for (const name of expectedNames) expect(csv).toContain(name);
    expect(csv).toContain(statusLabel);
    expect(csv).toContain('13.10.2026');
    expect(csv).not.toContain('01.10.2026');
    expect(businessWrites).toEqual([]);
  });
}

test('the in-service CSV leaves the operational start date blank when no operational status exists', async ({ page, businessWrites }) => {
  await prepareGathering(page, true);
  await page.getByRole('tab', { name: 'В строю (3)', exact: true }).click();
  await expect(page.getByRole('tabpanel').locator('tr[data-employee-id]')).toHaveCount(3);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(4);
  expect(csv).not.toContain('01.10.2026');
  expect(csv).not.toContain('13.10.2026');
  expect(csv.match(/;"В строю";"";/g)).toHaveLength(3);
  expect(businessWrites).toEqual([]);
});

test('opening a gathering employee profile displays the inclusive last day of its operational status', async ({ page, businessWrites }) => {
  await prepareGathering(page);
  await page.getByRole('tab', { name: 'Участие в ОМ (2)', exact: true }).click();
  await expect(page.getByRole('tabpanel').locator('tr[data-employee-id]')).toHaveCount(2);
  await page.getByRole('tabpanel').getByText('Проверка Экспорт1', { exact: true }).click();
  await page.getByRole('tab', { name: 'Профиль сотрудника', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Статус по', { exact: true }).locator('..')).toHaveText(/13 октября 2026/);
  await expect(panel.getByText('Статус с', { exact: true }).locator('..')).toHaveText(/13 октября 2026/);
  expect(businessWrites).toEqual([]);
});

test('a linked personnel status filter cannot remove the operational gathering group', async ({ page, businessWrites }) => {
  const state = await prepareGathering(page);
  await page.goto('/employees/?view=forces&tab=assigned&status=in_service');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Фильтр по статусу', exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(3);
  for (const query of state.wholeReads) expect(new URLSearchParams(query).has('status')).toBe(false);
  expect(businessWrites).toEqual([]);
});

test('gathering search filters its whole list and resetting it preserves the view and selected tab', async ({ page, businessWrites }) => {
  await prepareGathering(page);
  await page.getByRole('tab', { name: 'Участие в ОМ (2)', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('Экспорт1');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Экспорт1');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('Нет такого сотрудника');
  await expect(panel.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Участие в ОМ (2)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get('view')).toBe('forces');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('assigned');
  expect(businessWrites).toEqual([]);
});

test('a failed gathering list offers a retry and does not present the failure as an empty group', async ({ page, businessWrites }) => {
  const state = await prepareGathering(page);
  state.fail = true;
  await page.getByRole('tab', { name: 'Участие в ОМ (2)', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Не удалось загрузить состав для выбранного отбора.', { exact: true })).toBeVisible();
  await expect(panel.getByText('Ничего не найдено', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Экспорт CSV', exact: true })).toBeDisabled();
  state.fail = false;
  await panel.getByRole('button', { name: 'Повторить загрузку состава', exact: true }).click();
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Экспорт CSV', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('resetting an empty employee search retains the forces view and the business date', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?view=forces&businessDate=2026-10-13');
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('Нет такого сотрудника');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible();
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(50);
  expect(new URL(page.url()).searchParams.get('view')).toBe('forces');
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-13');
  expect(businessWrites).toEqual([]);
});
