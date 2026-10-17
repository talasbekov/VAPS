import { test, expect, signIn, readEvent } from './ux-fixture';

test('street search finds real local geometry without internet and remains usable on a narrow screen', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.host); return route.abort(); }
    return route.fallback();
  });
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${event.visitObjects[0].id}&map=1`);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  const search = map.getByRole('searchbox', { name: 'Поиск улицы или района', exact: true });
  await search.fill('туран');
  const street = map.getByRole('button', { name: /Показать на карте: проспект Туран/i });
  await street.focus();
  await street.press('Enter');
  await expect(search).toBeFocused();
  await expect(map.getByLabel('Масштаб карты')).toHaveText('200 м');
  await expect(map.getByText('Найдено: проспект Туран', { exact: true })).toBeVisible();
  await search.fill('нет такой улицы 12345');
  await expect(map.getByText('Улицы и районы не найдены.', { exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'Очистить поиск на карте', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('map-street-search-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(external).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('finding a street with the keyboard moves the map and preserves the unsaved location draft', async ({ page, request, businessWrites }) => {
  const event = await readEvent(request);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: { ...event, stage: 'PLACEMENT', visitObjects: [visit] } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: {}, posts: {} } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&map=1`);
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  await page.getByLabel('Широта точки', { exact: true }).fill('51.128');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.43');
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  const search = map.getByRole('searchbox', { name: 'Поиск улицы или района', exact: true });
  await search.fill('проспект туран');
  await search.press('Enter');
  await expect(map.getByText('Найдено: проспект Туран', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Широта точки', { exact: true })).toHaveValue('51.128');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.43');
  expect(businessWrites).toEqual([]);
});
