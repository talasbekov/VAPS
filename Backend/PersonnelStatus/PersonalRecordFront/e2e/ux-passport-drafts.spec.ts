import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { SecurityObject } from '@/entities/security-object';

async function prepare(page: Page, canManage = true) {
  const object: SecurityObject = {
    id: '1', name: 'Объект проверки паспорта', code: 'UX-PASSPORT', type: 'Здание', region: 'Астана', address: 'Адрес проверки',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [{ id: 's1', name: 'Сектор проверки', posts: [{ id: 'p1', name: 'Пост проверки', task: 'Исходная задача', requirements: 'Требования проверки' }] }],
    passportVersions: [], createdAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
  };
  const state = { object, reads: 0, writes: [] as { method: string; body: Record<string, unknown> }[], hold: false, fail: 0, release: () => {} };
  const pending = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['object.view', ...(canManage ? ['object.manage'] : [])], global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/objects/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/ops/objects/1/') { state.reads++; return route.fulfill({ json: state.object }); }
      if (path === '/api/ops/objects/') return route.fulfill({ json: { results: [state.object], freshness: [], unavailableKpi: [], kpi: { total: 1 }, freshnessPolicy: { version: 'ux', verificationIntervalDays: 90, dueSoonPercent: 20 } } });
      return route.fallback();
    }
    const isSave = request.method() === 'PATCH' && path === '/api/ops/objects/1/passport/';
    const isPublish = request.method() === 'POST' && path === '/api/ops/objects/1/passport/versions/';
    if (!isSave && !isPublish) return route.fallback();
    const body = request.postDataJSON(); state.writes.push({ method: request.method(), body });
    if (state.hold) await pending;
    if (state.fail) return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа паспорта' } });
    state.object = { ...state.object, updatedAt: '2026-10-12T12:00:00Z', ...(isSave ? { sectors: body.sectors } : { passportVersions: [{ id: 'v1', versionNumber: 1, effectiveFrom: body.effectiveFrom, note: body.note, publishedAt: '2026-10-12T12:00:00Z', publishedBy: 'ux', sectors: state.object.sectors }] }) };
    return route.fulfill({ json: state.object });
  });
  await signIn(page);
  return state;
}

const target = '/security-ops/objects/1?back=ownership%3DOWN%26search%3DUX';

test('a passport snapshot locks all editable fields while pending and retains the rejected draft', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.hold = true; state.fail = 503;
  await page.goto(target + '&tab=posts');
  await page.getByLabel('Название сектора', { exact: true }).fill('Черновик сектора');
  try {
    await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    for (const label of ['Название сектора', 'Название поста', 'Задача поста', 'Требования к назначению']) await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '+ Сектор', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Удалить пост', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
    await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Черновик сектора');
    await expect(page.getByLabel('Задача поста', { exact: true })).toBeDisabled();
  } finally { state.hold = false; state.release(); }
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сохранить паспорт.' })).toBeVisible();
  await expect(page.getByLabel('Название сектора', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Черновик сектора');
  expect(state.writes).toEqual([{ method: 'PATCH', body: { sectors: [{ id: 's1', name: 'Черновик сектора', posts: [{ id: 'p1', name: 'Пост проверки', task: 'Исходная задача', requirements: 'Требования проверки' }] }] } }]);
  expect(businessWrites).toEqual([]);
});

test('a publication draft survives checking posts and general data without changing the return filters', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto(target + '&tab=history');
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Проверить состав постов');
  for (const tab of ['Посты и секторы', 'Общие данные', 'Обследования', 'История']) await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('2026-10-14');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Проверить состав постов');
  expect(new URL(page.url()).searchParams.get('back')).toBe('ownership=OWN&search=UX');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a confirmed background object update does not replace the publication draft', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(target + '&tab=history');
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Несохранённое примечание');
  const before = state.reads;
  state.object = { ...state.object, name: 'Обновлённый объект проверки', updatedAt: '2026-10-12T11:00:00Z' };
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(page.getByRole('heading', { name: 'Обновлённый объект проверки', exact: true })).toBeVisible();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('2026-10-14');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Несохранённое примечание');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('pending publication locks its snapshot, preserves a rejected draft across tabs and allows a corrected retry', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.hold = true; state.fail = 503;
  await page.goto(target + '&tab=history');
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Черновик публикации');
  try {
    await page.getByRole('button', { name: 'Опубликовать версию', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.getByLabel('Действует с *', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Примечание к публикации', { exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Публикация…', exact: true })).toBeDisabled();
  } finally { state.hold = false; state.release(); }
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось опубликовать версию:' })).toBeVisible();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('2026-10-14');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Черновик публикации');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toBeEnabled();
  state.fail = 0;
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Исправленная публикация');
  await page.getByRole('button', { name: 'Опубликовать версию', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Версия 1', exact: true })).toBeVisible();
  await expect(page.getByLabel('Действует с *', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('');
  expect(state.writes.map(write => write.body)).toEqual([{ effectiveFrom: '2026-10-14', note: 'Черновик публикации' }, { effectiveFrom: '2026-10-14', note: 'Исправленная публикация' }]);
  expect(businessWrites).toEqual([]);
});

test('a passport reader keeps both editor forms read-only without any writes', async ({ page, businessWrites }) => {
  const state = await prepare(page, false);
  await page.goto(target + '&tab=posts');
  await expect(page.getByLabel('Название сектора', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await expect(page.getByLabel('Действует с *', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Опубликовать версию', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});
