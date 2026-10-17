import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { ProtectedPerson } from '@/entities/protected-person';

const person: ProtectedPerson = { id: 'ux-person-1', code: 'OL-UX', name: 'Лицо восстановления', category: 'OURS', callsign: 'Проверка', bio: '', country: '', position: '', facts: [], photoUrl: null };
async function prepare(page: Page, options: { catalogFailure?: number; permissionFailure?: number; holdPermissions?: boolean } = {}) {
  const state = { persons: [person], permissions: ['catalog.view', 'dictionary.manage'], catalogFailure: options.catalogFailure ?? 0,
    permissionFailure: options.permissionFailure ?? 0, reads: 0, permissionReads: 0, failedReads: 0, holdSave: false,
    writes: [] as Record<string, unknown>[], releaseSave: () => {}, responses: 0, saveFailure: 0,
    holdPhoto: false, photoFailure: 0, photoWrites: 0, photoResponses: 0, releasePhoto: () => {}, releasePermissions: () => {} };
  const save = new Promise<void>(resolve => { state.releaseSave = resolve; });
  const photo = new Promise<void>(resolve => { state.releasePhoto = resolve; });
  const permissions = new Promise<void>(resolve => { state.releasePermissions = resolve; });
  await page.route('**/api/operations/my-permissions/**', async route => {
    state.permissionReads++;
    if (options.holdPermissions) await permissions;
    return route.fulfill(state.permissionFailure ? { status: state.permissionFailure, json: { detail: 'Отказ проверки прав' } } :
      { json: { permissions: state.permissions, global_permissions: [], roles: [] } });
  });
  await page.route('**/api/ops/protected-persons/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/ops/protected-persons/') {
      state.reads++;
      if (state.catalogFailure) { state.failedReads++; return route.fulfill({ status: state.catalogFailure, json: { detail: 'Отказ чтения каталога' } }); }
      return route.fulfill({ json: { results: state.persons } });
    }
    if ((request.method() === 'PATCH' && url.pathname === '/api/ops/protected-persons/ux-person-1/') ||
        (request.method() === 'POST' && url.pathname === '/api/ops/protected-persons/')) {
      const body = request.postDataJSON(); state.writes.push(body);
      if (state.holdSave) await save;
      state.responses++;
      if (state.saveFailure) return route.fulfill({ status: state.saveFailure, json: { detail: 'Сохранение не выполнено' } });
      const saved = { ...person, ...body, id: request.method() === 'POST' ? 'ux-person-new' : person.id };
      state.persons = state.persons.some(row => row.id === saved.id) ? state.persons.map(row => row.id === saved.id ? saved : row) : [...state.persons, saved];
      return route.fulfill({ json: saved });
    }
    if (request.method() === 'POST' && /^\/api\/ops\/protected-persons\/ux-person-(1|new)\/photo\/$/.test(url.pathname)) {
      state.photoWrites++; if (state.holdPhoto) await photo; state.photoResponses++;
      return route.fulfill(state.photoFailure ? { status: state.photoFailure, json: { detail: 'Фото не сохранено' } } : { json: person });
    }
    return route.fallback();
  });
  await page.clock.install(); await signIn(page); return state;
}
async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('an initial catalog failure retries in place without reporting an empty category', async ({ page, businessWrites }) => {
  const state = await prepare(page, { catalogFailure: 503 }); await page.goto('/security-ops/persons/');
  await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByText('В этой категории пока нет охраняемых лиц.', { exact: true })).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible();
  state.catalogFailure = 0; await retry.click();
  await expect(page.getByRole('heading', { name: person.name, exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('a failed permission check can be retried without reading the protected catalog', async ({ page, businessWrites }) => {
  const state = await prepare(page, { permissionFailure: 503 }); await page.goto('/security-ops/persons/');
  await expect.poll(() => state.permissionReads).toBeGreaterThan(0);
  const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible();
  expect(state.reads).toBe(0); state.permissionFailure = 0; await retry.click();
  await expect(page.getByRole('heading', { name: person.name, exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('a confirmed catalog denial removes the old editor and recovery starts with server values', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Скрытый черновик');
  state.catalogFailure = 403; await reconnect(page); await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Повторить', exact: true }); state.catalogFailure = 0; await retry.click();
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue(person.name); expect(businessWrites).toEqual([]);
});

test('a late save from a closed editor cannot close another newly opened draft', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  state.holdSave = true; await page.getByLabel('ФИО', { exact: true }).fill('Старое сохранение');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect.poll(() => state.writes.length).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить охраняемое лицо', exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Новая форма');
  const received = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/protected-persons/ux-person-1/'); state.releaseSave(); await received;
  await expect.poll(() => state.responses).toBe(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Новая форма'); expect(businessWrites).toEqual([]);
});

test('catalog reads wait for confirmed viewing permission', async ({ page, businessWrites }) => {
  const state = await prepare(page, { holdPermissions: true });
  try {
    await page.goto('/security-ops/persons/'); await expect.poll(() => state.permissionReads).toBeGreaterThan(0);
    await expect(page.getByText('Проверка доступа к каталогу…', { exact: true })).toBeVisible(); expect(state.reads).toBe(0);
    state.releasePermissions(); await expect(page.getByRole('heading', { name: person.name, exact: true })).toBeVisible();
  } finally { state.releasePermissions(); }
  expect(businessWrites).toEqual([]);
});

test('a temporary catalog refresh preserves the selected category and edit draft through inline retry', async ({ page, businessWrites }) => {
  const state = await prepare(page); state.persons = [{ ...person, category: 'FOREIGN' }]; await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Иностранные', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Иностранный черновик');
  state.catalogFailure = 503; await reconnect(page); await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('alert')).toContainText('Черновик сохранён');
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Иностранный черновик');
  state.catalogFailure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0); await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Иностранный черновик');
  await dialog.getByRole('button', { name: 'Назад к списку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Иностранные', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('pending save locks every draft field and a rejected save retains the editable values', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Черновик отказа'); state.holdSave = true; state.saveFailure = 503;
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect.poll(() => state.writes.length).toBe(1);
  for (const label of ['ФИО', 'Позывной', 'Страна', 'Фото', 'Биография', 'Категория']) await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
  state.releaseSave(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Сохранение не выполнено');
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Черновик отказа'); await expect(page.getByLabel('ФИО', { exact: true })).toBeEnabled(); expect(businessWrites).toEqual([]);
});

test('losing editing permission keeps a read-only draft and prevents its submission', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Черновик без управления'); state.permissions = ['catalog.view']; await reconnect(page);
  await expect(page.getByRole('dialog')).toContainText('Редактирование недоступно');
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Черновик без управления');
  await expect(page.getByLabel('ФИО', { exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

const photoFile = { name: 'ux.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=', 'base64') };
test('a pending save keeps its lost authority even after permission returns and does not start photo upload', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Старое управление'); await page.getByLabel('Фото', { exact: true }).setInputFiles(photoFile);
  state.holdSave = true; await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect.poll(() => state.writes.length).toBe(1);
  state.permissions = ['catalog.view']; await reconnect(page); await expect(page.getByRole('dialog')).toContainText('Редактирование недоступно');
  state.permissions = ['catalog.view', 'dictionary.manage']; await reconnect(page); await expect(page.getByRole('dialog').getByText('Редактирование недоступно.', { exact: false })).toHaveCount(0);
  const received = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/protected-persons/ux-person-1/'); state.releaseSave(); await received;
  await expect(page.getByLabel('ФИО', { exact: true })).toBeEnabled(); await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Старое управление');
  expect(state.photoWrites).toBe(0); expect(businessWrites).toEqual([]);
});

test('a late photo response cannot close a newly opened person editor', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Редактировать ' + person.name, exact: true }).click(); await page.getByLabel('Фото', { exact: true }).setInputFiles(photoFile);
  state.holdPhoto = true; await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click(); await expect.poll(() => state.photoWrites).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить охраняемое лицо', exact: true }).click(); await page.getByLabel('ФИО', { exact: true }).fill('Новая форма после фото');
  const received = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/photo/')); state.releasePhoto(); await received;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('ФИО', { exact: true })).toHaveValue('Новая форма после фото'); expect(businessWrites).toEqual([]);
});

test('a successful creation keeps the person fields and facts and opens its selected category', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Добавить охраняемое лицо', exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Новое лицо совместимости'); await page.getByLabel('Страна', { exact: true }).fill('Чили');
  await page.getByLabel('Аллергии', { exact: true }).fill('Нет'); await page.getByRole('button', { name: 'Добавить в справочник', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Новое лицо совместимости', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Иностранные', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes).toEqual([expect.objectContaining({ name: 'Новое лицо совместимости', category: 'FOREIGN', country: 'Чили', facts: [{ key: 'Аллергии', value: 'Нет' }] })]);
  expect(businessWrites).toEqual([]);
});

test('a photo failure after saved creation reports partial success and does not create another person', async ({ page, businessWrites }) => {
  const state = await prepare(page); await page.goto('/security-ops/persons/');
  await page.getByRole('button', { name: 'Добавить охраняемое лицо', exact: true }).click();
  await page.getByLabel('ФИО', { exact: true }).fill('Сохранено без фото'); await page.getByLabel('Фото', { exact: true }).setInputFiles(photoFile); state.photoFailure = 503;
  await page.getByRole('button', { name: 'Добавить в справочник', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Сохранено без фото', exact: true })).toBeVisible();
  await expect(page.getByText('Запись сохранена, но снимок не загрузился. Откройте редактирование и повторите загрузку фото.', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.photoWrites).toBe(1); expect(businessWrites).toEqual([]);
});

for (const denial of [403, 404]) {
  test('protected person catalog: ' + denial + ' followed by retry503 cannot disclose previous cached cards', async ({ page, businessWrites }) => {
    const state = await prepare(page); await page.goto('/security-ops/persons/');
    const card = page.getByRole('heading', { name: person.name, exact: true }); await expect(card).toBeVisible();
    state.catalogFailure = denial; await reconnect(page); await expect(card).toBeHidden();
    const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeEnabled();
    state.catalogFailure = 503; const reads = state.failedReads; await retry.click();
    await expect.poll(() => state.failedReads).toBeGreaterThanOrEqual(reads + 2); await expect(retry).toBeEnabled();
    await expect(card).toBeHidden(); await expect(page.getByRole('dialog')).toHaveCount(0);
    state.catalogFailure = 0; await retry.click(); await expect(card).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
  });
}
