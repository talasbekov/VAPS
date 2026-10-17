import { test, expect, signIn, readEvent } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';

async function prepare(page: Page, request: APIRequestContext, withSavedObject = false) {
  const source = await readEvent(request);
  const visit = { ...source.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const post = { ...source.reconSectorPosts[0], visitObjectId: visit.id };
  const state = { hold: false, fail: false, holdRead: false, reads: 0, editAllowed: true, posts: [post], payloads: [] as object[], release: () => {}, releaseRead: () => {} };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }); state.release = release;
  let releaseRead!: () => void;
  const readWaiting = new Promise<void>(resolve => { releaseRead = resolve; }); state.releaseRead = releaseRead;
  let locations: { objects: Record<string, { latitude: number; longitude: number }>; posts: Record<string, unknown> } = { objects: withSavedObject ? { [visit.id]: { latitude: 51.1, longitude: 71.4 } } : {}, posts: {} };
  await page.route(url => url.pathname === `/api/ops/security-events/${source.id}/`, route => route.fulfill({ json: { ...source, stage: 'PLACEMENT', visitObjects: [{ ...visit, canManagePlacement: state.editAllowed }], reconSectorPosts: state.posts } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${source.id}/placement/map/`, async route => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON(); state.payloads.push(payload);
      if (state.hold) await waiting;
      if (state.fail) return route.fulfill({ status: 503, json: { message: 'Проверка отказа сохранения' } });
      if (payload.targetType === 'object') locations.objects[payload.targetId] = payload.location;
      else locations.posts[payload.targetId] = { location: payload.location, outdoor: payload.outdoor };
      return route.fulfill({ json: locations });
    }
    state.reads++;
    const snapshot = structuredClone(locations);
    if (state.holdRead) await readWaiting;
    return route.fulfill({ json: snapshot });
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${source.id}/?step=2&visit=${visit.id}&map=1&back=stage%3DPLACEMENT`);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  return { state, visit, post };
}

test('switching to the post list and back retains an outdoor point draft without saving it', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, visit, post } = await prepare(page, request);
  await page.getByLabel('Точка для', { exact: true }).selectOption(`post:${post.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await expect(page.getByLabel('Точка для', { exact: true })).toHaveValue(`post:${post.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.43');
  expect(new URL(page.url()).searchParams.get('visit')).toBe(visit.id);
  expect(new URL(page.url()).searchParams.get('back')).toBe('stage=PLACEMENT');
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(page.getByText('На карте есть несохранённая точка. Вернитесь к карте, чтобы продолжить или отменить.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(page.getByText('На карте есть несохранённая точка. Вернитесь к карте, чтобы продолжить или отменить.', { exact: true })).toHaveCount(0);
  expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('changing the map target asks before discarding changed coordinates and cancellation returns focus to the old target', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const { state, visit, post } = await prepare(page, request);
  const target = page.getByLabel('Точка для', { exact: true }); await target.selectOption(`object:${visit.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.141'); await page.getByLabel('Долгота точки', { exact: true }).fill('71.455');
  await target.selectOption(`post:${post.id}`);
  const dialog = page.getByRole('dialog', { name: 'Сменить точку?', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Продолжить ввод', exact: true }).click();
  await expect(target).toHaveValue(`object:${visit.id}`); await expect(target).toBeFocused();
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.141'); await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.455');
  await target.selectOption(`post:${post.id}`); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Перейти и сбросить', exact: true }).click();
  await expect(target).toHaveValue(`post:${post.id}`); await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('');
  expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('an unchanged saved map point switches immediately without a discard dialog', async ({ page, request, businessWrites }) => {
  const { state, visit, post } = await prepare(page, request, true);
  const target = page.getByLabel('Точка для', { exact: true }); await target.selectOption(`object:${visit.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.1');
  await target.selectOption(`post:${post.id}`); await expect(target).toHaveValue(`post:${post.id}`); await expect(page.getByRole('dialog')).toHaveCount(0);
  await target.selectOption(`object:${visit.id}`); await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.1');
  expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a partial map point still asks before discard and Escape or close preserves its target and input', async ({ page, request, businessWrites }) => {
  const { state, visit, post } = await prepare(page, request); const target = page.getByLabel('Точка для', { exact: true });
  await target.selectOption(`object:${visit.id}`); await page.getByLabel('Широта точки', { exact: true }).fill('51.14'); await target.selectOption(`post:${post.id}`);
  const dialog = page.getByRole('dialog', { name: 'Сменить точку?', exact: true }); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(target).toBeFocused(); await expect(target).toHaveValue(`object:${visit.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.14'); await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('');
  await target.selectOption(`post:${post.id}`); await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(target).toBeFocused(); await expect(target).toHaveValue(`object:${visit.id}`); expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
});

test('the map target is locked while its point is saving and becomes available after confirmed completion', async ({ page, request, businessWrites }) => {
  const { state, visit, post } = await prepare(page, request); const target = page.getByLabel('Точка для', { exact: true });
  await target.selectOption(`object:${visit.id}`); await page.getByLabel('Широта точки', { exact: true }).fill('51.141'); await page.getByLabel('Долгота точки', { exact: true }).fill('71.455');
  state.hold = true; await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click(); await expect.poll(() => state.payloads.length).toBe(1);
  await expect(target).toBeDisabled(); state.release(); await expect(page.getByText('Координаты сохранены.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click(); await expect(target).toBeEnabled();
  await target.selectOption(`post:${post.id}`); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.payloads).toHaveLength(1); expect(businessWrites).toEqual([]);
});

test('losing map editing closes its discard question and returning permission does not reopen the question', async ({ page, request, businessWrites }) => {
  await page.clock.install(); const { state, visit, post } = await prepare(page, request); const target = page.getByLabel('Точка для', { exact: true });
  await target.selectOption(`object:${visit.id}`); await page.getByLabel('Широта точки', { exact: true }).fill('51.14'); await target.selectOption(`post:${post.id}`);
  const dialog = page.getByRole('dialog', { name: 'Сменить точку?', exact: true }); await expect(dialog).toBeVisible();
  async function reconnect() {
    await page.clock.fastForward(61000); await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  }
  state.editAllowed = false; await reconnect(); await expect(dialog).toHaveCount(0); await expect(target).toHaveCount(0);
  state.editAllowed = true; await reconnect(); await expect(target).toBeVisible(); await expect(dialog).toHaveCount(0);
  await expect(target).toHaveValue(`object:${visit.id}`); await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.14');
  expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
});

test('an orphan map draft remains explicit and can change to an existing target after confirmed discard', async ({ page, request, businessWrites }) => {
  await page.clock.install(); const { state, visit, post } = await prepare(page, request, true);
  const target = page.getByLabel('Точка для', { exact: true }); await target.selectOption(`post:${post.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.141'); state.posts = [{ ...post, id: post.id + '-replacement', post: 'Другой пост' }];
  await page.clock.fastForward(61000); await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByText('Эта цель больше недоступна. Черновик сохранён. Выберите другую цель или отмените ввод.', { exact: true })).toBeVisible();
  await expect(target).toHaveValue(`post:${post.id}`); await target.selectOption(`object:${visit.id}`);
  const dialog = page.getByRole('dialog', { name: 'Сменить точку?', exact: true }); await expect(dialog).toBeVisible(); await expect(dialog).toContainText(post.post);
  await dialog.getByRole('button', { name: 'Продолжить ввод', exact: true }).click(); await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.141');
  await target.selectOption(`object:${visit.id}`); await dialog.getByRole('button', { name: 'Перейти и сбросить', exact: true }).click();
  await expect(target).toHaveValue(`object:${visit.id}`); await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.1');
  expect(state.payloads).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a point save remains visible as pending and then complete while the post list is open', async ({ page, request, businessWrites }) => {
  const { state, visit } = await prepare(page, request);
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${visit.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  state.hold = true;
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  try {
    await expect(page.getByText('Сохраняем координаты точки…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
    await expect(page.getByLabel('Широта точки', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  } finally { state.hold = false; state.release(); }
  await expect(page.getByText('Координаты сохранены.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${visit.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  expect(state.payloads).toEqual([{ targetType: 'object', targetId: visit.id, location: { latitude: 51.128, longitude: 71.43 } }]);
  expect(businessWrites).toEqual([]);
});

test('a failed point remains a recoverable draft when the operator checks the post list', async ({ page, request, businessWrites }) => {
  const { state, visit } = await prepare(page, request);
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${visit.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  state.fail = true;
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByText(/Не удалось сохранить точку\. Проверьте права/)).toBeVisible();
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(page.getByText('Не удалось сохранить точку. Введённые координаты сохранены в форме. Вернитесь к карте, чтобы повторить.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.43');
  state.fail = false;
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByText('Координаты сохранены.', { exact: true })).toBeVisible();
  expect(state.payloads).toEqual(Array(2).fill({ targetType: 'object', targetId: visit.id, location: { latitude: 51.128, longitude: 71.43 } }));
  expect(businessWrites).toEqual([]);
});

test('a delayed old map read cannot replace coordinates that have just been saved', async ({ page, request, businessWrites }) => {
  await page.clock.install();
  const { state, visit } = await prepare(page, request, true);
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${visit.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  state.hold = true;
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Список постов', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true })).toHaveCount(0);
  await page.clock.fastForward(61_000);
  state.holdRead = true;
  const reads = state.reads;
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  let lateRead!: ReturnType<Page['waitForResponse']>;
  try {
    await expect.poll(() => state.reads).toBeGreaterThan(reads);
    lateRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/placement/map/') && response.request().method() === 'GET');
    state.hold = false; state.release();
    await expect(page.getByText('Координаты сохранены.', { exact: true })).toBeVisible();
  } finally { state.hold = false; state.release(); state.holdRead = false; state.releaseRead(); }
  const response = await lateRead;
  expect(response.status()).toBe(200);
  await response.finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${visit.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.43');
  expect(state.payloads).toHaveLength(1); expect(businessWrites).toEqual([]);
});
