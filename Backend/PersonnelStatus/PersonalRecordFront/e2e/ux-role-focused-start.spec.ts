import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

// Run only against reviewed source with a separate config without global setup/teardown.
// ux-fixture blocks business writes for every test below; all role/data changes are browser fixtures.
const businessDate = '2026-10-20';
const expenseRole = (scope: number | null) => ({ code: 'DEPARTMENT_EXPENSE_OFFICER', name: 'Ответственный за расход департамента',
  scope_division_id: scope, scope_division_name: scope === null ? null : `Департамент ${scope}` });

async function expenseFixture(page: Page, gathering = false) {
  const state = { scope: 2, status: 200, reads: 0, permissions: ['status.view', 'forces.allocate', 'daily_report.generate'],
    roles: [expenseRole(2)], hold: null as Promise<void> | null };
  if (gathering) state.roles = [{ ...expenseRole(2), code: 'FORCES_GATHERING_OFFICER' }];
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: state.permissions, global_permissions: [], roles: state.roles,
  } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: {
    business_date: businessDate, blocked: false, overridden: false, laggards: [],
  } }));
  const division = (id: string, parent_id: string | null, name: string, without_status = 0, recipient: string | null = null) => ({
    id, parent_id, name, without_status, division_type: parent_id === null ? 'department' : 'directorate', notify_recipient_name: recipient,
  });
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
    division('2', null, 'Департамент 2'), division('3', '2', 'Управление А', 2, 'Начальник А'),
    division('4', '2', 'Управление без получателя'), division('18', null, 'Департамент 18'),
    division('19', '18', 'Управление Б', 0, 'Начальник Б'),
  ] } }));
  const row = (division_id: number, count: number) => ({ division_id, name: String(division_id), list_total: count,
    staff_total: count, vacancies: 0, attached: 0, off_list: 0, columns: { ready: count }, event: { group: 0, squad: 0 } });
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: {
    business_date: new URL(route.request().url()).searchParams.get('business_date'), columns: ['ready'], column_labels: { ready: 'В строю' },
    rows: [row(2, 1), row(3, 2), row(4, 1), row(18, 1), row(19, 3)], totals: row(2, 8), warnings: [],
  } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 1, next: null, previous: null, results: [{
    code: 'IN_SERVICE', name: 'В строю', report_column_code: 'ready', priority: 1000, counts_in_list: true, counts_in_staff: true,
    is_active: true, is_hard_block: false, restricts_editing: false, is_ku_owned: false, max_duration_days: null, color: '#22c55e', legacy_code: null,
  }] } }));
  await page.route('**/api/ops/daily/daily-submissions/**', async route => {
    state.reads++;
    if (state.hold) await state.hold;
    return state.status === 200 ? route.fulfill({ json: { results: [] } })
      : route.fulfill({ status: state.status, json: { error_code: state.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE', message: 'Источник недоступен' } });
  });
  return state;
}

test('ordinary employee starts with personal work and can open their profile with shared read grants', async ({ page, businessWrites }) => {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['catalog.view', 'document.view', 'feedback.view', 'feedback.create', 'object.view', 'status.view', 'status.workspace'],
    global_permissions: [], roles: [{ code: 'EMPLOYEE', name: 'Сотрудник', scope_division_id: 3, scope_division_name: 'Управление' }],
  } }));
  await page.route('**/api/operations/my-employee/**', route => route.fulfill({ json: { employee: null, unlinked_reason: 'NO_EMPLOYEE' } }));
  await signIn(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/workspace\/?$/);
  await expect(page.getByRole('heading', { name: 'Мои задания и дежурства', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Основная навигация', exact: true })
    .getByRole('link', { name: 'Мои задания и дежурства', exact: true }).click();
  await expect(page).toHaveURL(/\/security-ops\/profile\/?$/);
  await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const width of [1440, 390, 320]) test(`expense start shows date and summary action before optional details at ${width}px`, async ({ page, businessWrites }, testInfo) => {
  await expenseFixture(page);
  await signIn(page);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/workspace\/?$/);
  const lead = page.getByRole('region', { name: 'Главное действие', exact: true });
  const entry = lead.getByRole('link', { name: 'Сдать расход департамента', exact: true });
  await expect(entry).toBeVisible();
  const entryBox = (await entry.boundingBox())!;
  expect(entryBox.y + entryBox.height).toBeLessThan(1000);
  await entry.click();
  await expect(page).toHaveURL(/\/employees\/?\?view=daily$/);
  await expect(page.getByRole('region', { name: 'Очередь ежедневного расхода', exact: true })).toHaveCount(0);
  const form = page.getByRole('region', { name: 'Расход департамента', exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Расход на дату')).toHaveValue(businessDate);
  await expect(form).toContainText('Сдали 0 из 2');
  const action = form.getByRole('button', { name: 'Собрать свод', exact: true });
  await expect(action).toBeVisible();
  const actionBox = (await action.boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThan(1000);
  await testInfo.attach('primary-action-position', { body: JSON.stringify({ width, height: 1000, entry: entryBox, summary: actionBox }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('daily-first-screen.png') });
  const details = form.locator('details').filter({ has: page.locator('summary', { hasText: 'Не сдали: 2' }) });
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details).toContainText('Начальник А');
  await expect(details).toContainText('Получатель напоминания: не назначен');
  await expect(details).toContainText('Без отдельной отметки: 2');
  await expect(form.getByRole('region', { name: 'Таблица расхода', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('daily-compact.png') });
});

test('cached missing-source details stay hidden after a denied read until successful retry', async ({ page, businessWrites }) => {
  const state = await expenseFixture(page, true);
  await signIn(page);
  await page.goto(`/employees/?businessDate=${businessDate}&search=retained`);
  const queue = page.getByRole('region', { name: 'Очередь ежедневного расхода', exact: true });
  await expect(queue).toContainText('Начальник А');
  await page.clock.install();
  state.status = 403;
  const reads = state.reads;
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
  await expect(queue.getByRole('alert')).toContainText('Доступ к очереди расхода закрыт');
  await expect(queue).not.toContainText('Начальник А');
  await expect(queue).not.toContainText('Не сдали:');
  state.status = 503;
  await queue.getByRole('button', { name: 'Повторить загрузку очереди', exact: true }).click();
  await expect(queue.getByRole('alert')).toContainText('Очередь ежедневного расхода недоступна');
  await expect(queue).not.toContainText('Начальник А');
  state.status = 200;
  await queue.getByRole('button', { name: 'Повторить загрузку очереди', exact: true }).click();
  await expect(queue).toContainText('Начальник А');
  await expect(queue.getByRole('link', { name: 'Открыть свод', exact: true })).toHaveAttribute('href', /businessDate=2026-10-20.*search=retained.*#summary-action/);
  expect(businessWrites).toEqual([]);
});

test('changing only the role scope hides old source names while the new snapshot is pending', async ({ page, businessWrites }) => {
  const state = await expenseFixture(page, true);
  await signIn(page);
  await page.goto(`/employees/?businessDate=${businessDate}`);
  const queue = page.getByRole('region', { name: 'Очередь ежедневного расхода', exact: true });
  await expect(queue).toContainText('Начальник А');
  await page.clock.install();
  let release = () => {};
  state.hold = new Promise<void>(resolve => { release = resolve; });
  state.roles = [{ ...expenseRole(18), code: 'FORCES_GATHERING_OFFICER' }];
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  try {
    await expect(queue).toContainText('Департамент 18');
    await expect(queue.getByRole('status')).toContainText('Загрузка очереди');
    await expect(queue).not.toContainText('Начальник А');
    await expect(queue).not.toContainText('Не сдали:');
  } finally { release(); }
  await expect(queue).toContainText('Начальник Б');
  await expect(queue).not.toContainText('Начальник А');
  expect(businessWrites).toEqual([]);
});

test('explicit daily callback retains date, query and hash instead of choosing a role start again', async ({ page, businessWrites }) => {
  await expenseFixture(page);
  await signIn(page);
  const callback = `/employees/?view=daily&businessDate=${businessDate}&search=retained#summary-action`;
  await page.goto(`/?callbackUrl=${encodeURIComponent(callback)}`);
  await expect(page).toHaveURL(new RegExp('/employees/\\?view=daily&businessDate=' + businessDate + '&search=retained#summary-action$'));
  const form = page.getByRole('region', { name: 'Расход департамента', exact: true });
  await expect(form).toContainText('Сдали 0 из 2');
  await expect(form.getByRole('button', { name: 'Собрать свод', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});
