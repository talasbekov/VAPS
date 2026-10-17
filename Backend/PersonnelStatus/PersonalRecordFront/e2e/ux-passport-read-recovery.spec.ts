import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

const target = '/security-ops/objects/1?tab=posts&back=ownership%3DOWN%26search%3DUX';

async function prepare(page: Page, options: { holdPermissions?: boolean; denied?: boolean; fail?: number } = {}) {
  const object: SecurityObject = {
    id: '1', name: 'Объект восстановления паспорта', code: 'UX-READ', type: 'Здание', region: 'Астана', address: 'Адрес проверки',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [{ id: 's1', name: 'Сектор исходный', posts: [{ id: 'p1', name: 'Пост исходный', task: 'Задача исходная', requirements: 'Требования исходные' }] }],
    passportVersions: [], createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
  };
  const state = { object, detailReads: 0, registryReads: 0, permissionReads: 0, failedReads: 0, fail: options.fail ?? 0,
    permissions: options.denied ? [] : ['object.view', 'object.manage'],
    releasePermissions: () => {}, releaseSave: () => {}, releaseDetail: () => {}, holdDetail: false, holdSave: false, writes: [] as Record<string, unknown>[] };
  const permissions = new Promise<void>(resolve => { state.releasePermissions = resolve; });
  const save = new Promise<void>(resolve => { state.releaseSave = resolve; });
  const detail = new Promise<void>(resolve => { state.releaseDetail = resolve; });
  await page.route('**/api/operations/my-permissions/**', async route => {
    state.permissionReads++;
    if (options.holdPermissions) await permissions;
    await route.fulfill({ json: { permissions: state.permissions, global_permissions: [], roles: [] } });
  });
  await page.route('**/api/ops/objects/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/ops/objects/1/') {
      state.detailReads++;
      if (state.holdDetail) await detail;
      if (state.fail) { state.failedReads++; return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа чтения паспорта' } }); }
      return route.fulfill({ json: state.object });
    }
    if (request.method() === 'GET' && path === '/api/ops/objects/') {
      state.registryReads++;
      return route.fulfill({ json: { results: [state.object], freshness: [], unavailableKpi: [], kpi: { total: 1 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
    }
    const isSave = request.method() === 'PATCH' && path === '/api/ops/objects/1/passport/';
    const isPublish = request.method() === 'POST' && path === '/api/ops/objects/1/passport/versions/';
    if (isSave || isPublish) {
      const body = request.postDataJSON(); state.writes.push(body);
      if (state.holdSave) await save;
      return route.fulfill({ json: { ...object, ...(isSave ? { sectors: body.sectors } : {}), updatedAt: '2026-10-12T11:00:00Z' } });
    }
    return route.fallback();
  });
  await signIn(page);
  return state;
}

async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('passport reads wait for confirmed viewing permission', async ({ page, businessWrites }) => {
  const state = await prepare(page, { holdPermissions: true });
  try {
    await page.goto(target);
    await expect.poll(() => state.permissionReads).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    expect(state.detailReads).toBe(0); expect(state.registryReads).toBe(0);
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  } finally { state.releasePermissions(); }
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Сектор исходный');
  expect(businessWrites).toEqual([]);
});

test('denied viewing permission does not load either object resource', async ({ page, businessWrites }) => {
  const state = await prepare(page, { denied: true });
  await page.goto(target);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  expect(state.detailReads).toBe(0); expect(state.registryReads).toBe(0);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('an initial passport read failure retries in place and retains the return filters', async ({ page, businessWrites }) => {
  const state = await prepare(page, { fail: 503 });
  await page.goto(target);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText(/Объект не найден или недоступен|Не удалось загрузить паспорт объекта/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Сектор исходный');
  expect(new URL(page.url()).searchParams.get('back')).toBe('ownership=OWN&search=UX');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a confirmed temporary read failure preserves both passport drafts through retry', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Черновик сектора');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Черновик публикации');
  state.fail = 503;
  await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText(/Объект не найден или недоступен|Не удалось загрузить паспорт объекта/)).toBeVisible();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('2026-10-14');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Черновик публикации');
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить паспорт объекта.')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Черновик сектора');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Черновик публикации');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

for (const status of [401, 403, 404]) test(`a confirmed ${status} hides cached fields and recovery opens a fresh form`, async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Прежний закрытый черновик');
  state.fail = status;
  await reconnect(page);
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toHaveCount(0);
  state.fail = 0;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Сектор исходный');
  expect(businessWrites).toEqual([]);
});

test('a mismatched object response stays hidden and can be read again', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.object = { ...state.object, id: '2' };
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/objects/1/' && response.status() === 200);
  await page.goto(target);
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  state.object = { ...state.object, id: '1' };
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Сектор исходный');
  expect(businessWrites).toEqual([]);
});

test('a cached passport is hidden after a confirmed mismatched object response', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Черновик прежнего объекта');
  state.object = { ...state.object, id: '2' };
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/objects/1/' && response.status() === 200);
  await reconnect(page);
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
  state.object = { ...state.object, id: '1' };
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Сектор исходный');
  expect(businessWrites).toEqual([]);
});

test('a late save from a closed passport cannot replace a newly recovered draft', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page); state.holdSave = true;
  await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Старый отправленный черновик');
  try {
    await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    state.fail = 403;
    await reconnect(page);
    await expect.poll(() => state.failedReads).toBeGreaterThan(0);
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
    state.fail = 0;
    state.object = { ...state.object, name: 'Свежий восстановленный объект' };
    await reconnect(page);
    await page.getByLabel('Название сектора', { exact: true }).fill('Новый восстановленный черновик');
    await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
    const before = state.detailReads;
    state.holdDetail = true;
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/objects/1/passport/');
    state.holdSave = false; state.releaseSave();
    await (await saved).finished();
    await expect.poll(() => state.detailReads).toBeGreaterThan(before);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Новый восстановленный черновик');
  } finally { state.releaseSave(); state.releaseDetail(); }
  expect(state.writes).toHaveLength(1); expect(businessWrites).toEqual([]);
});

