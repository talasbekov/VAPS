import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

async function openSelection(page: Page, mode: 'normal' | 'blocked' | 'forbidden' | 'after-send-forbidden' = 'normal') {
  const request = { allocationId: 'selection-31', eventId: '901', code: 'ОМ-901', title: 'Встреча делегации', businessDate: '2026-10-23', businessDateEnd: '2026-10-24', location: 'Учебный объект', departmentName: 'Первый департамент', status: 'NOTIFIED', dueAt: null, needByKind: { PHYSICAL_SQUAD: 3, SCREENING_GROUP: 4 }, assignedByKind: { PHYSICAL_SQUAD: 1, SCREENING_GROUP: 2 }, directorates: [{ divisionId: '3', name: 'Первое управление', need: 3, assigned: 3, notifiedAt: '2026-10-22T00:00:00Z' }] };
  let writes = 0;
  let recovered = false;
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: { division: null, staff_units: [], total_count: 0, matched_count: 0, page: 1, page_size: 50, has_next: false, summary: { employees: 0, without_status: 0, overdue: 0, scheduled: 0 } } }));
  let revoked = false;
  await page.route('**/api/operations/my-permissions/**', route => {
    const permissions = revoked ? ['status.workspace', 'status.view'] : ['status.workspace', 'status.view', 'status.manage'];
    return route.fulfill({ json: { permissions, global_permissions: permissions, roles: [] } });
  });
  await page.route('**/api/ops/security-events/forces/directorate-requests/**', route => route.fulfill({ json: { results: [request] } }));
  await page.route('**/api/ops/security-events/forces/requests/selection-31/directorate/**', route => {
    if (route.request().method() === 'POST') { writes++; return route.fulfill({ json: mode === 'after-send-forbidden'
      ? { selected: [], refused: [{ employeeId: '71', name: 'Иванов Иван', code: 'DOUBLE_ASSIGNMENT', message: 'Уже в резерве', overridable: false }], request }
      : { selected: ['71'], refused: [], request } }); }
    const url = new URL(route.request().url());
    const reviewing = url.searchParams.has('employeeIds');
    if ((reviewing && mode === 'forbidden') || (mode === 'after-send-forbidden' && writes > 0 && !recovered && url.pathname.endsWith('/candidates/'))) return route.fulfill({ status: 403, json: { detail: 'Доступ закрыт' } });
    if (url.pathname.endsWith('/candidates/')) return route.fulfill({ json: {
      request, count: 2, page: 1, pageSize: 50, hasNext: false, assessmentScope: 'page', results: [
        { employeeId: '71', name: 'Иванов Иван', unit: 'Первое управление', rankLabel: '', assessment: 'RESERVE_ELIGIBLE', code: '', message: 'Можно предложить в резерв', overridable: false },
        { employeeId: '72', name: 'Петров Пётр', unit: 'Первое управление', rankLabel: '', assessment: 'BLOCKED', code: 'DOUBLE_ASSIGNMENT', message: 'Сотрудник уже находится в общем резерве.', overridable: false },
      ].filter(row => !reviewing || url.searchParams.get('employeeIds')!.split(',').includes(row.employeeId)).map(row => reviewing && mode === 'blocked' ? { ...row, assessment: 'BLOCKED', message: 'Сотрудник уже находится в общем резерве.' } : row),
    } });
    return route.fulfill({ json: request });
  });
  await signIn(page);
  await page.goto('/statuses/?forcesRequest=selection-31');
  return { writes: () => writes, revoke: () => { revoked = true; }, recover: () => { recovered = true; } };
}

