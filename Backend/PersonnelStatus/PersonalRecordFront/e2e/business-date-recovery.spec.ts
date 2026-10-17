import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
const region = (page: Page) => page.getByRole('region', { name: 'Сдача дня за управление', exact: true });

async function setup(page: Page, canSubmit = true, query = '', board = false) {
  const state = { fail: true, dateReads: 0, dateFailures: 0, divisionDates: [] as string[] };
  page.on('requestfinished', request => {
    if (new URL(request.url()).pathname === '/api/operations/tomorrow-block/' && state.fail) state.dateFailures++;
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
      ? route.abort() : route.continue();
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: board ? ['*'] : canSubmit ? ['status.view', 'status.workspace', 'daily_report.mark_update'] : ['status.view', 'status.workspace'],
    global_permissions: [], roles: [],
  } }));
  await page.route('**/api/operations/tomorrow-block/**', route => {
    state.dateReads++;
    return route.fulfill(state.fail
      ? { status: 503, json: { detail: 'Date service unavailable' } }
      : { json: { business_date: '2026-10-10', blocked: false, laggards: [] } });
  });
  await page.route('**/api/ops/daily/divisions/**', route => {
    state.divisionDates.push(new URL(route.request().url()).searchParams.get('business_date') ?? '');
    return route.fulfill({ json: { results: [] } });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
  } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(board ? `${APP}/employees/?view=daily` : `${APP}/statuses/${query}`);
  if (!board) await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
  return state;
}

test.describe('business date recovery', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend, read-only fixtures');

  test('failed server date offers retry and resumes with the server date', async ({ page }) => {
    const state = await setup(page);
    await expect(region(page).getByText('Не удалось загрузить дату расхода.', { exact: true })).toBeVisible();
    expect(state.divisionDates).toEqual([]);
    state.fail = false;
    await region(page).getByRole('button', { name: 'Повторить загрузку даты', exact: true }).click();
    await expect(region(page).getByLabel('Расход на дату', { exact: true })).toHaveValue('2026-10-10');
    await expect(region(page).getByText('Нет доступных управлений для сдачи дня.', { exact: true })).toBeVisible();
    expect(state.divisionDates).toEqual(['2026-10-10']);
  });

  test('explicit date remains usable when the default date fails', async ({ page }) => {
    const state = await setup(page, true, '?businessDate=2026-10-20');
    // The query retries transient failures once. Wait for both responses,
    // rather than passing while the default date is still pending.
    await expect.poll(() => state.dateFailures).toBe(2);
    await expect(region(page).getByText('Нет доступных управлений для сдачи дня.', { exact: true })).toBeVisible();
    await expect(region(page).getByLabel('Расход на дату', { exact: true })).toHaveValue('2026-10-20');
    expect(state.divisionDates).toEqual(['2026-10-20']);
    await region(page).getByLabel('Расход на дату', { exact: true }).fill('2026-10-21');
    await expect.poll(() => state.divisionDates).toEqual(['2026-10-20', '2026-10-21']);
    await expect(region(page).getByText('Не удалось загрузить дату расхода.', { exact: true })).toHaveCount(0);
  });

  test('a status reader does not fetch the hidden day-submission date', async ({ page }) => {
    const state = await setup(page, false);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(region(page)).toHaveCount(0);
    expect(state.dateReads).toBe(0);
    expect(state.divisionDates).toEqual([]);
  });

  test('daily expense board recovers the failed date without reloading the page', async ({ page }) => {
    const state = await setup(page, true, '', true);
    const board = page.getByRole('region', { name: 'Ежедневный расход', exact: true });
    await expect(board.getByText('Не удалось загрузить дату расхода.', { exact: true })).toBeVisible();
    state.fail = false;
    await board.getByRole('button', { name: 'Повторить загрузку даты', exact: true }).click();
    await expect(board.getByRole('button', { name: '10 октября 2026', exact: true })).toBeVisible();
    await expect(board.getByText('Не удалось загрузить дату расхода.', { exact: true })).toHaveCount(0);
  });
});
