import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function statuses(page: Page, historical = false) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: ['*'],
    status_manage_division_ids: [130], roles: [],
  } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false,
    summary: { employees: 1, without_status: 0, overdue: 0, scheduled: 0 },
    staff_units: [{ id: 901, division: { id: 130, name: 'Департамент №9' },
      position: { id: 1, name: 'Сотрудник', level: 1 }, employee: {
        id: 401, last_name: 'Тестовый', first_name: 'Аслан', current_status: {
          status_type: historical ? 'ATTACHED' : 'in_service', state: 'active', start_date: '2026-10-19', end_date: null,
        },
      } }],
  } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'in_service', label: 'В строю', color: '' },
    { code: 'vacation', label: 'В отпуске', color: '' },
    { code: 'on_duty', label: 'На дежурстве', color: '' },
    { code: 'seconded_from', label: 'Прикомандирован', color: '' },
    { code: 'seconded_to', label: 'Откомандирован', color: '' },
    { code: 'ATTACHED', label: 'Прикомандирован (сохранённая подпись)', color: '' },
    { code: 'DETACHED', label: 'Откомандирован (старый каталог)', color: '' },
  ] }));
  await page.route('**/api/statuses/statuses/**', route => route.fulfill({ json: { current: null, planned: [], results: [] } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [
    { code: 'IN_SERVICE', legacy_code: 'in_service', name: 'В строю', is_active: true },
    { code: 'VACATION', legacy_code: 'vacation', name: 'В отпуске', is_active: true },
    { code: 'ATTACHED', legacy_code: 'seconded_from', name: 'Прикомандирован', is_active: true },
    { code: 'DETACHED', legacy_code: 'seconded_to', name: 'Откомандирован', is_active: true },
  ] } }));
  await signIn(page);
  await page.goto('/statuses/');
  await expect(page.getByRole('button', { name: 'Действия: Тестовый Аслан', exact: true })).toBeVisible();
}

test('statuses expose individual editing and calendar without mass update, CSV or secondment actions', async ({ page, businessWrites }) => {
  await statuses(page);
  await expect(page.getByRole('tab')).toHaveText(['Таблица сотрудников', 'Календарь статусов']);
  await expect(page.getByRole('button', { name: /CSV|Прикомандир|Откомандир|Заявки на прикомандирование/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Действия: Тестовый Аслан', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Изменить статус', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Запланированные статусы', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Прикомандир|Откомандир/i })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('an old status catalog cannot reintroduce retired types into the individual editor', async ({ page, businessWrites }) => {
  await statuses(page);
  await page.getByRole('button', { name: 'Действия: Тестовый Аслан', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('combobox', { name: /Новый статус/ }).click();
  await expect(page.getByRole('option', { name: 'В отпуске', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'На дежурстве', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Прикомандир|Откомандир/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(businessWrites).toEqual([]);
});

test('historical retired statuses keep their catalog labels and remain available as read filters', async ({ page, businessWrites }) => {
  await statuses(page, true);
  const row = page.locator('tr[data-employee-id="401"]');
  await expect(row).toContainText('Прикомандирован (сохранённая подпись)');
  await page.getByRole('combobox').filter({ hasText: 'Все статусы' }).click();
  await expect(page.getByRole('option', { name: 'Прикомандирован (сохранённая подпись)', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(businessWrites).toEqual([]);
});
