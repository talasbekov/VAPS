import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function openStatus(page: Page, catalog?: { fail: boolean }) {
  const current = { id: 5256, status_type: 'vacation', state: 'active', start_date: '2026-10-09', end_date: '2026-10-30', comment: '' };
  const unit = { id: 10, division: { id: 3, name: 'Управление' }, directorate_id: 3, directorate_name: 'Управление',
    employee: { id: 1, last_name: 'Тестовый', first_name: 'Сотрудник', current_status: current }, position: { id: 1, name: 'Инспектор' } };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: ['status.view', 'status.workspace', 'status.manage'] } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: { division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false } }));
  await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({ json: { current, planned: [] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route('**/api/statuses/types/**', route => catalog?.fail
    ? route.fulfill({ status: 503, json: { detail: 'Каталог временно недоступен' } })
    : route.fulfill({ json: [
    { code: 'in_service', label: 'На службе', color: '' }, { code: 'vacation', label: 'В отпуске', color: '' },
    { code: 'custom_status', label: 'В строю', color: '' },
  ] }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-14', blocked: false, laggards: [] } }));
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('button', { name: 'Действия: Тестовый Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  return page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
}

test('renamed in-service uses its code, shows no period and submits the server date without an end', async ({ page, businessWrites }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/statuses/statuses/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { id: 5257, ...submitted, state: 'active' } });
  });
  const dialog = await openStatus(page);
  await dialog.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await expect(dialog.getByText('«На службе» — бессрочный статус, даты не указываются.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Дата окончания/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ employee: 1, status_type: 'in_service', start_date: '2026-10-13' });
  expect(submitted).not.toHaveProperty('end_date');
  expect(businessWrites).toEqual([]);
});

test('the old display name on a different code still presents the required temporary period', async ({ page, businessWrites }) => {
  const dialog = await openStatus(page);
  await dialog.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'В строю', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Дата окончания/ })).toBeVisible();
  await expect(dialog.getByText(/бессрочный статус, даты не указываются/)).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('single status catalogue failure can be retried in place without losing the open draft', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = { fail: true };
  const dialog = await openStatus(page, catalog);
  await dialog.getByLabel('Комментарий', { exact: true }).fill('Сохранить мой черновик');
  const retry = dialog.getByRole('button', { name: 'Повторить загрузку типов статусов', exact: true });
  await expect(retry).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  catalog.fail = false;
  await retry.click();
  await expect(dialog.getByRole('combobox', { name: /^Новый статус/ })).toHaveText(/В отпуске/);
  await expect(dialog.getByLabel('Комментарий', { exact: true })).toHaveValue('Сохранить мой черновик');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});
