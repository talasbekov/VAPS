import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
async function authenticate(page: Page) {
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
}

test.describe('permission-driven portal start', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated portal; only permission responses are browser fixtures');

  test('head breadcrumb brand opens allowed statuses instead of command center', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: [], status_manage_division_ids: [3], roles: [{ code: 'DIRECTORATE_HEAD', name: 'Начальник управления', scope_division_id: 3, scope_division_name: 'Первое управление' }],
    } }));
    await authenticate(page);
    await page.goto(APP + '/statuses/?businessDate=2026-10-20');
    const trail = page.getByRole('navigation', { name: 'Хлебные крошки', exact: true });
    await expect(trail.locator('[aria-current="page"]')).toHaveText('Управление статусами');
    await expect(trail.getByRole('link', { name: 'Smart Жоспарлау', exact: true })).toHaveAttribute('href', '/statuses/');
    await trail.getByRole('link', { name: 'Smart Жоспарлау', exact: true }).click();
    await expect(page).toHaveURL(/\/statuses\/$/);
  });

  test('expense breadcrumbs follow daily and forces views consistently with the screen heading', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['status.view', 'forces.allocate'], global_permissions: [], roles: [{ code: 'DEPARTMENT_EXPENSE_OFFICER', name: 'Ответственный за расход', scope_division_id: 2, scope_division_name: 'Первый департамент' }],
    } }));
    await authenticate(page);
    for (const [view, title] of [['department-summary', 'Ежедневный расход'], ['forces', 'Сбор сил на ОМ']]) {
      await page.goto(`${APP}/employees/?view=${view}&businessDate=2026-10-20`);
      const trail = page.getByRole('navigation', { name: 'Хлебные крошки', exact: true });
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      await expect(trail.locator('[aria-current="page"]')).toHaveText(title);
      await expect(trail.getByRole('link', { name: 'Smart Жоспарлау', exact: true })).toHaveAttribute('href', '/employees/');
    }
  });

  test('authenticated user without work permissions reaches profile', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: [], global_permissions: [], roles: [],
    } }));
    await authenticate(page);
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/security-ops\/profile\/?$/);
    await expect(page.getByRole('heading', { name: 'Мой профиль', exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Основная навигация', exact: true });
    await expect(navigation.getByRole('link', { name: 'Статусы сотрудников', exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Сбор сил на ОМ', exact: true })).toHaveCount(0);
  });

  test('pending and failed permissions keep login start in place, retry opens allowed work', async ({ page }) => {
    let release: () => void = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let recover = false;
    let attempts = 0;
    await page.route('**/api/operations/my-permissions/**', async route => {
      attempts++;
      await blocked;
      await route.fulfill(recover
        ? { json: { permissions: ['object.view'], global_permissions: [], roles: [] } }
        : { status: 503, json: { error_code: 'UNAVAILABLE', message: 'Browser fixture: permissions unavailable' } });
    });
    await authenticate(page);
    const visitedPaths: string[] = [];
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) visitedPaths.push(new URL(frame.url()).pathname);
    });
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => attempts).toBeGreaterThan(0);
    try {
      await expect(page.getByText('Открываем рабочее пространство…', { exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/');
    } finally {
      release();
    }
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить доступные разделы' })).toBeVisible({ timeout: 20000 });
    expect(new URL(page.url()).pathname).toBe('/');
    expect(visitedPaths.every(path => path === '/')).toBeTruthy();
    recover = true;
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page).toHaveURL(/\/security-ops\/objects\/?$/);
  });

  test('relative and same-origin absolute callback retain path, query and hash', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['status.view', 'object.view'], global_permissions: [], roles: [],
    } }));
    await authenticate(page);
    const target = '/security-ops/objects/?search=callback-proof#list';
    for (const callback of [target, new URL(target, APP).href]) {
      await page.goto(`${APP}/?callbackUrl=${encodeURIComponent(callback)}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new URL(target, APP).href);
    }
  });
});
