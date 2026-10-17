import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function openPeriod(page: Page) {
  const current = { id: 17, status_type: 'vacation', state: 'active', start_date: '2026-10-16', end_date: '2026-10-16' };
  const unit = { id: 10, division: { id: 3, name: 'Управление' }, directorate_id: 3, directorate_name: 'Управление',
    employee: { id: 1, last_name: 'Тестовый', first_name: 'Сотрудник', current_status: current }, position: { id: 1, name: 'Инспектор' } };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: ['status.view', 'status.workspace', 'status.manage'] } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: { division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false } }));
  await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({ json: { current, planned: [] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'vacation', label: 'В отпуске', color: '' }, { code: 'IN_EVENT', label: 'На участие ОМ', color: '' },
  ] }));
  await page.route('**/api/ops/dictionaries/EVENT_PARTICIPATION_KINDS/entries/**', route => route.fulfill({ json: { results: [{ code: 'PHYSICAL_SQUAD', label: 'Физнаряд', isActive: true }] } }));
  await page.route('**/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/ops/security-events/forces/directorate-requests/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-17', blocked: false, laggards: [] } }));
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  return page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
}

test('one-day event participation sends the next exclusive day while the selected last day stays inclusive', async ({ page, businessWrites }) => {
  const dialog = await openPeriod(page);
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/operations/statuses/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { id: 18, ...sent } });
  });
  await dialog.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На участие ОМ', exact: true }).click();
  await dialog.getByRole('button', { name: 'Физнаряд', exact: true }).click();
  await expect(dialog.locator('#endDate')).toContainText('16 октября 2026');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => sent).toMatchObject({ employee_id: 1, status_type_code: 'IN_EVENT', date_start: '2026-10-16', date_end: '2026-10-17' });
  await expect(dialog).not.toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('personnel one-day status keeps the same inclusive end date', async ({ page, businessWrites }) => {
  const dialog = await openPeriod(page);
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/statuses/statuses/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { id: 18, ...sent, state: 'active' } });
  });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => sent).toMatchObject({ employee: 1, status_type: 'vacation', start_date: '2026-10-16', end_date: '2026-10-16' });
  expect(businessWrites).toEqual([]);
});

test('status draft survives temporary permissions failure and focus recovery', async ({ page, businessWrites }) => {
  const dialog = await openPeriod(page);
  await dialog.getByRole('textbox', { name: 'Комментарий', exact: true }).fill('UNSENT_STATUS_DRAFT');
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  const failed = page.waitForResponse(response => response.url().includes('/api/operations/my-permissions/') && response.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await failed;
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: ['status.view', 'status.workspace', 'status.manage'] } }));
  const recovered = page.waitForResponse(response => response.url().includes('/api/operations/my-permissions/') && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await recovered;
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Комментарий', exact: true })).toHaveValue('UNSENT_STATUS_DRAFT');
  expect(businessWrites).toEqual([]);
});

test('denied status draft stays removed through later unavailable and successful permissions', async ({ page, businessWrites }) => {
  const dialog = await openPeriod(page);
  await dialog.getByRole('textbox', { name: 'Комментарий', exact: true }).fill('DENIED_STATUS_DRAFT');
  for (const status of [403, 503, 200]) {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status, json: status === 200
      ? { permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: ['status.view', 'status.workspace', 'status.manage'] } : { detail: 'Unavailable' } }));
    const response = page.waitForResponse(response => response.url().includes('/api/operations/my-permissions/') && response.status() === status);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await response;
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Комментарий', exact: true })).toHaveValue('');
  expect(businessWrites).toEqual([]);
});