for (const width of [320, 1440]) test(`request candidates require named review before an explicit send at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const actions = await openSelection(page);
  const selection = page.locator('[data-slot="request-candidate-picker"]');
  await expect(selection.getByText('Выберите ещё 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подбор сотрудников на ОМ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вернуться к статусам сотрудников' })).toHaveAttribute('href', '/statuses/');
  await expect(page.getByRole('tab', { name: 'Таблица сотрудников' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Сдача дня за управление' })).toHaveCount(0);
  await expect(page.locator('dl[aria-label="Сводка статусов"]')).toHaveCount(0);
  await expect(selection.getByRole('button', { name: 'Назад', exact: true })).toHaveCount(0);
  await expect(selection.getByRole('button', { name: 'Дальше', exact: true })).toHaveCount(0);
  const suggest = selection.getByRole('button', { name: 'Предложить состав из показанных' });
  expect(await suggest.evaluate(button => button.getBoundingClientRect().width <= button.parentElement!.getBoundingClientRect().width && button.scrollWidth <= button.clientWidth)).toBe(true);
  await expect(page.locator('[data-slot="request-selection-context"]')).toContainText('Физический наряд · нужно 3 · выделено 1');
  await expect(page.locator('[data-slot="forces-request-banner"]')).toContainText('23.10.2026 — 24.10.2026');
  await expect(selection.getByText('Сотрудник уже находится в общем резерве.')).toBeVisible();
  await selection.getByRole('button', { name: 'Предложить состав из показанных' }).click();
  await expect(selection.getByText('Выберите ещё 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.UX_RESULTS_DIR) {
    fs.mkdirSync(process.env.UX_RESULTS_DIR, { recursive: true });
    await selection.screenshot({ path: path.join(process.env.UX_RESULTS_DIR, `candidates-${width}.png`) });
  }
  expect(actions.writes()).toBe(0);
  await selection.getByRole('button', { name: 'Проверить выбранных: 1' }).click();
  const review = page.getByRole('dialog', { name: 'Проверьте состав перед отправкой' });
  await expect(review.getByText('Иванов Иван', { exact: true })).toBeVisible();
  await expect(review.getByText(/Учебный объект/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.UX_RESULTS_DIR) await review.screenshot({ path: path.join(process.env.UX_RESULTS_DIR, `review-${width}.png`) });
  expect(actions.writes()).toBe(0);
  await review.getByRole('button', { name: 'Отправить в резерв' }).click();
  await expect.poll(actions.writes).toBe(1);
});

for (const mode of ['blocked', 'forbidden'] as const) {
  test(`review ${mode} prevents sending previously selectable candidates`, async ({ page }) => {
    const actions = await openSelection(page, mode);
    const selection = page.locator('[data-slot="request-candidate-picker"]');
    await selection.getByRole('button', { name: 'Предложить состав из показанных' }).click();
    await selection.getByRole('button', { name: 'Проверить выбранных: 1' }).click();
    if (mode === 'blocked') {
      const review = page.getByRole('dialog', { name: 'Проверьте состав перед отправкой' });
      await expect(review.getByText('В составе есть ограничения. Вернитесь к подбору и уберите недоступных сотрудников.')).toBeVisible();
      await expect(review.getByRole('button', { name: 'Отправить в резерв' })).toBeDisabled();
    } else {
      await expect(selection.getByText('Не удалось проверить кандидатов. Состав скрыт до успешной повторной проверки.')).toBeVisible();
      await expect(page.getByText('Иванов Иван', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    expect(actions.writes()).toBe(0);
  });
}

test('changing a request discards the previous selection', async ({ page }) => {
  const actions = await openSelection(page);
  const selection = page.locator('[data-slot="request-candidate-picker"]');
  await selection.getByRole('button', { name: 'Предложить состав из показанных' }).click();
  await page.goto('/statuses/?forcesRequest=another-request');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Проверить выбранных: 1' })).toHaveCount(0);
  expect(actions.writes()).toBe(0);
});

test('denied refresh hides names in a previous mutation refusal report', async ({ page }) => {
  const actions = await openSelection(page, 'after-send-forbidden');
  const selection = page.locator('[data-slot="request-candidate-picker"]');
  await selection.getByRole('button', { name: 'Предложить состав из показанных' }).click();
  await selection.getByRole('button', { name: 'Проверить выбранных: 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить в резерв' }).click();
  await expect.poll(actions.writes).toBe(1);
  await expect(selection.getByText('Не удалось проверить кандидатов. Состав скрыт до успешной повторной проверки.')).toBeVisible();
  await expect(selection.getByText(/Иванов Иван/)).toHaveCount(0);
  await expect(selection.locator('[data-slot="select-report"]')).toHaveCount(0);
  actions.recover();
  await selection.getByRole('button', { name: 'Повторить проверку' }).click();
  await expect(selection.getByRole('checkbox', { name: 'Иванов Иван' })).toBeVisible();
  await expect(selection.locator('[data-slot="select-report"]')).toHaveCount(0);
  expect(actions.writes()).toBe(1);
});

test('permission revocation closes review and clears the candidate draft', async ({ page }) => {
  const actions = await openSelection(page);
  const selection = page.locator('[data-slot="request-candidate-picker"]');
  await selection.getByRole('button', { name: 'Предложить состав из показанных' }).click();
  await selection.getByRole('button', { name: 'Проверить выбранных: 1' }).click();
  await expect(page.getByRole('dialog').getByText('Иванов Иван', { exact: true })).toBeVisible();
  actions.revoke();
  const refreshed = page.waitForResponse(response => response.url().includes('/my-permissions/') && response.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
  await expect(page.getByText('У вашей роли нет права выделять сотрудников по этому запросу.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Иванов Иван', { exact: true })).toHaveCount(0);
  expect(actions.writes()).toBe(0);
});
