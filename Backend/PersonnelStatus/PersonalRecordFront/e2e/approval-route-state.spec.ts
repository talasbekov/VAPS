import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
const initial = [
  { id: 1, roleLabel: 'Первый подписант', unit: 'Отдел', username: '', fullName: '' },
  { id: 2, roleLabel: 'Второй подписант', unit: '', username: '', fullName: '' },
];
const cardFor = (page: Page) => page.locator('[data-slot="approval-route-card"]');
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function prepare(page: Page) {
  // All settings writes are browser fixtures. Never mutate the stand.
  await page.route('**/api/**', route => {
    const req = route.request();
    return !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !new URL(req.url()).pathname.startsWith('/api/auth/')
      ? route.abort('blockedbyclient') : route.continue();
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['*'], global_permissions: ['*'], roles: [], status_manage_division_ids: null,
  } }));
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect((await login.json()).url).not.toContain('error=');
}

test.describe('approval route draft safeguards', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated frontend; settings writes are mocked');

  test('initial read must finish before editing the stored route', async ({ page }) => {
    await prepare(page);
    const read = gate();
    await page.route('**/api/ops/approval-route/**', async route => {
      await read.promise;
      await route.fulfill({ json: { results: initial } });
    });
    try {
      await page.goto(`${APP}/security-ops/settings/`, { waitUntil: 'domcontentloaded' });
      const card = cardFor(page);
      await expect(card.getByText('Загрузка маршрута…')).toBeVisible();
      await expect(card.getByRole('button', { name: '+ Добавить подписанта' })).toBeDisabled();
      await expect(card.getByRole('button', { name: 'Сохранить маршрут' })).toBeDisabled();
      read.release();
      await expect(card.getByLabel('Роль подписанта 1')).toHaveValue(initial[0].roleLabel);
      await expect(card.getByRole('button', { name: '+ Добавить подписанта' })).toBeEnabled();
    } finally { read.release(); }
  });

  test('failed route read has a retry and never masquerades as an empty editable route', async ({ page }) => {
    await prepare(page);
    let failed = true;
    await page.route('**/api/ops/approval-route/**', route => failed
      ? route.fulfill({ status: 503, json: { detail: 'Fixture unavailable' } })
      : route.fulfill({ json: { results: initial } }));
    await page.goto(`${APP}/security-ops/settings/`, { waitUntil: 'domcontentloaded' });
    const card = cardFor(page);
    await expect(card.getByRole('alert')).toContainText('Маршрут сейчас недоступен', { timeout: 25_000 });
    await expect(card.getByRole('button', { name: '+ Добавить подписанта' })).toBeDisabled();
    await expect(card.locator('[data-slot="approval-route-none"]')).toHaveCount(0);
    failed = false;
    await card.getByRole('button', { name: 'Повторить загрузку' }).click();
    await expect(card.getByLabel('Роль подписанта 1')).toHaveValue(initial[0].roleLabel);
    await expect(card.getByRole('button', { name: '+ Добавить подписанта' })).toBeEnabled();
  });

  test('pending save locks every draft control; failure preserves draft and empty route can be saved', async ({ page }) => {
    await prepare(page);
    const write = gate();
    let results = initial.map(row => ({ ...row }));
    const payloads: { steps: typeof initial }[] = [];
    await page.route('**/api/ops/approval-route/**', async route => {
      if (route.request().method() === 'PUT') {
        payloads.push(route.request().postDataJSON());
        if (payloads.length === 1) {
          await write.promise;
          await route.fulfill({ status: 503, json: { detail: 'Fixture unavailable' } });
          return;
        }
        results = payloads.at(-1)!.steps.map((row, i) => ({ ...row, id: i + 1 }));
      }
      await route.fulfill({ json: { results } });
    });
    try {
      await page.goto(`${APP}/security-ops/settings/`, { waitUntil: 'domcontentloaded' });
      const card = cardFor(page);
      await card.getByLabel('Роль подписанта 1').fill('Изменённый подписант');
      await card.getByRole('button', { name: 'Сохранить маршрут' }).click();
      await expect.poll(() => payloads.length).toBe(1);
      for (const label of ['Роль подписанта 1', 'Подразделение подписанта 1', 'Учётка подписанта 1']) {
        await expect(card.getByLabel(label, { exact: true })).toBeDisabled();
      }
      for (const name of ['+ Добавить подписанта', 'Ниже: шаг 1', 'Выше: шаг 2', 'Снять шаг 1', 'Сохраняем…']) {
        await expect(card.getByRole('button', { name, exact: true })).toBeDisabled();
      }
      await expect(card.getByText('Маршрут сохранён.')).toHaveCount(0);
      write.release();
      await expect(card.getByRole('button', { name: 'Сохранить маршрут' })).toBeEnabled();
      await expect(card.getByRole('alert')).toContainText('Изменения остаются в форме');
      await expect(card.getByLabel('Роль подписанта 1')).toHaveValue('Изменённый подписант');
      await expect(card.getByText('Маршрут сохранён.')).toHaveCount(0);
      await card.getByRole('button', { name: 'Снять шаг 2', exact: true }).click();
      await card.getByRole('button', { name: 'Снять шаг 1', exact: true }).click();
      await card.getByRole('button', { name: 'Сохранить маршрут' }).click();
      await expect(card.getByText('Маршрут сохранён.')).toBeVisible();
      expect(payloads[1].steps).toEqual([]);
      await expect(card.locator('[data-slot="approval-route-none"]')).toBeVisible();
      await expect(card.getByRole('button', { name: 'Сохранить маршрут' })).toBeDisabled();
    } finally { write.release(); }
  });
});
