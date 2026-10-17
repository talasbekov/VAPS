import { test, expect, signIn, readEvent } from './ux-fixture';

test('a delayed save for the previous object keeps a new object draft intact', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const first = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const second = { ...first, id: 'ux-second-visit', objectName: 'Второй объект' };
  const post = { ...event.reconSectorPosts[0], visitObjectId: first.id };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: { ...event, stage: 'PLACEMENT', visitObjects: [first, second], reconSectorPosts: [post] } }));
  let release!: () => void;
  let locations: { objects: Record<string, { latitude: number; longitude: number }>; posts: Record<string, never> } = { objects: {}, posts: {} };
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/placement/map/`, async route => {
    if (route.request().method() === 'PATCH') { await delayed; locations = { objects: { [first.id]: { latitude: 51.128, longitude: 71.43 } }, posts: {} }; await route.fulfill({ json: locations }); }
    else await route.fulfill({ json: locations });
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${first.id}&map=1`);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await page.getByLabel('Точка для', { exact: true }).selectOption(`object:${first.id}`);
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  await page.getByRole('button', { name: 'Сохранить точку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeVisible();
  await expect(page.getByLabel('Масштаб карты')).toBeVisible();
  await page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true }).locator('canvas').click({ position: { x: 100, y: 100 } });
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  await page.getByLabel('Объект посещения', { exact: true }).selectOption(second.id);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await page.getByLabel('Широта точки', { exact: true }).fill('51.135');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.44');
  release();
  await expect(page.getByRole('button', { name: `Объект: ${first.objectName}`, exact: true })).toBeVisible();
  await expect(page.getByLabel('Точка для', { exact: true })).toHaveValue(`object:${second.id}`);
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.135');
  await expect(page.getByRole('button', { name: 'Сохранить точку', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('multiple objects and older unassigned outdoor posts stay selectable on a narrow screen', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const event = await readEvent(request);
  const first = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', objectName: 'Очень длинное название объекта посещения в городе Астана для проверки узкого экрана', canManagePlacement: true };
  const second = { ...first, id: 'ux-second-visit', objectName: 'Второй объект' };
  const original = event.reconSectorPosts[0];
  const post = { ...original, id: 'ux-legacy-outdoor', post: 'Наружный пост без объекта' };
  delete post.visitObjectId;
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: { ...event, stage: 'PLACEMENT', visitObjects: [first, second], reconSectorPosts: [post] } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: { [first.id]: { latitude: 51.128, longitude: 71.43 }, [second.id]: { latitude: 51.13, longitude: 71.435 } }, posts: { [post.id]: { location: { latitude: 51.129, longitude: 71.431 }, outdoor: true } } } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${first.id}&map=1`);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(map.getByRole('button', { name: 'Объект: Второй объект', exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Объект: Второй объект', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('visit')).toBe(second.id);
  await map.getByRole('button', { name: 'Наружный пост: Наружный пост без объекта', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('visit')).toBe('__unassigned__');
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe(post.id);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await expect(page.getByLabel('Точка для', { exact: true })).toContainText('Наружный пост без объекта');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(businessWrites).toEqual([]);
});

test('approved placement keeps its map usable for reading while editing stays unavailable', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'APPROVAL', documentStatus: 'APPROVED', canManagePlacement: false };
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['event.view'], global_permissions: ['event.view'] } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: { ...event, stage: 'APPROVAL', visitObjects: [visit] } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/placement/map/`, route => route.fulfill({ json: { objects: { [visit.id]: { latitude: 51.128, longitude: 71.43 } }, posts: {} } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}`);
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await map.getByRole('button', { name: 'Приблизить карту', exact: true }).click();
  await expect(map.getByLabel('Масштаб карты')).toHaveText('500 м');
  await expect(page.getByRole('button', { name: 'Указать точку на карте', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('Astana map renders locally and selecting an outdoor post preserves the placement context', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', canManagePlacement: true };
  const original = event.reconSectorPosts[0];
  const post = { ...original, id: 'ux-outdoor', post: 'Наружный пост у входа', visitObjectId: visit.id };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: { ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [post] } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: { [visit.id]: { latitude: 51.128, longitude: 71.43 } }, posts: { [post.id]: { location: { latitude: 51.129, longitude: 71.431 }, outdoor: true } } } }));
  await signIn(page);
  const external: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); await route.abort(); }
    else await route.fallback();
  });
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&back=stage%3DPLACEMENT`);
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(map.getByText('© OpenStreetMap contributors', { exact: true })).toBeVisible();
  // Let the application create its context and paint before reading pixels.
  await expect.poll(() => map.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
    canvas.height === Math.round(canvas.getBoundingClientRect().height * Math.min(devicePixelRatio || 1, 2)),
  ), { timeout: 30000 }).toBe(true);
  await expect.poll(() => map.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let colors = new Set<string>();
    for (let i = 0; i < bytes.length; i += 400) colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
    return colors.size;
  }), { timeout: 30000 }).toBeGreaterThan(8);
  await map.getByRole('button', { name: `Объект: ${visit.objectName}`, exact: true }).click();
  await map.getByRole('button', { name: 'Наружный пост: Наружный пост у входа', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe(post.id);
  expect(new URL(page.url()).searchParams.get('visit')).toBe(visit.id);
  await map.getByRole('button', { name: 'Приблизить карту', exact: true }).click();
  await expect(map.getByLabel('Масштаб карты')).toHaveText('100 м');
  await page.getByRole('button', { name: 'Открыть карточку поста', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Выбранный пост', exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
  expect(businessWrites).toEqual([]);
});
