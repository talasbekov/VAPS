import { test, expect, signIn, readEvent } from './ux-fixture';

test.beforeEach(async ({ page, businessWrites }) => {
  // Observe before routing: a permissive response mock must not hide writes.
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && !path.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      businessWrites.push(`${request.method()} ${path}`);
    }
  });
});

test('a post without coordinates is selectable beside the map and its staffing card stays alongside it', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const first = { ...event.reconSectorPosts[0], visitObjectId: visit.id };
  const second = { ...first, id: '9007199254741093', post: 'Вход со стороны парка', need: 2 };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: {
    ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [first, second],
  } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: {
    objects: { [visit.id]: { latitude: 51.128, longitude: 71.43 } }, posts: {},
  } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&map=1&back=stage%3DPLACEMENT`);
  const picker = page.getByRole('combobox', { name: 'Объект или пост на карте', exact: true });
  await picker.selectOption(`post:${second.id}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe(second.id);
  const card = page.getByRole('region', { name: 'Выбранный пост', exact: true });
  await expect(card).toContainText(second.post);
  await expect(page.getByText('У выбранного поста ещё нет точки на карте.', { exact: true })).toBeVisible();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await picker.scrollIntoViewIfNeeded();
  const mapBox = await map.boundingBox(), cardBox = await card.boundingBox();
  expect(mapBox).not.toBeNull(); expect(cardBox).not.toBeNull();
  expect(cardBox!.x).toBeGreaterThanOrEqual(mapBox!.x + mapBox!.width);
  expect(Math.abs(cardBox!.y - mapBox!.y)).toBeLessThan(220);
  await page.screenshot({ path: test.info().outputPath('map-workspace-desktop.png'), animations: 'disabled' });
  await card.getByRole('button', { name: 'Подобрать сотрудника', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Поиск кандидатов', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await expect(page.getByLabel('Точка для', { exact: true })).toHaveValue(`post:${second.id}`);
  await map.locator('canvas').click({ position: { x: 160, y: 150 } });
  await expect(page.getByRole('button', { name: 'Сохранить точку', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Широта точки', { exact: true })).not.toHaveValue('');
  await expect.poll(async () => {
    const bounds = await page.getByRole('button', { name: 'Сохранить точку', exact: true }).boundingBox();
    return !!bounds && bounds.y >= 0 && bounds.y + bounds.height <= 1000;
  }).toBe(true);
  await page.screenshot({ path: test.info().outputPath('map-point-editor-desktop.png'), animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

test('map browsing and shortage navigation work on a narrow screen without changing the records', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const first = { ...event.reconSectorPosts[0], visitObjectId: visit.id, need: 0 };
  const second = { ...first, id: 'ux-shortage', post: 'Пост с недобором', need: 2 };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: {
    ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [first, second], placementAssignments: [],
  } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: {}, posts: {} } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&post=${first.id}&map=1`);
  await page.getByRole('button', { name: /^Следующий пост с недобором/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe(second.id);
  await expect(page.getByRole('combobox', { name: 'Объект или пост на карте', exact: true })).toHaveValue(`post:${second.id}`);
  await expect(page.getByRole('region', { name: 'Выбранный пост', exact: true })).toContainText(second.post);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'Объект или пост на карте', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('map-workspace-mobile.png'), animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

test('choosing a saved post recenters it and wheel zoom preserves the point under the pointer', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const post = { ...event.reconSectorPosts[0], visitObjectId: visit.id };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: {
    ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [post],
  } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: {
    objects: {}, posts: { [post.id]: { location: { latitude: 51.128, longitude: 71.43 }, outdoor: true } },
  } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&map=1`);
  await page.getByRole('button', { name: 'К выбранной точке', exact: true }).click();
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(map.getByLabel('Масштаб карты')).toHaveText('200 м');
  const marker = map.getByRole('button', { name: `Наружный пост: ${post.post}`, exact: true });
  await marker.scrollIntoViewIfNeeded();
  const before = await marker.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  // A marker is a real button over the canvas; zoom should work under it too.
  await page.mouse.wheel(0, -100);
  await expect(map.getByLabel('Масштаб карты')).toHaveText('100 м');
  const after = await marker.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  const canvas = map.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  const anchor = { x: after!.x + after!.width / 2 + 110, y: after!.y + after!.height / 2 - 60 };
  await canvas.dblclick({ position: { x: anchor.x - canvasBox!.x, y: anchor.y - canvasBox!.y } });
  await expect(map.getByLabel('Масштаб карты')).toHaveText('50 м');
  const last = await marker.boundingBox();
  expect(Math.abs(last!.x + last!.width / 2 - (2 * (after!.x + after!.width / 2) - anchor.x))).toBeLessThan(2);
  expect(Math.abs(last!.y + last!.height / 2 - (2 * (after!.y + after!.height / 2) - anchor.y))).toBeLessThan(2);
  expect(businessWrites).toEqual([]);
});

test('an explicit post selection in the list takes precedence over an earlier map object selection', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const first = { ...event.reconSectorPosts[0], visitObjectId: visit.id };
  const second = { ...first, id: 'ux-other-post', post: 'Другой пост' };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: {
    ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [first, second],
  } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: {}, posts: {} } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&map=1`);
  const picker = page.getByRole('combobox', { name: 'Объект или пост на карте', exact: true });
  await picker.selectOption(`object:${visit.id}`);
  await expect(picker).toHaveValue(`object:${visit.id}`);
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await page.locator('[id="placement-post-ux-other-post"]').click();
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await expect(picker).toHaveValue(`post:${second.id}`);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await expect(page.getByLabel('Точка для', { exact: true })).toHaveValue(`post:${second.id}`);
  expect(businessWrites).toEqual([]);
});
