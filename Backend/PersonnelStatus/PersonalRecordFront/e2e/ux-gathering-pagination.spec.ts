import { readFile } from 'node:fs/promises';
import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page, query = '') {
  const rows = Array.from({ length: 151 }, (_, index) => ({ id: index + 1,
    division: { id: 7, name: 'Отдел проверки' }, position: { id: 1, name: 'Сотрудник' },
    employee: { id: index + 1, first_name: `№${index + 1}`, last_name: 'Участник', current_status: null } }));
  let fullReads = 0;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: '2026-10-13',
    rows: [{ division_id: 7, name: 'Отдел проверки', staff_total: 151, list_total: 151, columns: { IN_SERVICE: 151 } }],
    totals: { staff_total: 151, list_total: 151, columns: { IN_SERVICE: 151 } } } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [{ code: 'IN_SERVICE', name: 'В строю', report_column_code: 'IN_SERVICE' }] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: rows.map(row => ({ id: String(row.id), full_name: `Участник №${row.id}`, rank_code: '', division_id: 7 })) } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    const found = params.get('search') ? rows.filter(row => row.employee.first_name === params.get('search')) : rows;
    const pageNumber = Number(params.get('page') || 1);
    const size = Number(params.get('page_size') || found.length);
    const paged = params.has('page');
    if (!paged) fullReads++;
    return route.fulfill({ json: { division: null, staff_units: paged ? found.slice((pageNumber - 1) * size, pageNumber * size) : found,
      total_count: Math.min(found.length, size), matched_count: found.length, page: pageNumber, page_size: size,
      has_next: pageNumber * size < found.length } });
  });
  await signIn(page);
  await page.goto('/employees/?view=forces&tab=in-service&businessDate=2026-10-13' + query);
  await expect(page.getByRole('tab', { name: 'В строю (151)', exact: true })).toHaveAttribute('aria-selected', 'true');
  return { fullReads: () => fullReads };
}

test('a gathering list renders 50 rows per page and exports its complete selection from the last page', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await prepare(page);
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(50);
  await expect(panel.getByText('1–50 из 151', { exact: true })).toBeVisible();
  for (let index = 0; index < 3; index++) {
    await panel.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe(String(index + 2));
  }
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(1);
  await expect(panel.getByText('Участник №151', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Далее', exact: true })).toBeDisabled();
  expect(new URL(page.url()).searchParams.get('page')).toBe('4');
  expect(state.fullReads()).toBe(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(152);
  expect(csv).toContain('Участник №1');
  expect(csv).toContain('Участник №151');
  expect(state.fullReads()).toBe(2);
  await page.reload();
  await expect(panel.getByText('151–151 из 151', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('№1');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(1);
  await expect(panel.getByText('Участник №1', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-13');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('an oversized gathering page link resolves to a real last page and keeps the work context', async ({ page, businessWrites }) => {
  await prepare(page, '&page=99');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('tr[data-employee-id]')).toHaveCount(1);
  await expect(panel.getByText('Участник №151', { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('4');
  expect(new URL(page.url()).searchParams.get('view')).toBe('forces');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('in-service');
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-13');
  expect(businessWrites).toEqual([]);
});
