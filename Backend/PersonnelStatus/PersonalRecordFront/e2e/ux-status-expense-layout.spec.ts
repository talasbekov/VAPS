import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page) {
  const state = { failed: false, writes: [] as unknown[] };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage', 'daily_report.mark_update', 'daily_report.correct'],
    global_permissions: [], status_manage_division_ids: [11],
    roles: [{ code: 'DIRECTORATE_HEAD', name: 'Начальник управления', scope_division_id: 11, scope_division_name: 'Учебное управление' }],
  } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-20' } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, total_count: 0, matched_count: 0, staff_units: [],
    summary: { employees: 62, without_status: 0, overdue: 0, scheduled: 3 },
  } }));
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [{
    id: '11', name: 'Учебное управление', ancestors: ['Девятый департамент'], division_type: 'directorate', can_submit: true, can_correct: true,
  }] } }));
  await page.route('**/api/operations/strength-report/**', route => route.fulfill(state.failed
    ? { status: 503, json: { detail: 'Временный отказ расхода' } }
    : { json: {
      business_date: new URL(route.request().url()).searchParams.get('business_date'),
      columns: ['IN_SERVICE', 'VACATION', 'COMMAND', 'TRAINING'],
      column_labels: { IN_SERVICE: 'В строю', VACATION: 'Отпуск', COMMAND: 'Командировка', TRAINING: 'Учёба' },
      totals: { staff_total: 65, list_total: 62, attached: 2, columns: { IN_SERVICE: 48, VACATION: 5, COMMAND: 3, TRAINING: 6 } }, rows: [],
    } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => {
    if (route.request().method() !== 'GET') {
      state.writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { detail: 'Не сохраняем учебный расход' } });
    }
    return route.fulfill({ json: { results: [] } });
  });
  await signIn(page); await page.goto('/statuses/');
  const card = page.getByRole('region', { name: 'Сдача дня за управление', exact: true });
  await expect(card.getByLabel('Числа расхода', { exact: true })).toBeVisible();
  return { card, state };
}

test('expense card is compact, keeps the canonical unit totals and puts the date beside the summary', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { card } = await prepare(page);
  await expect(card).toContainText('Учебное управление');
  await expect(card.getByLabel('Числа расхода')).toContainText('62');
  await expect(card.getByLabel('Числа расхода')).toContainText('48');
  await expect(card.getByText('Приданы', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Проверить и сдать', exact: true })).toBeVisible();
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(270);
  const heading = await card.getByRole('heading', { name: 'Сдача расхода', exact: true }).boundingBox();
  const date = await card.locator('#status-business-date').boundingBox();
  expect(date!.x).toBeGreaterThan(heading!.x + heading!.width);
  await card.getByText('Состав расхода', { exact: true }).click();
  await expect(card.getByRole('table', { name: 'Состав расхода', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('expense preview keeps a separate confirmation and the selected unit/date without submitting immediately', async ({ page, businessWrites }) => {
  const { card, state } = await prepare(page);
  await card.getByRole('button', { name: 'Проверить и сдать', exact: true }).click();
  await expect(card.getByText('Сдать расход за 20.10.2026? Сотрудников по списку: 62.', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Подтвердить сдачу', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
  await card.getByRole('button', { name: 'Отмена', exact: true }).click();
  await card.locator('#status-business-date').fill('2026-10-21');
  await expect(page).toHaveURL(/businessDate=2026-10-21/);
  await expect(card.locator('#status-business-date')).toHaveValue('2026-10-21');
  expect(businessWrites).toEqual([]);
});

for (const width of [390, 320]) test(`expense card keeps date, summary and actions in the ${width}px viewport`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 844 });
  const { card } = await prepare(page);
  await expect(card.getByRole('button', { name: 'Проверить и сдать', exact: true })).toBeVisible();
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(businessWrites).toEqual([]);
});
