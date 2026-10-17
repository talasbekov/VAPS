import { expect, test, type Page, type Route } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
const date = '2026-10-09';
async function setup(page: Page, capability: boolean | undefined, mode: 'root' | 'department' | 'generic' = 'root', multiple = false) {
  const divisionId = mode === 'root' ? 1 : 2;
  const state = { capability, contextFail: false, freshnessFail: false, submissionsFail: false, correctPermission: true, reject: false, hold: false, release: () => {}, writes: [] as any[], blocked: [] as string[], summaryTargets: [] as string[], reads: 0, version: 1 };
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) || new URL(route.request().url()).pathname.startsWith('/api/auth/')) return route.fallback();
    state.blocked.push(route.request().url()); return route.fulfill({ status: 403, json: { detail: 'Unmocked write forbidden' } });
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: mode === 'generic' ? ['*'] : ['status.view', 'service_summary.view', ...(state.correctPermission ? ['daily_report.correct'] : []), 'forces.allocate'], global_permissions: mode === 'generic' ? ['*'] : [], roles: mode === 'department' ? [{ code: 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id: 2, name: 'Ответственный', scope_division_name: 'Департамент А' }] : [] } }));
  await page.route('**/api/operations/service-summary-context/**', route => route.fulfill(state.contextFail ? { status: 503, json: { detail: 'Context unavailable' } } : { json: { root_division_id: 1, root_name: 'Служба', can_generate_root_summary: false } }));
  await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: { business_date: date, nodes: [
    { division_id: 1, parent_id: null, name: 'Служба', requires_daily_submission: false },
    { division_id: 2, parent_id: 1, name: 'Департамент А', requires_daily_submission: true, is_summary_node: !multiple },
    { division_id: 3, parent_id: 2, name: 'Управление А', requires_daily_submission: true },
    ...(multiple ? [{ division_id: 4, parent_id: 1, name: 'Департамент Б' }, { division_id: 5, parent_id: 4, name: 'Управление Б1' }, { division_id: 6, parent_id: 4, name: 'Управление Б2' }] : []),
  ] } }));
  const submission = () => ({ id: state.version, division_id: String(divisionId), business_date: date, version: state.version, is_current: true, event: state.version === 1 ? 'CHANGED' : 'AMENDED', submitted_by: 'Fixture', submitted_at: `${date}T10:00:00Z`, late: false, sent_at: null, sent_by: '', incomplete_reason: '' });
  await page.route('**/api/ops/daily/daily-submissions/**', route => {
    const params = new URL(route.request().url()).searchParams;
    const target = params.get('division_id');
    if (target) state.summaryTargets.push(target);
    const current = { ...submission(), division_id: target ?? String(divisionId), business_date: params.get('business_date') ?? date };
    const results = state.version > 1 ? [current, { ...current, id: 1, version: 1, is_current: false }] : [current];
    return route.fulfill(state.submissionsFail ? { status: 503, json: { detail: 'Submissions unavailable' } } : { json: { results } });
  });
  const figures = { division_id: 3, name: 'Управление А', list_total: 1, staff_total: 1, vacancies: 0, attached: 0, off_list: 0, columns: { IN_SERVICE: 1 }, employee_ids_by_column: { IN_SERVICE: [1] }, event: { group: 0, squad: 0 } };
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: date, rows: multiple ? [figures, { ...figures, division_id: 5, name: 'Управление Б1' }, { ...figures, division_id: 6, name: 'Управление Б2' }] : [figures], totals: figures, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' } } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: date, blocked: false, laggards: [] } }));
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
    { id: '2', parent_id: '1', without_status: 0, name: 'Департамент А', division_type: 'department', ancestors: ['Служба'] },
    { id: '3', parent_id: '2', without_status: 0, name: 'Управление А', division_type: 'directorate', ancestors: ['Служба', 'Департамент А'] },
  ] } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/operations/daily-summaries/freshness/**', route => {
    state.reads++;
    return route.fulfill(state.freshnessFail ? { status: 503, json: { detail: 'Freshness unavailable' } } : { json: { division_id: divisionId, business_date: new URL(route.request().url()).searchParams.get('business_date'), status: state.version === 1 ? 'STALE' : 'FRESH', can_rebuild: state.capability, superseded: [], missing: [], unpinned: [] } });
  });
  await page.route('**/api/operations/daily-summaries/rebuild/**', async route => {
    state.writes.push(route.request().postDataJSON());
    if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
    if (state.reject) return route.fulfill({ status: 422, json: { error_code: 'SUMMARY_CHILDREN_NOT_SUBMITTED', message: 'Не все подразделения сдали день', details: {} } });
    state.version++; return route.fulfill({ status: 201, json: submission() });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(APP + (mode === 'root' ? '/security-ops/service-summary?dateFrom=' : '/employees?view=daily&businessDate=') + date);
  await expect(page.getByRole('region', { name: mode === 'root' ? 'Свод Службы' : 'Суточный свод', exact: true })).toBeVisible({ timeout: 30_000 });
  return state;
}
async function openDraft(page: Page) {
  await page.getByRole('button', { name: 'Исправить свод', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Исправить свод', exact: true });
  await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeDisabled();
  await dialog.getByLabel('Причина исправления', { exact: true }).fill('Департамент пересдал');
  await dialog.getByLabel('Санкция на исправление', { exact: true }).fill('Разрешение начальника');
  return dialog;
}
test.describe('explicit summary correction', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated fixtures with all non-auth writes intercepted');
  test.setTimeout(50_000);
  for (const [source, pattern] of [
    ['default date', '**/api/operations/tomorrow-block/**'],
    ['structure', '**/api/ops/daily/divisions/**'],
    ['tree', '**/api/operations/traffic-light/tree/**'],
    ['report', '**/api/operations/strength-report/**'],
  ]) test(`generic correction retains its draft but blocks writes after failed ${source} refresh`, async ({ page }) => {
    await page.clock.install();
    const state = await setup(page, true, 'generic');
    if (source === 'default date') await page.goto(APP + '/employees?view=daily');
    const dialog = await openDraft(page);
    let failures = 0;
    const reject = (route: Route) => { failures++; return route.fulfill({ status: 503, json: { detail: 'Context temporarily unavailable' } }); };
    await page.route(pattern, reject);
    await page.clock.fastForward(6 * 60_000);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => failures).toBe(2);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Причина исправления', { exact: true })).toHaveValue('Департамент пересдал');
    await page.unroute(pattern, reject);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeEnabled();
    await expect(dialog.getByLabel('Санкция на исправление', { exact: true })).toHaveValue('Разрешение начальника');
    expect(state.writes).toEqual([]); expect(state.blocked).toEqual([]);
  });
  for (const capability of [false, undefined]) test(`missing or scoped-out capability ${String(capability)} cannot correct`, async ({ page }) => {
    const state = await setup(page, capability); await expect.poll(() => state.reads).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Исправить свод', exact: true })).toHaveCount(0); expect(state.writes).toEqual([]);
  });
  test('accepted correction closes before failed read and retry never replays write', async ({ page }) => {
    const state = await setup(page, true); const dialog = await openDraft(page); state.freshnessFail = true;
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Исправленная версия сохранена.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить загрузку свода', exact: true })).toBeVisible();
    state.freshnessFail = false;
    await page.getByRole('button', { name: 'Повторить загрузку свода', exact: true }).click();
    await expect(page.getByText('Версия 2', { exact: true })).toBeVisible();
    expect(state.writes).toEqual([{ division_id: 1, business_date: date, reason: 'Департамент пересдал', sanction: 'Разрешение начальника' }]);
    expect(state.blocked).toEqual([]);
  });
  test('pending correction locks draft and dismissal; rejection retains input', async ({ page }) => {
    const state = await setup(page, true); const dialog = await openDraft(page); state.hold = true; state.reject = true;
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    try {
      await expect(dialog.getByLabel('Причина исправления', { exact: true })).toBeDisabled();
      await expect(dialog.getByLabel('Санкция на исправление', { exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape'); await dialog.locator('[data-slot="dialog-close"]').click();
      await expect(dialog).toBeVisible(); expect(state.writes).toHaveLength(1);
    } finally { state.release(); }
    await expect(dialog.getByText('Не все подразделения сдали день', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Причина исправления', { exact: true })).toHaveValue('Департамент пересдал');
    await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeEnabled();
  });
  test('capability revocation blocks open draft; workspace error hides portal', async ({ page }) => {
    const state = await setup(page, true); const dialog = await openDraft(page); state.capability = false;
    const before = state.reads; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.reads).toBeGreaterThan(before);
    await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Причина исправления', { exact: true })).toHaveValue('Департамент пересдал');
    state.contextFail = true; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(dialog).toHaveCount(0); expect(state.writes).toEqual([]);
  });
  for (const mode of ['department', 'generic'] as const) test(`${mode} entry corrects its own division without sending or history actions`, async ({ page }) => {
    const state = await setup(page, true, mode); const dialog = await openDraft(page);
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(page.getByText('Версия 2', { exact: true })).toBeVisible();
    expect(state.writes).toEqual([{ division_id: 2, business_date: date, reason: 'Департамент пересдал', sanction: 'Разрешение начальника' }]);
    expect(state.blocked).toEqual([]);
    if (mode === 'department') await expect(page.getByRole('region', { name: 'Версии свода', exact: true }).getByRole('button', { name: 'Исправить свод', exact: true })).toHaveCount(0);
  });
  test('department accepted correction survives versions read failure and retries only reads', async ({ page }) => {
    const state = await setup(page, true, 'department'); const dialog = await openDraft(page); state.submissionsFail = true;
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Повторить загрузку свода', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Исправленная версия сохранена.', { exact: true })).toBeVisible();
    state.submissionsFail = false;
    await page.getByRole('button', { name: 'Повторить загрузку свода', exact: true }).click();
    await expect(page.getByText('Версия 2', { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1);
  });
  test('revoked aggregate correction permission blocks a cached positive capability', async ({ page }) => {
    const state = await setup(page, true); const dialog = await openDraft(page); state.correctPermission = false;
    const before = state.reads; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.reads).toBeGreaterThan(before);
    await expect(dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true })).toBeDisabled(); expect(state.writes).toEqual([]);
  });
  test('changing the active day does not carry the correction reason into another date', async ({ page }) => {
    await setup(page, true);
    await page.getByRole('button', { name: 'Диапазон', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Дневные срезы диапазона' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    const dialog = await openDraft(page); await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Свод по Службе на 10.10.2026', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Исправить свод', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Причина исправления', { exact: true })).toHaveValue('');
    await expect(page.getByRole('dialog').getByLabel('Санкция на исправление', { exact: true })).toHaveValue('');
  });
  test('unequal department coverage requires a visible target choice before summary reads or writes', async ({ page }) => {
    const state = await setup(page, true, 'generic', true);
    const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
    await expect(summary.getByRole('button', { name: 'Департамент А', exact: true })).toBeVisible();
    await expect(summary.getByRole('button', { name: 'Департамент Б', exact: true })).toBeVisible();
    expect(state.summaryTargets).toEqual([]); expect(state.writes).toEqual([]);
    await summary.getByRole('button', { name: 'Департамент А', exact: true }).click();
    await expect(summary.getByText('Свод за департамент «Департамент А»', { exact: false })).toBeVisible();
    const dialog = await openDraft(page);
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(state.writes[0].division_id).toBe(2);
    expect([...new Set(state.summaryTargets)]).toEqual(['2']);
    await summary.getByRole('button', { name: 'Выбрать другой', exact: true }).click();
    await summary.getByRole('button', { name: 'Департамент Б', exact: true }).click();
    await expect(summary.getByText('Свод за департамент «Департамент Б»', { exact: false })).toBeVisible();
    await summary.getByRole('button', { name: 'Исправить свод', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Причина исправления', { exact: true })).toHaveValue('');
    expect(state.blocked).toEqual([]);
  });
  test('root badge uses the current corrected version while full history retains version one', async ({ page }) => {
    const state = await setup(page, true); const dialog = await openDraft(page);
    await dialog.getByRole('button', { name: 'Создать исправленную версию', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Версия 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Версия 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Свод Службы', exact: true }).getByRole('status')).toContainText('v2');
    expect(state.writes).toHaveLength(1);
  });
});
