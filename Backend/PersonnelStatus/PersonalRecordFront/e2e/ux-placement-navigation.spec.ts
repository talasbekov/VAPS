import { test, expect, signIn, readEvent } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent } from '@/entities/security-event';

async function prepare(page: Page, request: APIRequestContext, suffix = '') {
  const source = await readEvent(request);
  expect(source.placementAssignments.length, 'Read-only fixture requires an existing assignment shape').toBeGreaterThan(0);
  const visit = { ...source.visitObjects[0], stage: 'PLACEMENT' as const, documentStatus: 'DRAFT' as const, canManagePlacement: true };
  const original = source.reconSectorPosts[0];
  const event: SecurityEvent = { ...source, stage: 'PLACEMENT', visitObjects: [visit],
    reconSectorPosts: [
      { ...original, id: 'ux-full', sector: 'Сектор А', post: 'Главный вход', comment: 'Комментарий главного входа', need: 1, visitObjectId: visit.id },
      { ...original, id: 'ux-short', sector: 'Сектор Б', post: 'Наружный вход', comment: 'Комментарий наружного входа', task: 'Наблюдение', need: 2, visitObjectId: visit.id },
      { ...original, id: 'ux-zero', sector: 'Сектор В', post: 'Резерв', need: 0, visitObjectId: visit.id },
    ],
    placementAssignments: [{ ...source.placementAssignments[0], id: 'ux-assignment', postId: 'ux-full' }],
  };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: event }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&back=stage%3DPLACEMENT${suffix}`);
  const placement = page.getByRole('region', { name: 'Расстановка сил', exact: true });
  await expect(placement).toBeVisible();
  return { event, visit, placement };
}

test('chosen post is shareable and survives reload without losing object, step or registry context', async ({ page, request, businessWrites }) => {
  const { placement, visit } = await prepare(page, request);
  await placement.locator('[data-drop-post="ux-short"]').getByRole('button').first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe('ux-short');
  expect(new URL(page.url()).searchParams.get('visit')).toBe(visit.id);
  expect(new URL(page.url()).searchParams.get('step')).toBe('2');
  expect(new URL(page.url()).searchParams.get('back')).toBe('stage=PLACEMENT');
  await page.reload();
  await expect(placement.getByRole('region', { name: 'Выбранный пост' }).getByText('Наружный вход', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('post search and shortage filter narrow the tree without altering the total staffing need', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request);
  const tree = placement.getByRole('complementary', { name: 'Дерево постов' });
  await expect(tree.locator('[data-drop-post]')).toHaveCount(3);
  const search = tree.getByRole('textbox', { name: 'Поиск постов', exact: true });
  await search.fill('сектор б');
  await expect(tree.locator('[data-drop-post]')).toHaveCount(1);
  await expect(tree.locator('[data-drop-post="ux-short"]')).toBeVisible();
  await search.fill('');
  await tree.getByRole('button', { name: 'Только недобор', exact: true }).click();
  await expect(tree.locator('[data-drop-post]')).toHaveCount(1);
  await expect(tree.locator('[data-drop-post="ux-short"]')).toBeVisible();
  await expect(placement.getByRole('group', { name: 'Сводка расстановки' })).toContainText(/3\s*требуется/);
  await search.fill('нет такого поста');
  await expect(tree.getByText('Посты не найдены.', { exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Сбросить фильтры постов', exact: true }).click();
  await expect(tree.locator('[data-drop-post]')).toHaveCount(3);
  expect(businessWrites).toEqual([]);
});

test('unknown post link falls back to a real post and clears the invalid selection', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request, '&post=other-object-post');
  await expect(placement.getByRole('region', { name: 'Выбранный пост' }).getByText('Главный вход', { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBeNull();
  expect(businessWrites).toEqual([]);
});

test('empty candidate search offers a reset that restores the actual accepted roster', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request);
  const search = placement.getByRole('textbox', { name: 'Поиск кандидатов', exact: true });
  await search.fill('несуществующий кандидат 123456');
  await expect(placement.getByText(/Под выбранные фильтры.*никто не подходит/)).toBeVisible();
  await placement.getByRole('button', { name: 'Сбросить фильтры кандидатов', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(placement.getByText(/Под выбранные фильтры.*никто не подходит/)).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('selecting another post on the map does not carry over an unsaved comment', async ({ page, request, businessWrites }) => {
  const { event, placement } = await prepare(page, request);
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/placement/map/`, route => route.fulfill({ json: { objects: {}, posts: { 'ux-short': { location: { latitude: 51.129, longitude: 71.431 }, outdoor: true } } } }));
  const comment = placement.getByRole('textbox', { name: 'Комментарий к посту', exact: true });
  await expect(comment).toHaveValue('Комментарий главного входа');
  await comment.fill('Несохранённый комментарий предыдущего поста');
  await placement.getByRole('button', { name: 'Карта Астаны', exact: true }).click();
  await page.getByRole('button', { name: 'Наружный пост: Наружный вход', exact: true }).click();
  await expect(placement.getByRole('region', { name: 'Выбранный пост' }).getByRole('heading', { name: 'Наружный вход', exact: true })).toBeVisible();
  await expect(comment).toHaveValue('Комментарий наружного входа');
  expect(businessWrites).toEqual([]);
});

test('a selected post hidden by the shortage filter remains selected and offers a way back', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request, '&post=ux-full');
  await placement.getByRole('button', { name: 'Только недобор', exact: true }).click();
  await expect(placement.getByRole('region', { name: 'Выбранный пост' }).getByRole('heading', { name: 'Главный вход', exact: true })).toBeVisible();
  await placement.getByRole('button', { name: 'Показать выбранный пост', exact: true }).click();
  await expect(placement.locator('[data-drop-post="ux-full"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('post')).toBe('ux-full');
  expect(businessWrites).toEqual([]);
});

test('unknown object and post parameters normalize together without losing registry context', async ({ page, request, businessWrites }) => {
  const { visit } = await prepare(page, request);
  const url = new URL(page.url());
  url.searchParams.set('visit', 'unknown-object');
  url.searchParams.set('post', 'unknown-post');
  await page.goto(url.href);
  await expect.poll(() => new URL(page.url()).searchParams.get('visit')).toBe(visit.id);
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBeNull();
  expect(new URL(page.url()).searchParams.get('step')).toBe('2');
  expect(new URL(page.url()).searchParams.get('back')).toBe('stage=PLACEMENT');
  expect(businessWrites).toEqual([]);
});
