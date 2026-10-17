import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';
async function setup(page: Page) {
  const reads: string[] = [];
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['status.view', 'service_summary.view'], global_permissions: ['status.view', 'service_summary.view'], roles: [{ code: 'CUSTOM_VIEWER', name: 'Читатель свода', scope_division_id: null }] } }));
  page.on('request', request => { if (/\/api\/operations\/(tomorrow-block|traffic-light|daily-submissions|strength-report)\//.test(request.url())) reads.push(request.url()); });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  return reads;
}

async function actionFixture(page: Page) {
  await setup(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'service_summary.view', 'daily_report.generate'],
    global_permissions: ['status.view', 'service_summary.view'],
    roles: [{ code: 'CUSTOM_GENERATOR', name: 'Генератор', scope_division_id: 2 }],
  } }));
  await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: {
    business_date: '2026-10-10', nodes: [
      { division_id: 1, parent_id: null, name: 'Служба', requires_daily_submission: false },
      { division_id: 2, parent_id: 1, name: 'Департамент А', requires_daily_submission: true },
    ],
  } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: {
    business_date: '2026-10-10', rows: [], totals: { list_total: 0, columns: {} },
  } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [] } }));
}
test.describe('service summary server context', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated read-only fixtures');
  test('department generation grant cannot enable root summary actions', async ({ page }) => {
    await actionFixture(page);
    await page.route('**/api/operations/service-summary-context/**', route => route.fulfill({ json: {
      root_division_id: 1, root_name: 'Служба', can_generate_root_summary: false,
    } }));
    await page.goto(`${APP}/security-ops/service-summary/?dateFrom=2026-10-10`);
    await expect(page.getByRole('region', { name: 'Свод Службы', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Собрать свод Службы', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Напомнить несдавшим', exact: true })).toHaveCount(0);
  });
  test('root action capability is suspended during focus refresh and removed after scope revocation', async ({ page }) => {
    await actionFixture(page);
    let refresh = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    await page.route('**/api/operations/service-summary-context/**', async route => {
      reads++;
      if (refresh) await gate;
      await route.fulfill({ json: { root_division_id: 1, root_name: 'Служба', can_generate_root_summary: !refresh } });
    });
    try {
      await page.goto(`${APP}/security-ops/service-summary/?dateFrom=2026-10-10`);
      const action = page.getByRole('button', { name: 'Собрать свод Службы', exact: true });
      await expect(action).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Напомнить несдавшим', exact: true })).toBeEnabled();
      refresh = true;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        window.dispatchEvent(new Event('visibilitychange'));
      });
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        window.dispatchEvent(new Event('visibilitychange'));
        delete (document as unknown as { visibilityState?: string }).visibilityState;
      });
      await expect.poll(() => reads).toBeGreaterThan(1);
      await expect(action).not.toBeVisible();
      release();
      await expect(page.getByRole('region', { name: 'Свод Службы', exact: true })).toBeVisible();
      await expect(action).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Напомнить несдавшим', exact: true })).toHaveCount(0);
    } finally { release(); }
  });
  test('custom rights wait for server context and recover a failed read', async ({ page }) => {
    const reads = await setup(page);
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let contexts = 0;
    await page.route('**/api/operations/service-summary-context/**', async route => {
      contexts++;
      await gate;
      await route.fulfill(fail ? { status: 503, json: { detail: 'Fixture unavailable' } } : { json: { root_division_id: 1, root_name: 'Служба' } });
    });
    try {
      await page.goto(`${APP}/security-ops/service-summary/`);
      await expect.poll(() => contexts).toBeGreaterThan(0);
      expect(reads).toEqual([]);
      release();
      const error = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить область свода по Службе.' });
      await expect(error).toBeVisible();
      fail = false;
      await error.getByRole('button', { name: 'Повторить', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Свод по Службе', exact: true })).toBeVisible();
      await expect.poll(() => reads.length).toBeGreaterThan(0);
    } finally { release(); }
  });
  test('scope denial explains organization access and mounts no business reads', async ({ page }) => {
    const reads = await setup(page);
    await page.route('**/api/operations/service-summary-context/**', route => route.fulfill({ status: 403, json: { error_code: 'PERMISSION_DENIED', message: 'Для свода по Службе нужен доступ к корню организации.', details: {} } }));
    await page.goto(`${APP}/security-ops/service-summary/`);
    await expect(page.getByText('Для свода по Службе нужен доступ к корню организации.', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Свод по Службе', exact: true })).toHaveCount(0);
    expect(reads).toEqual([]);
  });
  test('scope revocation removes a previously admitted summary', async ({ page }) => {
    await setup(page);
    let denied = false;
    await page.route('**/api/operations/service-summary-context/**', route => route.fulfill(denied
      ? { status: 403, json: { error_code: 'PERMISSION_DENIED', message: 'Scope revoked', details: {} } }
      : { json: { root_division_id: 1, root_name: 'Служба' } }));
    await page.goto(`${APP}/security-ops/service-summary/`);
    const summary = page.getByRole('region', { name: 'Свод по Службе', exact: true });
    await expect(summary).toBeVisible();
    denied = true;
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('alert').filter({ hasText: 'Для свода по Службе нужен доступ к корню организации.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Свод по Службе', exact: true, includeHidden: true })).toHaveCount(0);
  });
  test('failed context revalidation hides cached summary until retry succeeds', async ({ page }) => {
    await setup(page);
    let fail = false;
    await page.route('**/api/operations/service-summary-context/**', route => route.fulfill(fail
      ? { status: 503, json: { detail: 'Fixture refresh unavailable' } }
      : { json: { root_division_id: 1, root_name: 'Служба' } }));
    await page.goto(`${APP}/security-ops/service-summary/`);
    const summary = page.getByRole('region', { name: 'Свод по Службе', exact: true });
    await expect(summary).toBeVisible();
    const retainedSummary = await summary.elementHandle();
    await summary.locator('button[aria-haspopup="dialog"]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    fail = true;
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const error = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить область свода по Службе.' });
    await expect(error).toBeVisible();
    await expect(summary).not.toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    fail = false;
    await error.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(summary).toBeVisible();
    expect(await retainedSummary!.evaluate(element => element.isConnected)).toBe(true);
  });
});
