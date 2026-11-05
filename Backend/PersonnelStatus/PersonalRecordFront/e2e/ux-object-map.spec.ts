import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { GeoPoint, ObjectSector, SecurityObject } from '@/entities/security-object';

const pointA: GeoPoint = { latitude: 51.128, longitude: 71.43 };
const pointB: GeoPoint = { latitude: 51.135, longitude: 71.44 };
const registry = '/security-ops/objects/';
const card = '/security-ops/objects/1/';

async function prepare(page: Page, options: { readOnly?: boolean; location?: GeoPoint | null; sectors?: ObjectSector[] } = {}) {
  const object: SecurityObject = {
    id: '1', name: 'Учебный объект карты', code: 'MAP-ONE', type: 'Здание', region: 'Учебный регион', address: 'Учебный адрес',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: true, photoUrl: null,
    location: options.location ?? null,
    sectors: options.sectors ?? [{ id: 's1', name: 'Учебный сектор', posts: [{ id: 'p1', name: 'Учебный пост', task: 'Задача', requirements: '' }] }],
    passportVersions: [
      { id: 'old', versionNumber: 1, effectiveFrom: '2026-09-01', publishedAt: '2026-09-01T10:00:00Z', publishedBy: 'Synthetic', note: '', location: null, sectors: [] },
      { id: 'mapped', versionNumber: 2, effectiveFrom: '2026-10-01', publishedAt: '2026-10-01T10:00:00Z', publishedBy: 'Synthetic', note: '', location: pointA, sectors: [] },
    ],
    createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z',
  };
  const missing = { ...object, id: '2', code: 'MAP-MISSING', name: 'Учебный объект без координат', ownership: 'GUARDED' as const, hasSecurityEvents: false, location: null, passportVersions: [] };
  const distant = { ...object, id: '3', code: 'MAP-OUTSIDE', name: 'Учебный объект вне покрытия', ownership: 'GUARDED' as const, location: { latitude: 0, longitude: 0 }, passportVersions: [] };
  const state = { object, rows: [object, missing, distant], writes: [] as { location: GeoPoint | null }[],
    passportWrites: [] as { sectors: ObjectSector[] }[],
    permissions: ['object.view', ...(options.readOnly ? [] : ['object.manage'])], readFailure: 0, readCount: 0,
    saveFailure: 0, holdSave: false, releaseSave: () => {} };
  const held = new Promise<void>(resolve => { state.releaseSave = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: state.permissions, global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/objects/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/ops/objects/') return route.fulfill({ json: {
      results: [state.object, ...state.rows.slice(1)], freshness: [], unavailableKpi: [],
      kpi: { total: 3, passportGreen: 3, passportYellow: 0, passportRed: 0, verificationOverdue: 0, neverPublished: 2 },
      freshnessPolicy: { version: 'synthetic-map', verificationIntervalDays: 90, dueSoonPercent: 20 },
    } });
    if (request.method() === 'GET' && path === '/api/ops/objects/1/') {
      state.readCount++;
      if (state.readFailure) return route.fulfill({ status: state.readFailure, json: { detail: 'Synthetic read failure' } });
      return route.fulfill({ json: state.object });
    }
    if (request.method() === 'PATCH' && path === '/api/ops/objects/1/passport/') {
      const body = request.postDataJSON() as { sectors: ObjectSector[] }; state.passportWrites.push(body);
      if (state.saveFailure) return route.fulfill({ status: state.saveFailure, json: { detail: 'Synthetic save failure' } });
      state.object = { ...state.object, sectors: body.sectors };
      return route.fulfill({ json: state.object });
    }
    if (request.method() === 'PATCH' && path === '/api/ops/objects/1/location/') {
      const body = request.postDataJSON() as { location: GeoPoint | null }; state.writes.push(body);
      if (state.holdSave) await held;
      if (state.saveFailure) return route.fulfill({ status: state.saveFailure, json: { detail: 'Synthetic save failure' } });
      state.object = { ...state.object, location: body.location };
      return route.fulfill({ json: state.object });
    }
    return route.fallback();
  });
  await signIn(page);
  return state;
}

