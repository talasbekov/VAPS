import { test, expect, signIn, readEvent } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent } from '@/entities/security-event';

async function prepare(page: Page, request: APIRequestContext, frozen = true, canManage = true) {
  const source = await readEvent(request);
  const visit = { ...source.visitObjects[0], stage: frozen ? 'ACKNOWLEDGEMENT' as const : 'APPROVAL' as const,
    documentStatus: frozen ? 'APPROVED' as const : 'DRAFT' as const, canManagePlacement: canManage };
  const original = source.reconSectorPosts[0];
  const event: SecurityEvent = { ...source, stage: visit.stage, visitObjects: [visit],
    reconSectorPosts: [
      { ...original, id: 'read-first', post: 'Главный вход', sector: 'Сектор А', comment: 'Вход — проверка документов', need: 1, visitObjectId: visit.id },
      { ...original, id: 'read-second', post: 'Наружный вход', sector: 'Сектор Б', comment: 'Наружный вход — наблюдение', need: 2, visitObjectId: visit.id },
    ],
    placementAssignments: [{ ...source.placementAssignments[0], id: 'read-assignment', postId: 'read-first' }],
  };
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: event }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}`);
  return { event, visit, placement: page.getByRole('region', { name: 'Расстановка сил', exact: true }) };
}

test('a signed placement supports post navigation and search while all editing stays unavailable', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { placement } = await prepare(page, request);
  const tree = placement.getByRole('complementary', { name: 'Дерево постов' });
  const post = tree.locator('[data-drop-post="read-second"]').getByRole('button').first();
  await expect(post).toBeEnabled();
  await post.click();
  await expect(placement.getByRole('region', { name: 'Выбранный пост', exact: true })).toContainText('Наружный вход');
  await expect.poll(() => new URL(page.url()).searchParams.get('post')).toBe('read-second');
  await tree.getByRole('textbox', { name: 'Поиск постов', exact: true }).fill('Главный');
  await expect(tree.locator('[data-drop-post]')).toHaveCount(1);
  await placement.getByRole('button', { name: 'Показать выбранный пост', exact: true }).click();
  await expect(tree.locator('[data-drop-post]')).toHaveCount(2);
  await expect(placement.getByLabel('Комментарий к посту')).not.toBeEditable();
  await expect(placement.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await expect(placement.getByRole('button', { name: 'Распределить автоматически', exact: true })).toBeDisabled();
  const passport = placement.getByRole('link', { name: 'Паспорт поста →', exact: true });
  await passport.focus();
  await expect(passport).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('signed-placement-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

test('a reader cannot type a post comment even when the placement document is still a draft', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request, false, false);
  const comment = placement.getByLabel('Комментарий к посту');
  await expect(comment).not.toBeEditable();
  await expect(comment).toHaveValue('Вход — проверка документов');
  await expect(placement).toContainText('Изменение расстановки этого объекта недоступно для вашей учётной записи');
  await expect(placement.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await expect(placement.getByRole('button', { name: /^Удалить с поста: / }).first()).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('an authorized editor can still return from approval to edit a draft placement', async ({ page, request, businessWrites }) => {
  const { placement } = await prepare(page, request, false, true);
  await expect(page.locator('[data-slot="stage-view-notice"]')).toContainText('Правка расстановки открыта');
  await expect(placement.getByRole('button', { name: /^Удалить с поста: / }).first()).toBeEnabled();
  await expect(placement.getByLabel('Комментарий к посту')).not.toBeEditable();
  await expect(placement).toContainText('Комментарий и снятие постов доступны на этапе «Расстановка»');
  await placement.getByRole('button', { name: /^Роль и секция: / }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(businessWrites).toEqual([]);
});
