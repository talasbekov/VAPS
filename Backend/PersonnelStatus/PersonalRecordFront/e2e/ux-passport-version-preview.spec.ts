import { test, expect, signIn } from './ux-fixture';
import type { Page, Route } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

const back = 'ownership=OWN&search=UX';
const target = '/security-ops/objects/1?tab=posts&back=' + encodeURIComponent(back);
const previewTitle = 'Объект сверки · версия 1';

async function prepare(page: Page) {
  await page.clock.install();
  const object: SecurityObject = {
    id: '1', name: 'Объект сверки', code: 'UX-PEEK', type: 'Здание', region: 'Астана', address: 'Адрес проверки',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [{ id: 's1', name: 'Сектор текущий', posts: [{ id: 'p1', name: 'Пост текущий', task: 'Задача текущая', requirements: 'Требования текущие' }] }],
    passportVersions: [{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-09-12', note: 'Примечание снимка', publishedAt: '2026-09-12T10:00:00Z', publishedBy: 'UX',
      sectors: [{ id: 'old-s1', name: 'Сектор архивный', posts: [{ id: 'old-p1', name: 'Пост архивный', task: 'Задача архивная', requirements: 'Требования архивные' }] }] }],
    createdAt: '2026-09-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
  };
  const state = { object, reads: 0, failedReads: 0, fail: 0, permissions: ['object.view', 'object.manage'] };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: state.permissions, global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/objects/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ops/objects/1/') {
      state.reads++;
      if (state.fail) { state.failedReads++; return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа во время сверки' } }); }
      return route.fulfill({ json: state.object });
    }
    if (path === '/api/ops/objects/') return route.fulfill({ json: { results: [state.object], freshness: [], unavailableKpi: [], kpi: { total: 1 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
    return route.fallback();
  });
  await signIn(page); await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Мой черновик сектора');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Мой черновик публикации');
  return state;
}

async function open(page: Page) {
  await page.getByRole('link', { name: 'Версия 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: previewTitle, exact: true })).toBeVisible();
}

async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('checking a published version and returning preserves both unsaved passport drafts', async ({ page, businessWrites }) => {
  await prepare(page); await open(page);
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  else await page.getByRole('link', { name: '← Назад к истории паспорта', exact: true }).click();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('2026-10-14');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Мой черновик публикации');
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой черновик сектора');
  expect(new URL(page.url()).searchParams.get('back')).toBe(back); expect(businessWrites).toEqual([]);
});

test('version preview reads its own snapshot and closes with focus without changing the history URL', async ({ page, businessWrites }) => {
  const state = await prepare(page); const address = page.url(), reads = state.reads; await open(page);
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Задача архивная', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Задача текущая', { exact: false })).toHaveCount(0);
  await expect(dialog.locator('input, textarea')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Сохранить|Опубликовать/ })).toHaveCount(0);
  expect(page.url()).toBe(address);
  expect(state.reads).toBe(reads);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Версия 1', exact: true })).toBeFocused();
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Мой черновик публикации');
  expect(businessWrites).toEqual([]);
});

test('the preview keeps a full encoded version link available in a new tab', async ({ page, businessWrites }) => {
  await prepare(page);
  const original = await page.getByRole('link', { name: 'Версия 1', exact: true }).getAttribute('href');
  await open(page);
  const link = page.getByRole('dialog').getByRole('link', { name: 'Открыть в новой вкладке', exact: true });
  await expect(link).toHaveAttribute('href', original!); await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(new URL(original!, page.url()).searchParams.get('back')).toBe(back); expect(businessWrites).toEqual([]);
});

test('a temporary read failure retries inside the preview and retains both drafts', async ({ page, businessWrites }) => {
  const state = await prepare(page); await open(page);
  state.fail = 503; await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Не удалось загрузить опубликованную версию паспорта.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Задача архивная', { exact: false })).toBeVisible();
  state.fail = 0;
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByText('Не удалось загрузить опубликованную версию паспорта.', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Мой черновик публикации');
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой черновик сектора');
  expect(businessWrites).toEqual([]);
});

test('a confirmed object denial closes the preview and removes the former passport fields', async ({ page, businessWrites }) => {
  const state = await prepare(page); await open(page);
  state.fail = 403; await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Задача архивная', { exact: false })).toHaveCount(0);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('revoking viewing permission closes an open preview without a hidden cached snapshot', async ({ page, businessWrites }) => {
  const state = await prepare(page); await open(page);
  state.permissions = []; await reconnect(page);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Задача архивная', { exact: false })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a withdrawn version closes the preview and its later return does not reopen it', async ({ page, businessWrites }) => {
  const state = await prepare(page), versions = state.object.passportVersions; await open(page);
  state.object = { ...state.object, name: 'Объект без прежней версии', passportVersions: [] };
  await reconnect(page);
  await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Мой черновик публикации');
  state.object = { ...state.object, name: 'Объект после возврата версии', passportVersions: versions };
  await reconnect(page);
  await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Версия 1', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('changing the active passport tab closes the portalled preview and focuses that tab', async ({ page, businessWrites }) => {
  await prepare(page); await open(page);
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('tab', 'posts'); history.pushState(null, '', url); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const tab = page.getByRole('tab', { name: 'Посты и секторы', exact: true });
  await expect(tab).toHaveAttribute('aria-selected', 'true'); await expect(tab).toBeFocused();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой черновик сектора');
  expect(businessWrites).toEqual([]);
});

test('a narrow preview opens at its heading and keeps the snapshot within the viewport', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await prepare(page); await open(page);
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeFocused();
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBe(0);
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect(); return bounds.x >= 0 && bounds.right <= innerWidth && bounds.y >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  expect(businessWrites).toEqual([]);
});

test('a modified version click opens the full snapshot in a separate guarded tab', async ({ page, businessWrites }) => {
  const state = await prepare(page), address = page.url();
  const popupWrites: string[] = [], popupErrors: string[] = [], external: string[] = [];
  const appPort = new URL(address).port;
  const handler = async (route: Route) => {
    const request = route.request(), url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || ![appPort, '18345', '3345', '18348'].includes(url.port)) { external.push(url.origin + url.pathname); return route.abort(); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !url.pathname.startsWith('/api/auth/')) { popupWrites.push(request.method() + ' ' + url.pathname); return route.abort(); }
    if (request.method() === 'GET' && url.pathname === '/api/operations/my-permissions/') return route.fulfill({ json: { permissions: state.permissions, global_permissions: [], roles: [] } });
    if (request.method() === 'GET' && url.pathname === '/api/ops/objects/1/') return route.fulfill({ json: state.object });
    return route.fallback();
  };
  await page.context().route('**/*', handler);
  let popup: Page | undefined;
  try {
    [popup] = await Promise.all([page.context().waitForEvent('page', { predicate: opened => opened !== page }), page.getByRole('link', { name: 'Версия 1', exact: true }).click({ modifiers: ['Control'] })]);
    popup.on('pageerror', error => popupErrors.push(error.message));
    await expect(popup.getByRole('heading', { name: previewTitle, exact: true })).toBeVisible();
    await expect(popup.getByText('Задача архивная', { exact: false })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(page.url()).toBe(address);
    await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Мой черновик публикации');
    expect(new URL(popup.url()).searchParams.get('back')).toBe(back);
    expect(popupErrors).toEqual([]); expect(popupWrites).toEqual([]); expect(external).toEqual([]); expect(businessWrites).toEqual([]);
  } finally {
    if (popup) await popup.close();
    await page.context().unroute('**/*', handler);
  }
});
