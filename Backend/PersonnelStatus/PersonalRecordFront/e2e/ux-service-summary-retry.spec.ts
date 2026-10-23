import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const DATE = '2026-10-23';
const URL = `/security-ops/service-summary/?dateFrom=2026-10-22&dateTo=2026-10-24&day=${DATE}`;
const permissions = ['status.view', 'service_summary.view', 'daily_report.correct'];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const submission = (division: string, date: string) => ({ id: Number(division), division_id: division, business_date: date,
  version: 2, is_current: true, event: 'CONFIRMED_NO_CHANGES', submitted_by: 'Дежурный',
  submitted_at: '2026-10-22T10:00:00+05:00', late: false, sent_at: null, sent_by: '', incomplete_reason: '' });

async function prepare(page: Page) {
  const state = { submissionsFail: false, reportFail: false, assembled: false, denied: false,
    contextDenied: false, contextGate: null as ReturnType<typeof gate> | null,
    permissionGate: null as ReturnType<typeof gate> | null, retryGate: null as ReturnType<typeof gate> | null,
    reads: [] as { source: string; date: string | null }[] };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new globalThis.URL(request.url()), path = url.pathname;
    // All non-auth writes fall through to ux-fixture's mandatory business-write block.
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/operations/my-permissions/') {
      if (state.permissionGate) await state.permissionGate.promise;
      return route.fulfill({ json: { permissions: state.denied ? [] : permissions,
        global_permissions: state.denied ? [] : permissions, roles: [] } });
    }
    if (path === '/api/operations/service-summary-context/') {
      if (state.contextGate) await state.contextGate.promise;
      return route.fulfill(state.contextDenied ? { status: 403, json: { detail: 'Organization scope denied' } }
        : { json: { root_division_id: 1, root_name: 'Служба', can_generate_root_summary: false } });
    }
    const source = path === '/api/operations/traffic-light/tree/' ? 'tree'
      : path === '/api/ops/daily/daily-submissions/' ? 'submissions'
      : path === '/api/operations/strength-report/' ? 'report' : null;
    if (source) {
      const date = url.searchParams.get('business_date');
      if (!url.searchParams.has('division_id')) state.reads.push({ source, date });
      if (state.retryGate && date === DATE) await state.retryGate.promise;
      if ((source === 'submissions' && state.submissionsFail) || (source === 'report' && state.reportFail)) {
        return route.fulfill({ status: 503, json: { detail: 'Temporary read failure' } });
      }
      if (source === 'tree') return route.fulfill({ json: { business_date: date, nodes: [
        { division_id: 1, parent_id: null, name: 'Служба', requires_daily_submission: false },
        { division_id: 2, parent_id: 1, name: 'Департамент А', requires_daily_submission: true },
      ] } });
      if (source === 'submissions') return route.fulfill({ json: { count: state.assembled ? 2 : 1,
        results: [...(state.assembled ? [submission('1', date ?? DATE)] : []), submission('2', date ?? DATE)] } });
      return route.fulfill({ json: { business_date: date, rows: [{ division_id: 1, list_total: 12, columns: { IN_SERVICE: 10, OTHER: 2 } }],
        totals: { list_total: 12, columns: { IN_SERVICE: 10, OTHER: 2 } } } });
    }
    if (path === '/api/operations/status-types/') return route.fulfill({ json: { results: [
      { id: 1, code: 'IN_SERVICE', name: 'В строю', is_active: true, report_column_code: 'IN_SERVICE' },
    ] } });
    if (path === '/api/operations/daily-summaries/freshness/') return route.fulfill({ json: { status: 'STALE', can_rebuild: true } });
    if (path === '/api/ops/daily/employees/') return route.fulfill({ json: { count: 0, results: [] } });
    return route.fallback();
  });
  await signIn(page);
  return state;
}

