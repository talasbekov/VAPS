import { test, expect, signIn, readEvent } from './ux-fixture';

test('reopening the local map reuses its city geometry within the same document', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const loads = { manifest: 0, geometry: 0 };
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/maps/astana/manifest.json') loads.manifest++;
    if (path === '/maps/astana/geometry.json') loads.geometry++;
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${event.visitObjects[0].id}&map=1`);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(map.getByRole('searchbox', { name: 'Поиск улицы или района', exact: true })).toBeEnabled();
  expect(loads).toEqual({ manifest: 1, geometry: 1 });
  await page.getByRole('button', { name: 'Список постов', exact: true }).click();
  await expect(map).toHaveCount(0);
  await page.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  const search = map.getByRole('searchbox', { name: 'Поиск улицы или района', exact: true });
  await expect(search).toBeEnabled();
  expect(loads, 'The public city asset must be loaded and parsed once per document').toEqual({ manifest: 1, geometry: 1 });
  await search.fill('проспект туран');
  await search.press('Enter');
  await expect(map.getByText('Найдено: проспект Туран', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a failed city asset can be retried without a stuck shared load', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  let attempts = 0;
  await page.route('**/maps/astana/geometry.json', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 503, json: { detail: 'Temporary local failure' } }) : route.continue();
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${event.visitObjects[0].id}&map=1`);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await expect(map.getByRole('alert')).toContainText('Не удалось загрузить офлайн-карту.');
  await map.getByRole('button', { name: 'Повторить загрузку карты', exact: true }).click();
  await expect(map.getByRole('searchbox', { name: 'Поиск улицы или района', exact: true })).toBeEnabled();
  expect(attempts).toBe(2);
  expect(businessWrites).toEqual([]);
});
