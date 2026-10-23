import { test, expect, signIn, readApi } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent } from '@/entities/security-event';
import type { ProtectedPerson } from '@/entities/protected-person';

const person: ProtectedPerson = { id: 'ux-picker-new', code: 'UX-PICKER', name: 'Лицо выбора ГВО', category: 'FOREIGN', callsign: 'Проверка выбора', bio: '', country: '', position: '', facts: [], photoUrl: null };
async function prepare(page: Page, request: APIRequestContext, mode: 'gvo' | 'edit' | 'create', legacySnapshot = false) {
  const read = (path: string) => readApi(request, path);
  const event = await read('/api/ops/security-events/24/') as SecurityEvent;
  if (legacySnapshot) {
    expect(event.protectedPersonId).toBeTruthy(); expect(event.protectedPersonName).toBeTruthy();
    event.protectedPersons = [];
  }
  expect(event.kind).toBe('FOREIGN'); expect(event.stage).not.toBe('CLOSED');
  const summary = await read('/api/ops/gvo-summaries/' + encodeURIComponent(event.code) + '/');
  const catalog = await read('/api/ops/protected-persons/');
  const state = { event, failure: 0, reads: 0, failedReads: 0 };
  await page.route('**/api/operations/my-permissions/**', route => route.request().method() === 'GET' ? route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }) : route.fallback());
  await page.route(url => url.pathname === '/api/ops/security-events/', route => route.request().method() === 'GET' ? route.fulfill({ json: { results: [event], count: 1, next: null, previous: null, owners: [] } }) : route.fallback());
  await page.route(url => url.pathname === '/api/ops/security-events/24/', route => route.request().method() === 'GET' ? route.fulfill({ json: { ...event, canEditBulletin: true } }) : route.fallback());
  await page.route(url => url.pathname === '/api/ops/gvo-summaries/' + encodeURIComponent(event.code) + '/', route => route.request().method() === 'GET' ? route.fulfill({ json: { ...summary, canEdit: true } }) : route.fallback());
  await page.route(url => url.pathname === '/api/ops/protected-persons/', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.reads++;
    if (state.failure) { state.failedReads++; return route.fulfill({ status: state.failure, json: { detail: 'Отказ справочника лиц' } }); }
    return route.fulfill({ json: { ...catalog, results: [...catalog.results, person] } });
  });
  await page.clock.install(); await signIn(page);
  if (mode === 'create') {
    await page.goto('/security-ops/events/');
    await page.getByRole('button', { name: '+ Создать бюллетень', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Создать бюллетень', exact: true })).toBeVisible();
  } else {
    await page.goto('/security-ops/visits/24/');
    if (mode === 'gvo') {
      await page.locator('main').getByRole('button', { name: 'Редактировать', exact: true }).click();
      await page.locator('[data-slot="gvo-edit-form"]').getByRole('button', { name: '＋ Лицо из справочника', exact: true }).click();
    } else await page.getByRole('button', { name: 'Редактировать бюллетень', exact: true }).click();
  }
  return state;
}
async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}
const choice = (page: Page) => page.getByRole('dialog', { name: 'Охраняемое лицо из справочника', exact: true }).getByRole('button', { name: /^Лицо выбора ГВО/ });
const catalogError = (page: Page) => page.getByText(/Справочник лиц сейчас недоступен|Не удалось загрузить справочник охраняемых лиц/);

for (const denial of [403, 404]) test('GVO picker keeps cached choices hidden through denial' + denial + ' and retry503', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, 'gvo'); await expect(choice(page)).toBeVisible();
  await page.getByLabel('Поиск охраняемого лица', { exact: true }).fill(person.code);
  state.failure = denial; await reconnect(page); await expect(catalogError(page)).toBeVisible(); await expect(choice(page)).toBeHidden();
  const dialog = page.getByRole('dialog', { name: 'Охраняемое лицо из справочника', exact: true }); const retry = dialog.getByRole('button', { name: 'Повторить', exact: true });
  state.failure = 503; const before = state.failedReads; await retry.click(); await expect.poll(() => state.failedReads).toBeGreaterThanOrEqual(before + 2); await expect(retry).toBeEnabled(); await expect(choice(page)).toBeHidden();
  state.failure = 0; await retry.click(); await expect(choice(page)).toBeVisible(); await expect(page.getByLabel('Поиск охраняемого лица', { exact: true })).toHaveValue(person.code);
  expect(businessWrites).toEqual([]);
});