test('a submissions-only failure retries the selected day and retains its range', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.submissionsFail = true;
  await page.goto(URL);
  const failure = page.getByRole('alert').filter({ hasText: 'Не удалось прочитать структуру и состояние сдачи.' });
  await expect(failure).toBeVisible();
  const before = state.reads.length;
  state.submissionsFail = false; state.retryGate = gate();
  try {
    await failure.getByRole('button', { name: 'Повторить загрузку свода', exact: true }).click();
    const day = page.getByRole('region', { name: 'Свод по Службе на 23.10.2026', exact: true });
    // An initial failure has no payload: refetch returns to the day loading
    // state, removing the error and its retry control until reads settle.
    await expect(day.getByText('Загрузка структуры и сдач…', { exact: true })).toBeVisible();
    await expect(day.getByRole('button', { name: /Повторить загрузку свода|Загрузка свода…/ })).toHaveCount(0);
    const recoveryReads = () => state.reads.slice(before).map(read => `${read.source}:${read.date}`).sort();
    await expect.poll(recoveryReads).toEqual([`submissions:${DATE}`, `tree:${DATE}`]);
    state.retryGate.release();
    await expect(page.getByRole('heading', { name: '23.10.2026 · Сдали 1 из 1 департаментов', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { selected: true })).toContainText('23.10.2026');
    await expect(page).toHaveURL(new RegExp('dateFrom=2026-10-22&dateTo=2026-10-24&day=2026-10-23'));
    expect(recoveryReads()).toEqual([`submissions:${DATE}`, `tree:${DATE}`]);
    expect(businessWrites).toEqual([]);
  } finally { state.retryGate.release(); }
});

test('a figures-only failure retries the same day without reloading its submissions', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.reportFail = true;
  await page.goto(URL);
  const retry = page.getByRole('button', { name: 'Повторить загрузку чисел', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('table', { name: 'Служба по департаментам', exact: true })).toBeVisible();
  const before = state.reads.length; state.reportFail = false;
  await retry.click(); await expect(retry).toHaveCount(0);
  await expect(page.getByText('По списку', { exact: true }).locator('..')).toContainText('12');
  expect(state.reads.slice(before)).toEqual([{ source: 'report', date: DATE }]);
  expect(businessWrites).toEqual([]);
});

test('a failed day refresh preserves the mounted correction draft through local recovery', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.assembled = true;
  await page.goto(URL);
  // Capture the mounted owner before the modal makes the background inert
  // and removes its regions from the accessible tree.
  const retained = await page.getByRole('region', { name: 'Исправление свода', exact: true }).first().elementHandle();
  await page.getByRole('button', { name: 'Исправить свод', exact: true }).click();
  const reason = page.getByRole('textbox', { name: 'Причина исправления', exact: true });
  await reason.fill('Сохранённый черновик причины');
  await page.getByRole('textbox', { name: 'Санкция на исправление', exact: true }).fill('Санкция дежурного');
  // Closing the dialog keeps its draft; the day read must not unmount its owner.
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  state.submissionsFail = true;
  const failureResponse = page.waitForResponse(response => new globalThis.URL(response.url()).pathname === '/api/ops/daily/daily-submissions/' && response.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await failureResponse;
  const day = page.getByRole('region', { name: 'Свод по Службе на 23.10.2026', exact: true });
  const failure = day.getByRole('alert').filter({ hasText: 'Не удалось прочитать структуру и состояние сдачи.' });
  await expect(failure).toBeVisible();
  state.submissionsFail = false;
  await failure.getByRole('button', { name: 'Повторить загрузку свода', exact: true }).click();
  await page.getByRole('button', { name: 'Исправить свод', exact: true }).click();
  await expect(reason).toHaveValue('Сохранённый черновик причины');
  await expect(page.getByRole('textbox', { name: 'Санкция на исправление', exact: true })).toHaveValue('Санкция дежурного');
  expect(await retained!.evaluate(element => element.isConnected)).toBe(true);
  expect(businessWrites).toEqual([]);
});

test('unconfirmed permissions and a denied organization context mount no day reads or retry', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.permissionGate = gate(); state.contextDenied = true;
  try {
    await page.goto(URL);
    await expect(page.getByRole('button', { name: 'Повторить загрузку свода', exact: true })).toHaveCount(0);
    expect(state.reads).toEqual([]);
    state.permissionGate.release();
    await expect(page.getByText('Для свода по Службе нужен доступ к корню организации.', { exact: true })).toBeVisible();
    expect(state.reads).toEqual([]);
    await expect(page.getByRole('button', { name: 'Повторить загрузку чисел', exact: true })).toHaveCount(0);
    expect(businessWrites).toEqual([]);
  } finally { state.permissionGate.release(); }
});
