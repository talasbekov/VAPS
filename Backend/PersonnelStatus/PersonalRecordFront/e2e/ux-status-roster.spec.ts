import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function openRoster(page: Page, editable = true) {
  const permissions = ['status.view', 'status.workspace', ...(editable ? ['status.manage'] : [])];
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions, global_permissions: ['status.view', 'status.workspace'], status_manage_division_ids: editable ? [3] : [],
  } }));
  const employee = { id: 1, last_name: 'Учебный', first_name: 'Сотрудник', middle_name: '02',
    current_status: { id: 17, status_type: 'business_trip', state: 'active', start_date: '2026-10-20', end_date: '2026-11-01' } };
  const unit = { id: 10, division: { id: 3, name: 'Учебное управление' }, directorate_id: 3, directorate_name: 'Учебное управление',
    employee, position: { id: 1, name: 'Старший специалист по обеспечению деятельности подразделения' } };
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, staff_units: [unit, { ...unit, id: 11, employee: null }], total_count: 2, matched_count: 2, page: 1, page_size: 50, has_next: false,
  } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'business_trip', label: 'В командировке', color: '' },
  ] }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await signIn(page);
  await page.goto('/statuses/');
  const roster = page.locator('table').filter({ has: page.locator('tr[data-employee-id="1"]') });
  await expect(roster.locator('tr[data-employee-id="1"]')).toBeVisible();
  return roster;
}

for (const width of [320, 390]) test(`at ${width}px a roster row keeps the person, distinct statuses and actions together`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 800 });
  const roster = await openRoster(page);
  const row = roster.locator('tr[data-employee-id="1"]');
  const actions = row.getByRole('button', { name: 'Действия: Учебный Сотрудник 02', exact: true });
  await actions.scrollIntoViewIfNeeded();
  for (const element of [row, actions, row.getByText('В командировке', { exact: true })]) {
    const box = await element.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await expect(row.getByText('Статус (кадровый)', { exact: true })).toBeVisible();
  await expect(row.getByText('По разделу ОМ', { exact: true })).toBeVisible();
  const details = row.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.getByText('Должность и даты', { exact: true }).click();
  await expect(details).toContainText('Старший специалист по обеспечению деятельности подразделения');
  await expect(details).toContainText('20.10.2026');
  await expect(details).toContainText('01.11.2026');
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Изменить статус', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  const vacancy = roster.getByRole('row').filter({ hasText: 'ВАКАНТ' });
  await expect(vacancy.getByRole('checkbox')).toBeDisabled();
  await vacancy.getByRole('button', { name: 'Действия: ВАКАНТ', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Должность вакантна — действий нет', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('mobile read-only roster retains separate accounting and profile details without selection controls', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const roster = await openRoster(page, false);
  await expect(roster.getByRole('checkbox')).toHaveCount(0);
  const row = roster.locator('tr[data-employee-id="1"]');
  await row.getByRole('button', { name: 'Действия: Учебный Сотрудник 02', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Только просмотр — правка статусов закрыта', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Изменить статус', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('desktop roster retains named date columns and a single action target per person', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const roster = await openRoster(page);
  await expect(roster.getByRole('columnheader', { name: 'Обновлён', exact: true })).toBeVisible();
  await expect(roster.getByRole('columnheader', { name: 'Следующий', exact: true })).toBeVisible();
  await expect(roster.locator('tr[data-employee-id="1"]').getByRole('button', { name: /^Действия:/ })).toHaveCount(1);
  await expect(roster.locator('tr[data-employee-id="1"] details')).toBeHidden();
});
