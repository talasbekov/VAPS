import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

const root = '/security-ops/objects/';
const first: SecurityObject = {
  id: '1', code: 'UX-ONE', name: 'Объект учебного каталога', type: 'Здание', region: 'Астана', address: 'Учебный адрес',
  ownership: 'OWN', objectState: 'ACTIVE', passportState: 'GREEN', hasSecurityEvents: false, photoUrl: null,
  sectors: [], passportVersions: [], createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z',
};

async function prepare(page: Page, options: { empty?: boolean; fail?: number; hold?: boolean } = {}) {
  const state = { rows: options.empty ? [] : [first], fail: options.fail ?? 0, reads: 0, release: () => {} };
  const held = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({
    json: { permissions: ['object.view', 'object.manage'], global_permissions: [], roles: [] },
  }));
  await page.route('**/api/ops/objects/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === '/api/ops/objects/1/') return route.fulfill({ json: first });
    if (pathname !== '/api/ops/objects/') return route.fallback();
    state.reads++;
    if (options.hold) await held;
    if (state.fail) return route.fulfill({ status: state.fail, json: { detail: 'Проверка чтения реестра' } });
    return route.fulfill({ json: {
      results: state.rows, unavailableKpi: [],
      kpi: { total: state.rows.length, passportGreen: state.rows.length, passportYellow: 0,
        passportRed: 0, verificationOverdue: 0, neverPublished: state.rows.length },
      freshness: state.rows.map(row => ({ objectId: row.id, state: 'NO_PUBLISHED_VERSION', verificationDueAt: null, freshnessPolicyVersion: 'ux' })),
      freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 },
    } });
  });
  await signIn(page);
  return state;
}

test('an empty catalogue has one clear state without zero panels or search tools', async ({ page }) => {
  await prepare(page, { empty: true });
  await page.goto(root);
  await expect(page.getByText('Объектов пока нет', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Раздел реестра', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Показатели реестра', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /0 из 0/ })).toHaveCount(0);
});

