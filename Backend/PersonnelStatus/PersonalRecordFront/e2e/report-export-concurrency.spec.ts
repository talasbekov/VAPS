import { expect, test, type Route } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';

test('parallel report exports keep independent pending states and allow retry after failure', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend with read-only fixtures');
  const pending = new Map<string, Route>();
  const reads: string[] = [];
  await page.route('**/api/**', route => {
    const request = route.request();
    return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
      ? route.abort() : route.continue();
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['*'], global_permissions: ['*'], roles: [],
  } }));
  const totals = { staff_total: 2, list_total: 2, vacancies: 0, attached: 0, off_list: 0, columns: {}, event: { total: 0, group: 0, squad: 0 } };
  await page.route(url => url.pathname === '/api/operations/strength-report/', route => route.fulfill({ json: {
    business_date: '2026-10-09', columns: [], column_labels: {}, warnings: [], totals,
    rows: [1, 2].map(id => ({ ...totals, division_id: id, name: `Управление ${id}` })),
  } }));
  await page.route('**/api/operations/strength-report/export/**', route => {
    const id = new URL(route.request().url()).searchParams.get('division_id')!;
    reads.push(id);
    pending.set(id, route);
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
  } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/reports/`);
  await page.getByRole('button', { name: 'Показать расход', exact: true }).click();
  const first = page.getByRole('button', { name: 'Скачать снимок сдачи «Управление 1» на 2026-10-09, XLSX', exact: true });
  const second = page.getByRole('button', { name: 'Скачать снимок сдачи «Управление 2» на 2026-10-09, XLSX', exact: true });
  await first.click();
  await expect.poll(() => reads).toEqual(['1']);
  await second.click();
  await expect.poll(() => reads).toEqual(['1', '2']);
  await expect(first).toBeDisabled();
  await expect(first).toHaveAttribute('aria-busy', 'true');
  await expect(second).toBeDisabled();
  // Native repeated clicks on either disabled row cannot issue another request.
  await first.evaluate(element => (element as HTMLButtonElement).click());
  await second.evaluate(element => (element as HTMLButtonElement).click());
  await pending.get('2')!.fulfill({ status: 503, json: { detail: 'Fixture export unavailable' } });
  await expect(second).toBeEnabled();
  await expect(second).toHaveAttribute('aria-busy', 'false');
  await expect(first).toBeDisabled();
  expect(reads).toEqual(['1', '2']);
  await second.click();
  await expect.poll(() => reads).toEqual(['1', '2', '2']);
  await expect(second).toHaveAttribute('aria-busy', 'true');
  const firstDownload = page.waitForEvent('download');
  await pending.get('1')!.fulfill({ contentType: 'application/octet-stream', body: 'fixture first export' });
  expect((await firstDownload).suggestedFilename()).toContain('Управление 1');
  await expect(first).toBeEnabled();
  await expect(second).toBeDisabled();
  const secondDownload = page.waitForEvent('download');
  await pending.get('2')!.fulfill({ contentType: 'application/octet-stream', body: 'fixture second export' });
  expect((await secondDownload).suggestedFilename()).toContain('Управление 2');
  await expect(second).toBeEnabled();
  await expect(second).toHaveAttribute('aria-busy', 'false');
  expect(reads).toEqual(['1', '2', '2']);
});