test('a transient GVO picker failure keeps its search and prevents new choices until inline retry', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, 'gvo'); await expect(choice(page)).toBeVisible(); await page.getByLabel('Поиск охраняемого лица', { exact: true }).fill(person.code);
  state.failure = 503; await reconnect(page); await expect(catalogError(page)).toBeVisible(); await expect(choice(page)).toBeDisabled();
  state.failure = 0; await page.getByRole('dialog').getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(choice(page)).toBeEnabled();
  await expect(page.getByLabel('Поиск охраняемого лица', { exact: true })).toHaveValue(person.code); expect(businessWrites).toEqual([]);
});

for (const mode of ['edit', 'create'] as const) test(mode + ': a denied person catalog removes its open options and can recover without reopening the form', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, mode); const dialog = page.getByRole('dialog');
  const combo = dialog.locator('[data-slot="persons-combobox"] input'); await expect(combo).toBeEnabled(); await combo.fill(person.code);
  const option = dialog.getByRole('option').filter({ hasText: person.name }); await expect(option).toBeVisible();
  const saved = state.event.protectedPersons?.[0]; if (mode === 'edit') expect(saved).toBeDefined();
  state.failure = 403; const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/protected-persons/' && response.status() === 403);
  await reconnect(page); await (await failed).finished(); await expect(option).toBeHidden(); await expect(combo).toBeDisabled(); await expect(combo).toHaveAttribute('aria-expanded', 'false');
  if (mode === 'edit') await expect(dialog.getByRole('button', { name: 'Убрать ' + saved!.name + ' из списка охраняемых лиц', exact: true })).toBeVisible();
  state.failure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(combo).toBeEnabled();
  await expect(combo).toHaveValue(person.code); await combo.focus(); await expect(option).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('a creation keeps its chosen person ID without retaining forbidden catalogue labels', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, 'create'); const dialog = page.getByRole('dialog'); const combo = dialog.locator('[data-slot="persons-combobox"] input');
  await combo.fill(person.code); await dialog.getByRole('option').filter({ hasText: person.name }).getByRole('button').click();
  await expect(dialog.getByRole('button', { name: 'Убрать ' + person.name + ' из списка охраняемых лиц', exact: true })).toBeVisible();
  state.failure = 403; await reconnect(page); await expect(combo).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Убрать ' + person.id + ' из списка охраняемых лиц', exact: true })).toBeVisible();
  state.failure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать ' + person.name + ' из списка охраняемых лиц', exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('editing a legacy main-person snapshot keeps its saved name through catalogue denial', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, 'edit', true); const dialog = page.getByRole('dialog'); const combo = dialog.locator('[data-slot="persons-combobox"] input');
  const selected = dialog.getByRole('button', { name: 'Убрать ' + state.event.protectedPersonName + ' из списка охраняемых лиц', exact: true }); await expect(selected).toBeVisible();
  state.failure = 403; await reconnect(page); await expect(combo).toBeDisabled(); await expect(selected).toBeVisible();
  state.failure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(combo).toBeEnabled(); await expect(selected).toBeVisible(); expect(businessWrites).toEqual([]);
});

for (const width of [1440, 390, 320]) test('bulletin editor with saved person details fits its dialog at ' + width + 'px', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await prepare(page, request, 'edit');
  const dialog = page.getByRole('dialog'); await expect(dialog.getByTestId('person-details')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await expect.poll(() => dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  expect(businessWrites).toEqual([]);
});

test('a GVO edit form with its saved group fits a 320px screen', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await prepare(page, request, 'gvo'); await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="gvo-edit-form"]')).toBeVisible();
  await expect(page.locator('[data-slot="gvo-group"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="gvo-person"]').first()).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await expect.poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBe(0); expect(businessWrites).toEqual([]);
});

test('a saved foreign GVO summary fits a 320px screen before editing', async ({ page, request, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await prepare(page, request, 'edit'); await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Сводные данные ГВО', exact: true })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await expect.poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBe(0); expect(businessWrites).toEqual([]);
});