test('a late save cannot reopen a passport while its fresh access read is held', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page); state.holdSave = true;
  await page.goto(target);
  await page.getByLabel('Название сектора', { exact: true }).fill('Старый отправленный черновик');
  try {
    await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    state.fail = 403;
    await reconnect(page);
    await expect.poll(() => state.failedReads).toBeGreaterThan(0);
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
    const before = state.detailReads;
    state.holdDetail = true;
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/objects/1/passport/');
    state.holdSave = false; state.releaseSave();
    await (await saved).finished();
    await expect.poll(() => state.detailReads).toBeGreaterThan(before);
    await page.waitForTimeout(300);
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toHaveCount(0);
  } finally { state.releaseSave(); state.releaseDetail(); }
  expect(state.writes).toHaveLength(1); expect(businessWrites).toEqual([]);
});

for (const action of ['save', 'publish'] as const) test(`a pending ${action} keeps its original authority context after editing permission changes`, async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page); state.holdSave = true;
  await page.goto(target);
  const field = action === 'save' ? page.getByLabel('Название сектора', { exact: true }) : page.getByLabel('Примечание к публикации', { exact: true });
  if (action === 'publish') {
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  }
  await field.fill('Черновик до смены права');
  try {
    await page.getByRole('button', { name: action === 'save' ? 'Сохранить паспорт' : 'Опубликовать версию', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    const permissionsBefore = state.permissionReads;
    state.permissions = ['object.view'];
    state.object = { ...state.object, name: 'Объект после смены права' };
    await reconnect(page);
    await expect.poll(() => state.permissionReads).toBeGreaterThan(permissionsBefore);
    await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
    await expect(page.getByText(action === 'save' ? 'Паспорт доступен для просмотра. Форма доступна только для чтения.' : 'История доступна для просмотра. Публикация доступна только для чтения.', { exact: true })).toBeVisible();
    const before = state.detailReads;
    state.holdDetail = true;
    const saved = page.waitForResponse(response => response.request().method() === (action === 'save' ? 'PATCH' : 'POST') && new URL(response.url()).pathname.startsWith('/api/ops/objects/1/passport/'));
    state.holdSave = false; state.releaseSave();
    await (await saved).finished();
    await expect.poll(() => state.detailReads).toBeGreaterThan(before);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
    await expect(field).toHaveValue('Черновик до смены права');
    await expect(field).toBeDisabled();
  } finally { state.releaseSave(); state.releaseDetail(); }
  expect(state.writes).toHaveLength(1); expect(businessWrites).toEqual([]);
});
