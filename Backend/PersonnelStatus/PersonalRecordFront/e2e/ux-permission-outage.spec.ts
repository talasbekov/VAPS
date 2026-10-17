import { test, expect, signIn } from './ux-fixture';
import { readEventsStore } from '@/mocks/ops/security-events-handlers';
import type { Page } from '@playwright/test';

const permissionPath = '/api/operations/my-permissions/';

function permissionRefresh(page: Page, status: number) {
  return page.waitForResponse(response => new URL(response.url()).pathname === permissionPath && response.status() === status);
}

async function prepareDutyDraft(page: Page) {
  await page.route('**/api/ops/duty-register/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/kinds/')) return route.fulfill({ json: { results: [
      { code: 'GBR', label: 'ГБР', label_kk: '', description: '', is_active: true },
    ] } });
    if (pathname.endsWith('/choices/')) return route.fulfill({ json: { results: [
      { employee_id: 7, employee_name: 'Outage duty employee', division_id: 4, division_name: 'Outage division', position_name: 'Сотрудник' },
    ], count: 1, page: 1, page_size: 25 } });
    if (pathname !== '/api/ops/duty-register/') return route.fallback();
    return route.fulfill({ json: {
      period: { from: '2026-10-15', to: '2026-10-15' }, generated_at: '2026-10-15T14:00:00+05:00', time_zone: 'Asia/Qyzylorda',
      rows: [], by_kind: [], by_employee: [], filters: { divisions: [], employees: [] },
      pagination: { count: 0, page: 1, pages: 1, page_size: 25 },
      summary: { record_count: 0, employee_count: 0, completed_count: 0, active_count: 0, cancelled_count: 0,
        unconfirmed_count: 0, attention_count: 0, overlap_count: 0, missing_kind_count: 0, unknown_planned_count: 0,
        unknown_actual_count: 0, confirmed_actual_count: 0, planned_minutes: 0, actual_record_minutes: 0, actual_minutes: 0 },
    } });
  });
  await signIn(page);
  await page.goto('/security-ops/duty-register/?section=records&from=2026-10-15&to=2026-10-15');
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая запись дежурства', exact: true });
  await dialog.getByRole('button', { name: /Outage duty employee/ }).click();
  await dialog.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await dialog.getByLabel('Плановое начало', { exact: true }).fill('2026-10-15T08:00');
  await dialog.getByLabel('Плановое завершение', { exact: true }).fill('2026-10-15T20:00');
  await dialog.getByRole('textbox', { name: 'Примечание', exact: true }).fill('UNSENT_PERMISSION_OUTAGE_NOTE');
  return dialog;
}

test('temporary permission failure hides the duty dialog and restores its unsent note after retry', async ({ page, businessWrites }) => {
  let permissionStatus = 200;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: permissionStatus, json: permissionStatus === 200
    ? { permissions: ['duty.view', 'duty.manage'], global_permissions: ['duty.view', 'duty.manage'], roles: [] }
    : { detail: 'Temporary permission failure' } }));
  const dialog = await prepareDutyDraft(page);
  const note = dialog.getByRole('textbox', { name: 'Примечание', exact: true });
  await expect(note).toHaveValue('UNSENT_PERMISSION_OUTAGE_NOTE');
  permissionStatus = 503;
  const failed = permissionRefresh(page, 503);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await failed;
  await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-slot="dialog-content"] textarea').last()).toHaveValue('UNSENT_PERMISSION_OUTAGE_NOTE');
  await expect(page.getByRole('button', { name: 'Сохранить запись', exact: true })).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Повторить', exact: true });
  await expect(retry).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="dialog-content"] textarea').last()).toHaveValue('UNSENT_PERMISSION_OUTAGE_NOTE');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(retry).toBeFocused();
  permissionStatus = 200;
  const recovered = permissionRefresh(page, 200);
  await page.keyboard.press('Enter');
  await recovered;
  await expect(note).toBeVisible();
  await expect(note).toHaveValue('UNSENT_PERMISSION_OUTAGE_NOTE');
  expect(businessWrites).toEqual([]);
});

test('explicit permission denial removes the duty draft and a later 503 cannot reveal it', async ({ page, businessWrites }) => {
  let permissionStatus = 200;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: permissionStatus, json: permissionStatus === 200
    ? { permissions: ['duty.view', 'duty.manage'], global_permissions: ['duty.view', 'duty.manage'], roles: [] }
    : { detail: 'Denied or temporarily unavailable' } }));
  const dialog = await prepareDutyDraft(page);
  permissionStatus = 403;
  const denied = permissionRefresh(page, 403);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await denied;
  await expect(dialog).toHaveCount(0);
  permissionStatus = 503;
  const failed = permissionRefresh(page, 503);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await failed;
  await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('temporary permission failure preserves an unsaved map point while hiding protected map controls', async ({ page, businessWrites }) => {
  const event = structuredClone(readEventsStore()[0]);
  const visit = { ...event.visitObjects[0], stage: 'PLACEMENT', documentStatus: 'DRAFT', canManagePlacement: true };
  const post = { id: 'outage-map-post', sector: 'Сектор А', post: 'Проверочный пост', task: 'Охрана', need: 2,
    requirements: '', result: 'MATCHES' as const, comment: '', sourceSectorId: null, sourcePostId: null, minRating: null, visitObjectId: visit.id };
  let permissionStatus = 200;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: permissionStatus, json: permissionStatus === 200
    ? { permissions: ['*'], global_permissions: ['*'], roles: [] } : { detail: 'Temporary permission failure' } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: {
    ...event, stage: 'PLACEMENT', visitObjects: [visit], reconSectorPosts: [post],
  } }));
  await page.route(url => url.pathname.endsWith('/placement/map/'), route => route.fulfill({ json: { objects: {}, posts: {} } }));
  await signIn(page);
  await page.goto(`/security-ops/events/${event.id}/?step=2&visit=${visit.id}&map=1`);
  const map = page.getByRole('region', { name: 'Офлайн-карта Астаны', exact: true });
  await page.getByRole('button', { name: 'Указать точку на карте', exact: true }).click();
  const latitude = page.getByLabel('Широта точки', { exact: true });
  await latitude.fill('51.125432');
  await page.getByLabel('Долгота точки', { exact: true }).fill('71.435678');
  await expect(page.getByRole('button', { name: 'Сохранить точку', exact: true })).toBeEnabled();
  permissionStatus = 503;
  const failed = permissionRefresh(page, 503);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await failed;
  await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible();
  await expect(map).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить точку', exact: true })).toHaveCount(0);
  permissionStatus = 200;
  const recovered = permissionRefresh(page, 200);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await recovered;
  await expect(latitude).toBeVisible();
  await expect(latitude).toHaveValue('51.125432');
  await expect(page.getByLabel('Долгота точки', { exact: true })).toHaveValue('71.435678');
  expect(businessWrites).toEqual([]);
});
