import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

async function prepare(page: Page) {
  await page.clock.install();
  const object: SecurityObject = {
    id: '1', name: 'Паспорт новой редакции', code: 'UX-REVISION', type: 'Здание', region: 'Астана', address: 'Адрес проверки',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [{ id: 's1', name: 'Исходный сектор', posts: [{ id: 'p1', name: 'Исходный пост', task: 'Исходная задача', requirements: 'Исходные требования' }] }],
    passportVersions: [], createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
  };
  const state = { object, reads: 0, revision: 0, writes: [] as Record<string, unknown>[], permissions: ['object.view', 'object.manage'], hold: false, fail: 0, release: () => {} };
  const pending = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: state.permissions, global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/objects/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/ops/objects/1/') { state.reads++; return route.fulfill({ json: state.object }); }
    if (request.method() === 'GET' && path === '/api/ops/objects/') return route.fulfill({ json: { results: [state.object], freshness: [], unavailableKpi: [], kpi: { total: 1 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
    if (request.method() === 'PATCH' && path === '/api/ops/objects/1/passport/') {
      const body = request.postDataJSON(); state.writes.push(body);
      if (state.hold) await pending;
      if (state.fail) return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа новой редакции' } });
      state.object = { ...state.object, sectors: body.sectors };
      return route.fulfill({ json: state.object });
    }
    return route.fallback();
  });
  await signIn(page);
  await page.goto('/security-ops/objects/1?tab=posts');
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Исходный сектор');
  return state;
}

async function refresh(page: Page, state: Awaited<ReturnType<typeof prepare>>, changeSectors = true) {
  state.revision++;
  state.object = { ...state.object, name: 'Объект после подтверждённого обновления ' + state.revision, updatedAt: '2026-10-12T11:00:00Z',
    ...(changeSectors ? { sectors: state.object.sectors.map(sector => ({ ...sector, name: 'Новая серверная редакция' + (state.revision > 1 ? ' ' + state.revision : ''), posts: [
      { ...sector.posts[0], task: 'Новая серверная задача' },
      { id: 'p2', name: 'Добавленный серверный пост', task: 'Задача новой редакции ' + state.revision, requirements: 'Новые требования' },
    ] })) } : {}) };
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('heading', { name: state.object.name, exact: true })).toBeVisible();
}

test('an untouched passport follows a confirmed new sector revision and stays clean', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await refresh(page, state);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Новая серверная редакция');
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  await expect(page.getByLabel('Задача поста', { exact: true }).first()).toHaveValue('Новая серверная задача');
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a draft keeps its original fields and explains the confirmed new sector revision', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.getByLabel('Название сектора', { exact: true }).fill('Мой несохранённый сектор');
  await refresh(page, state);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await expect(page.getByRole('alert').filter({ hasText: 'Посты и секторы изменились на сервере.' })).toBeVisible();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('metadata-only refresh keeps the draft without claiming that sectors changed', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.getByLabel('Название сектора', { exact: true }).fill('Мой несохранённый сектор');
  await refresh(page, state, false);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await expect(page.getByRole('alert').filter({ hasText: 'Посты и секторы изменились на сервере.' })).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a confirmed server revision identical to the draft becomes clean without a replacement warning', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.getByLabel('Название сектора', { exact: true }).fill('Совпавший сектор');
  state.object = { ...state.object, sectors: state.object.sectors.map(sector => ({ ...sector, name: 'Совпавший сектор' })) };
  await refresh(page, state, false);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Совпавший сектор');
  await expect(page.getByRole('alert').filter({ hasText: 'Посты и секторы изменились на сервере.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

async function staleDraft(page: Page) {
  const state = await prepare(page);
  await page.getByLabel('Название сектора', { exact: true }).fill('Мой несохранённый сектор');
  await refresh(page, state);
  await expect(page.getByRole('alert').filter({ hasText: 'Посты и секторы изменились на сервере.' })).toBeVisible();
  return state;
}

test('replacing a stale draft asks first, cancellation preserves focus and confirmation loads the whole revision', async ({ page, businessWrites }) => {
  const state = await staleDraft(page);
  const reload = page.getByRole('button', { name: 'Загрузить новую редакцию', exact: true });
  await reload.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Несохранённые изменения постов и секторов будут потеряны.');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await expect(reload).toBeFocused();
  await reload.click();
  await dialog.getByRole('button', { name: 'Заменить черновик', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Новая серверная редакция');
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('saving a stale draft explains the complete replacement and sends the chosen snapshot once', async ({ page, businessWrites }) => {
  const state = await staleDraft(page);
  const save = page.getByRole('button', { name: 'Сохранить паспорт', exact: true });
  await save.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Ваш черновик заменит все посты и секторы загруженной редакции, включая чужие добавления и удаления.');
  expect(state.writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(save).toBeFocused();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await save.click();
  await dialog.getByRole('button', { name: 'Сохранить мой черновик', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(save).toBeDisabled();
  expect(state.writes).toEqual([{ sectors: [{ id: 's1', name: 'Мой несохранённый сектор', posts: [{ id: 'p1', name: 'Исходный пост', task: 'Исходная задача', requirements: 'Исходные требования' }] }] }]);
  expect(businessWrites).toEqual([]);
});

test('a rejected confirmed stale snapshot keeps its draft and locks fields while pending', async ({ page, businessWrites }) => {
  const state = await staleDraft(page); state.hold = true; state.fail = 503;
  try {
    await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Сохранить мой черновик', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.getByLabel('Название сектора', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Загрузить новую редакцию', exact: true })).toBeDisabled();
  } finally { state.hold = false; state.release(); }
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сохранить паспорт.' })).toBeVisible();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await expect(page.getByLabel('Название сектора', { exact: true })).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Посты и секторы изменились на сервере.' })).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(businessWrites).toEqual([]);
});

test('editing permission loss closes an open stale confirmation without sending or losing its draft', async ({ page, businessWrites }) => {
  const state = await staleDraft(page);
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  state.permissions = ['object.view'];
  await refresh(page, state, false);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  await expect(page.getByLabel('Название сектора', { exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('another server revision closes the old confirmation and retains the unsaved fields', async ({ page, businessWrites }) => {
  const state = await staleDraft(page);
  await page.getByRole('button', { name: 'Загрузить новую редакцию', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await refresh(page, state);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой несохранённый сектор');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});
