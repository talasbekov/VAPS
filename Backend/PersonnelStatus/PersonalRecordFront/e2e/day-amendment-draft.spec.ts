import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
const DAY = '2026-10-28';
const DIVISIONS = '/api/ops/daily/divisions/';
const SUBMISSIONS = '/api/ops/daily/daily-submissions/';
const units = ['9101', '9102'].map(id => ({ id, name: `Управление ${id}`, division_type: 'directorate', can_submit: true, can_correct: true }));
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
const region = (page: Page) => page.getByRole('region', { name: 'Сдача дня за управление', exact: true });
async function setup(page: Page) {
 const state = { fail: false, canCorrect: true, reads: 0, permissionReads: 0, writeStatus: 503, version: 1, listTotal: 2, targetReads: [] as string[], delay: null as ReturnType<typeof gate> | null, writeDelay: null as ReturnType<typeof gate> | null, writes: [] as unknown[] };
 page.on('request', request => {
  const url = new URL(request.url());
  if (request.method() === 'GET' && (url.pathname === SUBMISSIONS || url.pathname === '/api/operations/strength-report/') && url.searchParams.get('division_id') === '9101') state.targetReads.push(request.url());
 });
 await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.continue());
 await page.route('**/api/operations/my-permissions/**', route => { state.permissionReads++; return route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }); });
 await page.route(`**${DIVISIONS}**`, async route => { state.reads++; if (state.delay) await state.delay.promise; await route.fulfill(state.fail ? { status: 503, json: { detail: 'Unavailable fixture' } } : { json: { results: units.map(row => ({ ...row, can_correct: state.canCorrect })) } }); });
 await page.route(`**${SUBMISSIONS}**`, async route => {
  if (route.request().method() !== 'GET') { state.writes.push(route.request().postDataJSON()); if (state.writeDelay) await state.writeDelay.promise; await route.fulfill({ status: state.writeStatus, json: { detail: 'Unavailable fixture' } }); return; }
  const url = new URL(route.request().url());
  await route.fulfill({ json: { count: 1, results: [{ id: 99101, division_id: url.searchParams.get('division_id'), business_date: url.searchParams.get('business_date') ?? DAY, version: state.version, is_current: true, event: 'CHANGED', submitted_by: 'Автор', submitted_at: '2026-10-08T07:00:00Z', late: false, sent_at: null, sent_by: '', incomplete_reason: '' }] } });
 });
 await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: DAY, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' }, totals: { list_total: state.listTotal, attached: 0, columns: { IN_SERVICE: state.listTotal } }, rows: [] } }));
 const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
 const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } }); expect((await login.json()).url).not.toContain('error=');
 await page.goto(`${APP}/statuses?businessDate=${DAY}&submitDivision=9101`);
 await region(page).getByRole('button', { name: 'Исправить сдачу', exact: true }).click();
 await region(page).getByLabel('Причина', { exact: true }).fill('Уточнённый расход управления');
 await region(page).getByLabel('Санкция', { exact: true }).fill('Начальник разрешил');
 await expect.poll(() => state.targetReads.length).toBeGreaterThanOrEqual(3);
 return state;
}
async function refresh(page: Page, state: { reads: number }) { const before = state.reads; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await expect.poll(() => state.reads).toBeGreaterThan(before); }
test.describe('day amendment draft safeguards', () => {
 test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend; all writes mocked');
 test('explicit page refresh preserves the selected day and amendment draft', async ({ page }) => {
  const state = await setup(page); const before = state.reads;
  state.version = 2; state.listTotal = 7;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(region(page).locator('#status-business-date')).toHaveValue(DAY);
  await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('Уточнённый расход управления');
  await expect(region(page).getByLabel('Санкция', { exact: true })).toHaveValue('Начальник разрешил');
  await expect(region(page).getByText('День сдан: v2', { exact: false })).toBeVisible();
  await expect(region(page).getByRole('button', { name: 'Подтвердить исправление' })).toBeEnabled();
  expect(state.writes).toEqual([]);
 });
 test('same-context background refresh preserves reason and sanction while actions fail closed', async ({ page }) => {
  const state = await setup(page); state.delay = gate(); const before = [...state.targetReads];
  try { await refresh(page, state); await expect(region(page).getByRole('form', { name: 'Исправление сдачи' })).toBeHidden();
   expect(state.targetReads).toEqual(before);
   state.version = 2; state.listTotal = 7;
   state.delay.release();
   await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('Уточнённый расход управления');
   await expect(region(page).getByLabel('Санкция', { exact: true })).toHaveValue('Начальник разрешил');
   await expect(region(page).getByRole('button', { name: 'Подтвердить исправление' })).toBeEnabled(); expect(state.writes).toEqual([]);
   await expect.poll(() => state.targetReads.length).toBeGreaterThan(before.length);
   await expect(region(page).getByText('День сдан: v2', { exact: false })).toBeVisible();
   const preview = region(page).getByRole('region', { name: 'Расход на дату', exact: true });
   await expect(preview.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Список$/ }) }).locator('dd')).toHaveText('7');
   for (const previousUrl of new Set(before)) {
    await expect.poll(() => state.targetReads.filter(url => url === previousUrl).length).toBeGreaterThan(before.filter(url => url === previousUrl).length);
   }
  } finally { state.delay.release(); }
 });
 test('pending amendment locks inputs and cancel; failed write retains original draft', async ({ page }) => {
  const state = await setup(page); state.writeDelay = gate();
  try { await region(page).getByRole('button', { name: 'Подтвердить исправление' }).click(); await expect.poll(() => state.writes.length).toBe(1);
   await expect(region(page).getByLabel('Причина', { exact: true })).toBeDisabled(); await expect(region(page).getByLabel('Санкция', { exact: true })).toBeDisabled(); await expect(region(page).getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
   state.writeDelay.release(); await expect(region(page).getByRole('button', { name: 'Подтвердить исправление' })).toBeEnabled(); await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('Уточнённый расход управления'); expect(state.writes).toEqual([{ reason: 'Уточнённый расход управления', sanction: 'Начальник разрешил' }]);
  } finally { state.writeDelay.release(); }
 });
 test('failed metadata and revoked correction scope never expose draft actions', async ({ page }) => {
  const state = await setup(page); const before = [...state.targetReads]; state.fail = true; await refresh(page, state);
  await expect(region(page).getByText('Не удалось загрузить доступные управления.')).toBeVisible({ timeout: 25_000 }); await expect(region(page).getByRole('form', { name: 'Исправление сдачи' })).toBeHidden();
  expect(state.targetReads).toEqual(before);
  state.fail = false; state.canCorrect = false; await region(page).getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(region(page).getByText('День сдан: v1', { exact: false })).toBeVisible(); await expect(region(page).getByRole('form', { name: 'Исправление сдачи' })).toBeHidden(); await expect(region(page).getByRole('button', { name: 'Исправить сдачу', exact: true })).toHaveCount(0); expect(state.writes).toEqual([]);
 });
 test('real unit and date changes reset the old draft', async ({ page }) => {
  await setup(page); await region(page).getByLabel('Управление для сдачи дня').selectOption('9102'); await region(page).getByRole('button', { name: 'Исправить сдачу', exact: true }).click(); await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('');
  await region(page).getByLabel('Причина', { exact: true }).fill('Другой черновик'); await region(page).locator('#status-business-date').fill('2026-10-29'); await region(page).getByRole('button', { name: 'Исправить сдачу', exact: true }).click(); await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('');
 });
 test('amendment 403 rechecks permission and target before allowing a draft retry', async ({ page }) => {
  const state = await setup(page); const reads = state.reads; const permissionReads = state.permissionReads;
  state.writeStatus = 403; state.delay = gate();
  try {
   await region(page).getByRole('button', { name: 'Подтвердить исправление' }).click();
   await expect.poll(() => state.reads).toBeGreaterThan(reads);
   await expect.poll(() => state.permissionReads).toBeGreaterThan(permissionReads);
   await expect(region(page).getByRole('form', { name: 'Исправление сдачи' })).toBeHidden();
   expect(state.writes).toHaveLength(1);
   state.delay.release();
   await expect(region(page).getByRole('button', { name: 'Подтвердить исправление' })).toBeEnabled();
   await expect(region(page).getByLabel('Причина', { exact: true })).toHaveValue('Уточнённый расход управления');
   state.writeStatus = 503;
   await region(page).getByRole('button', { name: 'Подтвердить исправление' }).click();
   await expect.poll(() => state.writes.length).toBe(2);
  } finally { state.delay.release(); }
 });
});