async function enter(page: Page, latitude = '51.135', longitude = '71.44') {
  await page.getByRole('button', { name: /^(Указать|Изменить) местоположение$/ }).click();
  await page.getByLabel('Широта объекта', { exact: true }).fill(latitude);
  await page.getByLabel('Долгота объекта', { exact: true }).fill(longitude);
}

async function refresh(page: Page) {
  await page.clock.install();
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('legacy passport links open general data; compact maps keep object and post drafts across tabs', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  const back = 'tab=own&search=Учебный';
  for (const tab of ['infra', 'check', 'groups']) {
    await page.goto(card + '?' + new URLSearchParams({ tab, back }));
    await expect(page.getByRole('tab', { name: 'Общие данные', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Указать местоположение', exact: true })).toBeVisible();
  }
  await enter(page);
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await page.getByLabel('Название сектора', { exact: true }).fill('Несохранённый сектор');
  await expect(page.getByLabel('Карта постов паспорта', { exact: true }).locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Местоположение поста: Учебный пост', exact: true }).click();
  await page.getByText('Координаты вручную', { exact: true }).click();
  await page.getByLabel('Широта поста', { exact: true }).fill('51.14');
  await page.getByLabel('Долгота поста', { exact: true }).fill('71.45');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByRole('tab', { name: 'Общие данные', exact: true }).click();
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveValue('51.135');
  await expect(page.getByLabel('Долгота объекта', { exact: true })).toHaveValue('71.44');
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Несохранённый сектор');
  await expect(page.getByLabel('Широта поста', { exact: true })).toHaveValue('51.14');
  await page.getByRole('button', { name: 'Применить к черновику', exact: true }).click();
  await expect(page.getByLabel('Карта постов паспорта', { exact: true }).locator('canvas')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('back')).toBe(back);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('registry map follows filters, counts null/outside points and opens the matching catalog passport with its return query', async ({ page, businessWrites }) => {
  await prepare(page, { location: pointA });
  await page.goto(registry + '?view=map');
  await expect(page.getByRole('status').filter({ hasText: 'На карте: 1 · Без координат: 1 · Вне покрытия: 1' })).toBeVisible();
  const back = new URLSearchParams({ view: 'map', tab: 'own', search: 'Учебный' }).toString();
  await page.goto(registry + '?' + back);
  await expect(page.getByRole('status').filter({ hasText: 'На карте: 1 · Без координат: 0 · Вне покрытия: 0' })).toBeVisible();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await map.getByRole('button', { name: 'Учебный объект карты', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/objects\/1\/?$/);
  expect(new URL(page.url()).searchParams.get('back')).toBe(back);
  await page.getByRole('link', { name: '← Назад к реестру', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Карта', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(businessWrites).toEqual([]);
});

test('card click and cancel leave the server untouched; explicit Save, reload and Clear persist only the chosen point', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto(card);
  await expect(page.getByRole('button', { name: 'Указать местоположение', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Указать местоположение', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true }).locator('canvas');
  await canvas.click({ position: { x: 160, y: 160 } });
  await expect(page.getByLabel('Широта объекта', { exact: true })).not.toHaveValue('');
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(state.object.location).toBeNull();
  await enter(page);
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByText('Местоположение сохранено.', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ location: pointB }]);
  await page.reload();
  await expect(page.getByLabel('Местоположение объекта', { exact: true }).getByLabel('Сохранённые координаты объекта', { exact: true })).toContainText('51.135000');
  await page.getByRole('button', { name: 'Изменить местоположение', exact: true }).click();
  await page.getByRole('button', { name: 'Очистить точку', exact: true }).click();
  expect(state.object.location).toEqual(pointB);
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByLabel('Местоположение объекта', { exact: true }).getByText('Координаты объекта не указаны.', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ location: pointB }, { location: null }]); expect(businessWrites).toEqual([]);
});

test('manual zero coordinates remain outside coverage without a fabricated local marker', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto(card); await enter(page, '0', '0');
  await expect(page.getByRole('status').filter({ hasText: 'Точка находится вне покрытия' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByLabel('Местоположение объекта', { exact: true }).getByLabel('Сохранённые координаты объекта', { exact: true })).toContainText('Широта: 0.000000 · Долгота: 0.000000');
  await expect(page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true }).getByRole('button', { name: state.object.name, exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([{ location: { latitude: 0, longitude: 0 } }]); expect(businessWrites).toEqual([]);
});

test('a canvas click beyond loaded coverage rejects the point and preserves the existing draft without clamping', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto(card); await enter(page);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await map.locator('canvas').press('-');
  await map.locator('canvas').press('-');
  const canvas = map.locator('canvas'); await canvas.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp');
  await canvas.click({ position: { x: 100, y: 1 } });
  await expect(page.getByRole('alert').filter({ hasText: 'Выбранная точка вне покрытия' })).toBeVisible();
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveValue('51.135');
  await expect(page.getByLabel('Долгота объекта', { exact: true })).toHaveValue('71.44');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('save failure preserves the draft and retry does not reset existing sector or publication drafts', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.saveFailure = 503; await page.goto(card + '?tab=posts');
  await page.getByLabel('Название сектора', { exact: true }).fill('Мой сектор');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByLabel('Действует с *', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Примечание к публикации', { exact: true }).fill('Моё примечание');
  await page.getByRole('tab', { name: 'Общие данные', exact: true }).click(); await enter(page);
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сохранить точку.' })).toBeVisible();
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveValue('51.135');
  state.saveFailure = 0;
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByText('Местоположение сохранено.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Мой сектор');
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await expect(page.getByLabel('Примечание к публикации', { exact: true })).toHaveValue('Моё примечание');
  expect(state.writes).toEqual([{ location: pointB }, { location: pointB }]); expect(businessWrites).toEqual([]);
});

test('external reads preserve unsaved coordinates and a delayed save cannot close a newer tab context', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto(card); await enter(page);
  state.object = { ...state.object, location: pointA };
  await refresh(page);
  await expect(page.getByLabel('Местоположение объекта', { exact: true }).getByLabel('Сохранённые координаты объекта', { exact: true })).toContainText('51.128000');
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveValue('51.135');
  state.holdSave = true;
  try {
    await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
    await expect(page.getByLabel('Широта объекта', { exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
    await page.getByLabel('Название сектора', { exact: true }).fill('Черновик новой вкладки');
  } finally { state.holdSave = false; state.releaseSave(); }
  await page.getByRole('tab', { name: 'Общие данные', exact: true }).click();
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveValue('51.135');
  await expect(page.getByLabel('Широта объекта', { exact: true })).toBeEnabled();
  expect(state.writes).toEqual([{ location: pointB }]); expect(businessWrites).toEqual([]);
});

for (const status of [403, 404]) test(`a ${status} read hides retained coordinates and all editor controls`, async ({ page, businessWrites }) => {
  const state = await prepare(page, { location: pointA }); await page.goto(card); await enter(page);
  state.readFailure = status; await refresh(page);
  await expect(page.getByText('Объект не найден или недоступен для просмотра.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Сохранённые координаты объекта', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('view-only access keeps the canvas usable without coordinate edit controls or writes', async ({ page, businessWrites }) => {
  const state = await prepare(page, { readOnly: true, location: pointA }); await page.goto(card);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await map.locator('canvas').press('+');
  await expect(page.getByRole('button', { name: /^(Указать|Изменить) местоположение$/ })).toHaveCount(0);
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('history preview and standalone versions show their saved snapshot and leave old null versions unlocated', async ({ page, businessWrites }) => {
  const state = await prepare(page, { location: pointB }); await page.goto(card + '?tab=history');
  await page.getByRole('link', { name: 'Версия 2', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Сохранённые координаты объекта', { exact: true })).toContainText('51.128000');
  await expect(dialog.getByLabel('Сохранённые координаты объекта', { exact: true })).not.toContainText('51.135000');
  await page.keyboard.press('Escape');
  await page.goto(card + 'passports/mapped/');
  await expect(page.getByLabel('Сохранённые координаты объекта', { exact: true })).toContainText('51.128000');
  await expect(page.getByLabel('Широта объекта', { exact: true })).toHaveCount(0);
  await page.goto(card + 'passports/old/');
  await expect(page.getByText('В этой версии паспорта координаты не сохранены.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Сохранённые координаты объекта', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

for (const width of [390, 1440]) test(`local map paints offline and fits ${width}px with map asset retry`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 1000 });
  await prepare(page, { location: pointA });
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); return route.abort(); }
    return route.fallback();
  });
  let attempts = 0;
  await page.route('**/maps/astana/manifest.json', route => ++attempts === 1 ? route.fulfill({ status: 503, body: 'Synthetic asset failure' }) : route.continue());
  await page.goto(registry + '?view=map');
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить локальную карту.' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить загрузку карты', exact: true }).click();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect.poll(() => map.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    for (let i = 0; i < bytes.length; i += 400) colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
    return colors.size;
  })).toBeGreaterThan(8);
  await page.getByRole('button', { name: 'Показать на карте: Учебный объект карты', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(map.getByRole('button', { name: 'Учебный объект карты', exact: true })).toBeVisible();
  expect(attempts).toBe(2); expect(external).toEqual([]); expect(businessWrites).toEqual([]);
});

for (const width of [390, 1440]) test(`passport posts are placed directly on the map and persist only on Save at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await prepare(page, { sectors: [], location: pointA });
  await page.goto(card + '?tab=posts');
  const map = page.getByLabel('Карта постов паспорта', { exact: true });
  const canvas = map.locator('canvas');
  await canvas.click({ position: { x: 80, y: 120 } });
  await expect(page.getByLabel('Название сектора', { exact: true })).toHaveValue('Основной сектор');
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveValue('Пост 1');
  await page.getByLabel('Название поста', { exact: true }).fill('Вход');
  await canvas.click({ position: { x: 160, y: 200 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  await map.getByRole('button', { name: 'Основной сектор · Вход', exact: true }).click();
  await expect(map.getByRole('status').filter({ hasText: /^Укажите место:/ })).toContainText('Укажите место: Вход');
  await map.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(state.passportWrites).toEqual([]);
  expect(state.object.sectors).toEqual([]);
  await page.getByRole('tab', { name: 'Общие данные', exact: true }).click();
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  await expect(page.getByLabel('Название поста', { exact: true }).first()).toHaveValue('Вход');
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect.poll(() => state.passportWrites.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  const saved = state.object.sectors[0].posts;
  expect(saved.map(p => p.name)).toEqual(['Вход', 'Пост 2']);
  expect(saved.every(p => p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude))).toBe(true);
  expect(saved[0].location).not.toEqual(saved[1].location);
  await page.reload();
  await expect(map.getByRole('button', { name: 'Основной сектор · Вход', exact: true })).toBeVisible();
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('map placement requires a sector, preserves existing fields and survives a failed save', async ({ page, businessWrites }) => {
  const state = await prepare(page, { location: pointA });
  state.object.sectors.push({ id: 's2', name: 'Второй сектор', posts: [] });
  await page.goto(card + '?tab=posts');
  const map = page.getByLabel('Карта постов паспорта', { exact: true });
  await page.getByLabel('Название поста', { exact: true }).fill('Существующий пост');
  await map.locator('canvas').click({ position: { x: 100, y: 100 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(1);
  await page.getByLabel('Сектор для нового поста', { exact: true }).selectOption('s2');
  await map.locator('canvas').click({ position: { x: 100, y: 100 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  expect(state.passportWrites).toEqual([]);
  state.saveFailure = 503;
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сохранить паспорт.' })).toBeVisible();
  await expect(page.getByLabel('Название поста', { exact: true }).first()).toHaveValue('Существующий пост');
  state.saveFailure = 0;
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  expect(state.object.sectors[0].posts[0].name).toBe('Существующий пост');
  expect(state.object.sectors[0].posts[0].location).toBeUndefined();
  expect(state.object.sectors[1].posts[0].location).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('view-only passport map cannot create posts', async ({ page, businessWrites }) => {
  const state = await prepare(page, { readOnly: true, location: pointA });
  await page.goto(card + '?tab=posts');
  await page.getByLabel('Карта постов паспорта', { exact: true }).locator('canvas').click({ position: { x: 100, y: 100 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Название поста', { exact: true })).toBeDisabled();
  expect(state.passportWrites).toEqual([]); expect(businessWrites).toEqual([]);
});

test('mobile post overview initially fits all saved points and keeps its view after adding one', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await prepare(page, { location: pointA, sectors: [{ id: 's', name: 'Сектор', posts: [
    { id: 'p', name: 'Дальний пост', task: '', requirements: '', location: { latitude: 51.18, longitude: 71.5 } },
  ] }] });
  await page.goto(card + '?tab=posts');
  const map = page.getByLabel('Карта постов паспорта', { exact: true });
  const objectMarker = map.getByRole('button', { name: 'Объект', exact: true });
  await expect(objectMarker).toBeVisible();
  await expect(map.getByRole('button', { name: 'Сектор · Дальний пост', exact: true })).toBeVisible();
  const before = await objectMarker.evaluate(node => ({ left: (node as HTMLElement).style.left, top: (node as HTMLElement).style.top }));
  await map.locator('canvas').click({ position: { x: 100, y: 150 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(2);
  expect(await objectMarker.evaluate(node => ({ left: (node as HTMLElement).style.left, top: (node as HTMLElement).style.top }))).toEqual(before);
  expect(businessWrites).toEqual([]);
});

test('posts first opened after saving an object location center on its current point', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await prepare(page);
  await page.goto(card);
  await enter(page, '51.18', '71.5');
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByText('Местоположение сохранено.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Посты и секторы', exact: true }).click();
  const map = page.getByLabel('Карта постов паспорта', { exact: true });
  const marker = map.getByRole('button', { name: 'Объект', exact: true });
  await expect(marker).toBeVisible();
  await expect.poll(async () => {
    const box = await map.locator('canvas').boundingBox(), pin = await marker.boundingBox();
    return box && pin ? Math.abs(pin.x + pin.width / 2 - box.x - box.width / 2) : 1000;
  }).toBeLessThan(3);
  expect(businessWrites).toEqual([]);
});

for (const width of [390, 1440]) test(`placing and moving an existing post always uses one map at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await prepare(page, { location: pointA });
  await page.goto(card + '?tab=posts');
  const map = page.getByLabel('Карта постов паспорта', { exact: true });
  const canvas = map.locator('canvas');
  const visibleMaps = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(visibleMaps).toHaveCount(1);
  await page.getByRole('button', { name: 'Местоположение поста: Учебный пост', exact: true }).click();
  await expect(map.getByRole('status').filter({ hasText: /^Укажите место:/ })).toContainText('Укажите место: Учебный пост');
  await expect(visibleMaps).toHaveCount(1);
  await expect(canvas).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Применить к черновику', exact: true })).toHaveCount(0);
  await canvas.click({ position: { x: 100, y: 150 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(1);
  await expect(map.getByRole('status').filter({ hasText: /^Укажите место:/ })).toHaveCount(0);
  expect(state.passportWrites).toEqual([]);
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  const original = structuredClone(state.object.sectors[0].posts[0]);
  expect(original.id).toBe('p1'); expect(original.location).toBeTruthy();
  await page.reload();
  await map.getByRole('button', { name: 'Учебный сектор · Учебный пост', exact: true }).click();
  await expect(visibleMaps).toHaveCount(1);
  await canvas.click({ position: { x: 200, y: 250 } });
  await expect(page.getByLabel('Название поста', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Сохранить паспорт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  const moved = state.object.sectors[0].posts[0];
  expect(moved.location).not.toEqual(original.location);
  expect({ ...moved, location: original.location }).toEqual(original);
  await page.reload();
  await map.getByRole('button', { name: 'Учебный сектор · Учебный пост', exact: true }).click();
  await map.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить паспорт', exact: true })).toBeDisabled();
  await expect(visibleMaps).toHaveCount(1);
  expect(state.passportWrites).toHaveLength(2); expect(businessWrites).toEqual([]);
});
