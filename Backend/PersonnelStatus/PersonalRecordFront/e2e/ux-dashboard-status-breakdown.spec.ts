import { test, expect, signIn } from './ux-fixture';

test('overview includes catalog duties, inactive aliases and unknown historical codes', async ({ page, businessWrites }) => {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['orgstructure.view', 'status.view'], global_permissions: ['orgstructure.view', 'status.view'], roles: [],
  } }));
  await page.route('**/api/statuses/statuses/absence_statistics/**', route => route.fulfill({ json: {
    period: { start_date: '2026-10-19', end_date: '2026-10-19' }, division_id: null,
    staff_count: 10, total_absences: 10,
    by_type: { DUTY_DAILY: 1, SPECIAL_WATCH: 2, vacation: 3, OLD_IMPORT: 4 },
  } }));
  const catalog = [
    { code: 'DUTY_DAILY', name: 'Суточное дежурство', legacy_code: null, is_active: true },
    { code: 'SPECIAL_WATCH', name: 'Исторический караул', legacy_code: null, is_active: false },
    { code: 'VACATION', name: 'Переименованный отпуск', legacy_code: 'vacation', is_active: true },
  ].map((row, index) => ({ ...row, priority: index, report_column_code: 'ON_DUTY', counts_in_list: true, counts_in_staff: true }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: catalog.length, next: null, previous: null, results: catalog } }));
  await signIn(page);
  await page.goto('/dashboard/');
  await page.getByText('Подробная сводка статусов', { exact: true }).click();
  const details = page.locator('details').filter({ hasText: 'Подробная сводка статусов' });
  for (const [label, count] of [['Суточное дежурство', 1], ['Исторический караул', 2], ['Переименованный отпуск', 3], ['OLD_IMPORT', 4]] as const) {
    const row = details.locator('div').filter({ has: page.getByText(label, { exact: true }) });
    await expect(row.locator('dt')).toHaveText(label);
    await expect(row.locator('dd')).toHaveText(String(count));
  }
  expect(businessWrites).toEqual([]);
});
