import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

const back = 'ownership=OWN&search=UX';
const target = '/security-ops/objects/1/passports/v1?back=' + encodeURIComponent(back);

async function prepare(page: Page, options: { held?: boolean; denied?: boolean; fail?: number } = {}) {
  const archiveSectors = [{ id: 'archive-s1', name: 'Сектор опубликованного снимка', posts: [{ id: 'archive-p1', name: 'Пост опубликованного снимка', task: 'Задача опубликованного снимка', requirements: 'Архивные требования' }] }];
  const object: SecurityObject = {
    id: '1', name: 'Объект опубликованной версии', code: 'UX-VERSION', type: 'Здание', region: 'Астана', address: 'Адрес проверки',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [{ id: 's1', name: 'Сектор действующей редакции', posts: [{ id: 'p1', name: 'Пост действующей редакции', task: 'Текущая задача', requirements: 'Текущие требования' }] }],
    passportVersions: [{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-09-12', note: 'Опубликованное примечание', publishedAt: '2026-09-12T10:00:00Z', publishedBy: 'UX', sectors: archiveSectors }],
    createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
  };
  const state = { object, reads: 0, permissionsReads: 0, failedReads: 0, fail: options.fail ?? 0, release: () => {} };
  const permissions = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', async route => {
    state.permissionsReads++;
    if (options.held) await permissions;
    return route.fulfill({ json: { permissions: options.denied ? [] : ['object.view'], global_permissions: [], roles: [] } });
  });
  await page.route('**/api/ops/objects/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ops/objects/1/') {
      state.reads++;
      if (state.fail) { state.failedReads++; return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа чтения версии' } }); }
      return route.fulfill({ json: state.object });
    }
    if (path === '/api/ops/objects/') return route.fulfill({ json: { results: [state.object], freshness: [], unavailableKpi: [], kpi: { total: 1 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
    return route.fallback();
  });
  await signIn(page); return state;
}

async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('a version deep link waits for confirmed viewing permission', async ({ page, businessWrites }) => {
  const state = await prepare(page, { held: true });
  try {
    await page.goto(target);
    await expect.poll(() => state.permissionsReads).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    expect(state.reads).toBe(0);
    await expect(page.getByText('Задача опубликованного снимка', { exact: false })).toHaveCount(0);
  } finally { state.release(); }
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('denied viewing permission never loads a published version object', async ({ page, businessWrites }) => {
  const state = await prepare(page, { denied: true });
  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  expect(state.reads).toBe(0); expect(businessWrites).toEqual([]);
});

test('a failed initial version read retries in place and returns to its filtered history', async ({ page, businessWrites }) => {
  const state = await prepare(page, { fail: 503 });
  await page.goto(target);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText(/Объект не найден или недоступен|Не удалось загрузить опубликованную версию паспорта/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  const href = await page.getByRole('link', { name: '← Назад к истории паспорта', exact: true }).getAttribute('href');
  const destination = new URL(href!, page.url());
  expect(destination.pathname.replace(/\/$/, '')).toBe('/security-ops/objects/1'); expect(destination.searchParams.get('tab')).toBe('history'); expect(destination.searchParams.get('back')).toBe(back);
  expect(businessWrites).toEqual([]);
});

test('the explicit version address and back preserve the registry filter and selected history tab', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/security-ops/objects/1?tab=history&back=' + encodeURIComponent(back));
  const address = await page.getByRole('link', { name: 'Версия 1', exact: true }).getAttribute('href');
  await page.goto(address!);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('back')).toBe(back);
  await page.getByRole('link', { name: '← Назад к истории паспорта', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'История', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).searchParams.get('back')).toBe(back);
  expect(businessWrites).toEqual([]);
});

test('the published snapshot remains read-only and never substitutes the current sectors', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  await expect(page.getByText('Только просмотр', { exact: true })).toBeVisible();
  await expect(page.getByText('Задача опубликованного снимка', { exact: false })).toBeVisible();
  await expect(page.getByText('Текущая задача', { exact: false })).toHaveCount(0);
  await expect(page.locator('main input, main textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Сохранить|Опубликовать/ })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a confirmed missing version does not fall back to the active passport', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto(target.replace('/v1?', '/missing?'));
  await expect(page.getByText('Версия паспорта не найдена — возможно, ссылка ведёт на другой объект.', { exact: true })).toBeVisible();
  await expect(page.getByText('Текущая задача', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a mismatched object cannot expose an archived version for a different route', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.object = { ...state.object, id: '2' };
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/objects/1/' && response.status() === 200);
  await page.goto(target);
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toHaveCount(0);
  state.object = { ...state.object, id: '1' };
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a temporary version refresh keeps the published snapshot and retries without losing the address', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  state.fail = 503;
  await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText(/Объект не найден или недоступен|Не удалось загрузить опубликованную версию паспорта/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить опубликованную версию паспорта.')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('back')).toBe(back);
  expect(businessWrites).toEqual([]);
});

for (const status of [401, 403, 404]) test(`a version HTTP ${status} closes cached snapshot fields and allows a fresh read`, async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  state.fail = status;
  await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toHaveCount(0);
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a missing cached version with a failed refresh stays unconfirmed until a fresh read succeeds', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target.replace('/v1?', '/missing?'));
  const missing = page.getByText('Версия паспорта не найдена — возможно, ссылка ведёт на другой объект.', { exact: true });
  await expect(missing).toBeVisible();
  state.fail = 503;
  await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText('Не удалось загрузить опубликованную версию паспорта.', { exact: true })).toBeVisible();
  await expect(missing).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toHaveCount(0);
  state.fail = 0;
  state.object = { ...state.object, passportVersions: state.object.passportVersions.map(version => ({ ...version, id: 'missing', versionNumber: 2 })) };
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сектор опубликованного снимка', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Объект опубликованной версии · версия 2', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});
