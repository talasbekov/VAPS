import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
async function openDashboard(page: Page) {
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto(APP + '/dashboard/', { waitUntil: 'domcontentloaded' });
}
const person = (id: number, name: string, photo: string | null = null) => ({
  id, full_name: name, photo_url: photo, rank: null, position: 'Инспектор',
  division: { id: 1, name: 'Выбранное подразделение' }, current_status: { name: 'В строю' },
});

test.describe('people alongside organization tree', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated portal; employee responses are browser-only fixtures');

  test('selection shows portraits, search, pagination and scoped profile links', async ({ page }) => {
    await page.route('**/media/tree-preview.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="teal"/></svg>' }));
    await page.route('**/media/tree-broken.jpg', route => route.fulfill({ status: 404 }));
    await page.route('**/api/core/service-employees/?*', route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('division_id')).toMatch(/^\d+$/);
      expect(query.get('page_size')).toBe('8');
      const results = query.has('search') ? [] : query.get('page') === '2' ? [person(9004, 'Следующая Страница')] : [
        person(9001, 'Фото Сотрудник', '/media/tree-preview.svg'), person(9002, 'Без Фото'), person(9003, 'Ошибка Фото', '/media/tree-broken.jpg'),
      ];
      return route.fulfill({ json: { count: query.has('search') ? 0 : 4, next: query.get('page') === '1' && !query.has('search') ? '?page=2' : null, previous: query.get('page') === '2' ? '?page=1' : null, results } });
    });
    await openDashboard(page);
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    await scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').first().click();
    const directory = scene.getByRole('link', { name: 'Сотрудники подразделения →', exact: true });
    const division = new URL((await directory.getAttribute('href'))!, APP).searchParams.get('division_id');
    await scene.getByRole('link', { name: 'Смотреть людей ↓' }).click();
    const panel = page.getByTestId('org-division-employees');
    await expect(panel.getByTestId('org-employee-card')).toHaveCount(3);
    const photo = panel.getByRole('img', { name: 'Фото: Фото Сотрудник' });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(panel.getByTestId('employee-initials')).toHaveCount(2);
    const href = new URL((await panel.getByRole('link', { name: 'Фото Сотрудник', exact: true }).getAttribute('href'))!, APP);
    expect(new URLSearchParams(href.searchParams.get('filters')!).get('division_id')).toBe(division);
    await panel.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(panel.getByRole('link', { name: 'Следующая Страница', exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Фото Сотрудник', exact: true })).toHaveCount(0);
    await panel.getByRole('textbox', { name: 'Поиск сотрудников' }).fill('никого');
    await panel.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(panel).toContainText('По этому запросу сотрудники не найдены');
    await expect(panel).toContainText('Страница 1');
  });

  test('late previous-unit response cannot replace current people', async ({ page }) => {
    let firstDivision: string | null = null;
    let release: () => void = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/core/service-employees/?*', async route => {
      const division = new URL(route.request().url()).searchParams.get('division_id')!;
      firstDivision ??= division;
      if (division === firstDivision) await blocked;
      await route.fulfill({ json: { count: 1, next: null, previous: null, results: [person(Number(division), `Сотрудник отдела ${division}`)] } });
    });
    await openDashboard(page);
    const units = page.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button');
    await units.first().click();
    await expect.poll(() => firstDivision).not.toBeNull();
    await units.nth(1).click();
    const panel = page.getByTestId('org-division-employees');
    await expect(panel.getByTestId('org-employee-card')).toHaveCount(1);
    await expect(panel).not.toContainText(`Сотрудник отдела ${firstDivision}`);
    const currentName = await panel.getByTestId('org-employee-card').textContent();
    const oldResponse = page.waitForResponse(response => response.url().includes(`/api/core/service-employees/?division_id=${firstDivision}&`));
    release();
    await oldResponse;
    await expect(panel.getByTestId('org-employee-card')).toHaveText(currentName!);
  });

  test('without personnel permission selection makes no people request', async ({ page }) => {
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['orgstructure.view'], roles: [] } }));
    let requests = 0;
    page.on('request', request => { if (request.url().includes('/api/core/service-employees/')) requests++; });
    await openDashboard(page);
    await page.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').first().click();
    await expect(page.getByText('Штатных единиц', { exact: true })).toBeVisible();
    await expect(page.getByTestId('org-division-employees')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Смотреть людей ↓' })).toHaveCount(0);
    expect(requests).toBe(0);
  });

  test('failed people request offers retry without losing the selected unit', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/core/service-employees/?*', route => {
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 503, json: { detail: 'Temporarily unavailable' } })
        : route.fulfill({ json: { count: 1, next: null, previous: null, results: [person(9005, 'После Повтора')] } });
    });
    await openDashboard(page);
    await page.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').first().click();
    const panel = page.getByTestId('org-division-employees');
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByTestId('org-employee-card')).toHaveCount(0);
    await panel.getByRole('button', { name: /Повторить/ }).click();
    await expect(panel.getByRole('link', { name: 'После Повтора', exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  });
});
