import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
test('late employee filter options preserve a typed search and restore linked filters', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend, read-only fixtures');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.continue());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route(url => url.pathname === '/api/core/service-employees/', route => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
  await page.route('**/api/core/service-employees/options/**', async route => {
    await gate;
    await route.fulfill({ json: { divisions: [{ id: 91, name: 'Управление проверки фильтра', parent_id: null, level: 0 }], statuses: [{ code: 'VACATION', name: 'Отпуск' }] } });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  try {
    await page.goto(`${APP}/service-employees/?division_id=91&status=VACATION&search=old`, { waitUntil: 'domcontentloaded' });
    const search = page.getByLabel('Поиск по ФИО, табельному номеру или позывному', { exact: true });
    await search.fill('Новый введённый поиск');
    release();
    const division = page.getByLabel('Подразделение и подчинённые', { exact: true });
    await expect(division.locator('option[value="91"]')).toHaveCount(1);
    await expect(search).toHaveValue('Новый введённый поиск');
    await expect(division).toHaveValue('91');
    await expect(page.getByLabel('Текущий статус', { exact: true })).toHaveValue('VACATION');
    await page.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('Новый введённый поиск');
    expect(new URL(page.url()).searchParams.get('division_id')).toBe('91');
    expect(new URL(page.url()).searchParams.get('status')).toBe('VACATION');
  } finally { release(); }
});