test('an empty catalogue with a saved selection can clear it and preserve table view', async ({ page }) => {
  await prepare(page, { empty: true });
  await page.goto(root + '?search=Учебный&tab=own&region=Астана&view=table');
  await expect(page.getByText('Объектов пока нет', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toHaveValue('Учебный');
  await expect(page.getByRole('button', { name: 'Показать все объекты', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать все объекты', exact: true }).click();
  await expect(page).toHaveURL(/objects\/\?view=table$/);
  await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toHaveCount(0);
});

test('additional filters and metrics stay out of the initial working list', async ({ page }) => {
  await prepare(page);
  await page.goto(root);
  await expect(page.getByText(first.name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Статус', exact: true })).toBeHidden();
  await expect(page.getByLabel('Показатели реестра', { exact: true })).toBeHidden();
  await page.locator('main summary').filter({ hasText: 'Фильтры' }).click();
  await expect(page.getByRole('combobox', { name: 'Статус', exact: true })).toBeVisible();
  await page.locator('main summary').filter({ hasText: 'Сводка по объектам' }).click();
  await expect(page.getByLabel('Показатели реестра', { exact: true })).toBeVisible();
});

test('a filtered empty selection has one reset action that returns all objects', async ({ page }) => {
  await prepare(page);
  await page.goto(root + '?search=нет-совпадений&tab=guarded&status=ARCHIVED&view=table');
  await expect(page.getByText('Объекты не найдены', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сбросить фильтры/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать все объекты', exact: true }).click();
  await expect(page).toHaveURL(/objects\/\?view=table$/);
  await expect(page.getByRole('link', { name: 'Открыть объект ' + first.name, exact: true })).toBeVisible();
});

test('opening and closing filters preserves the chosen region and URL', async ({ page }) => {
  await prepare(page);
  await page.goto(root + '?region=Астана&view=table');
  const toggle = page.locator('main summary').filter({ hasText: 'Фильтры' });
  await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Регион', exact: true })).toContainText('Астана');
  const url = page.url();
  await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Регион', exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Регион', exact: true })).toContainText('Астана');
  expect(page.url()).toBe(url);
});

test('show all cancels a pending search instead of restoring it after reset', async ({ page }) => {
  await prepare(page);
  await page.goto(root + '?tab=guarded&view=table');
  await expect(page.getByText('Объекты не найдены', { exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  const search = page.getByLabel('Поиск по реестру объектов', { exact: true });
  await search.fill('нет-совпадений');
  await page.getByRole('button', { name: 'Показать все объекты', exact: true }).click();
  await expect(page).toHaveURL(/objects\/\?view=table$/);
  await page.clock.fastForward(1000);
  await expect(page).toHaveURL(/objects\/\?view=table$/);
  await expect(search).toHaveValue('');
  await expect(page.getByRole('link', { name: 'Открыть объект ' + first.name, exact: true })).toBeVisible();
});

for (const parameter of ['freshness', 'tab', 'view']) {
  test(`inherited URL key in ${parameter} cannot break the registry`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page);
    await page.goto(root + `?${parameter}=__proto__`);
    if (parameter === 'freshness') {
      await expect(page.getByText('Объекты не найдены', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Показать все объекты', exact: true }).click();
    }
    await expect(page.getByText(first.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Карточки', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
}

test('503 retries preserve all selection parameters and issue only a read', async ({ page, businessWrites }) => {
  const state = await prepare(page, { fail: 503 });
  await page.goto(root + '?search=учебного&tab=own&status=ACTIVE&passport=GREEN&region=Астана&freshness=NO_PUBLISHED_VERSION&view=table');
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить реестр объектов' })).toBeVisible();
  const url = page.url(), reads = state.reads;
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Открыть объект ' + first.name, exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  expect(state.reads).toBeGreaterThan(reads);
  expect(businessWrites).toEqual([]);
});

test('a confirmed 403 shows an access decision without offering an ineffective retry', async ({ page }) => {
  await prepare(page, { fail: 403 });
  await page.goto(root);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toHaveCount(0);
});

test('403 after a successful read hides the old objects and metrics', async ({ page }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(root);
  await expect(page.getByText(first.name, { exact: true })).toBeVisible();
  state.fail = 403;
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  await expect(page.getByText(first.name, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Показатели реестра', { exact: true })).toHaveCount(0);
});

test('loading catalogue does not display premature search or zero results', async ({ page }) => {
  const state = await prepare(page, { hold: true });
  try {
    await page.goto(root);
    await expect(page.getByText('Загрузка реестра объектов…', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Поиск по реестру объектов', { exact: true })).toHaveCount(0);
  } finally { state.release(); }
  await expect(page.getByText(first.name, { exact: true })).toBeVisible();
});

test('object passport returns to the same search, category, region and table view', async ({ page }) => {
  await prepare(page);
  await page.goto(root + '?search=учебного&tab=own&region=Астана&view=table');
  const url = page.url();
  await page.getByRole('link', { name: 'Открыть объект ' + first.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Назад к реестру', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Открыть объект ' + first.name, exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
});

for (const width of [320, 390, 1440]) test(`metric labels and search fit the page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await prepare(page);
  await page.goto(root);
  await page.locator('main summary').filter({ hasText: 'Сводка по объектам' }).click();
  const metrics = page.getByLabel('Показатели реестра', { exact: true });
  for (const text of ['Требуют актуализации', 'Проверка просрочена', 'Паспорт не публиковался']) {
    const label = metrics.getByText(text, { exact: true });
    await expect(label).toBeVisible();
    expect(await label.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await metrics.getByRole('button', { name: /Паспорт не публиковался/ }).click();
  await expect(page).toHaveURL(/freshness=NO_PUBLISHED_VERSION/);
  await expect(page.getByText(first.name, { exact: true })).toBeVisible();
});
