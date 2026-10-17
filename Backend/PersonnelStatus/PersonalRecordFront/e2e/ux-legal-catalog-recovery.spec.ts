import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { LegalDocument } from '@/entities/legal-document';

const document: LegalDocument = { id: 'ux-legal-1', kind: 'ORDER', code: 'UX-LEGAL', title: 'Документ восстановления', description: 'Контроль описания', revision: '1', status: 'IN_FORCE', pages: 3, version: 1, file: null, fileUrl: null };
async function prepare(page: Page, options: { holdPermissions?: boolean; catalogFailure?: number; permissionFailure?: number } = {}) {
  const state = { permissions: ['catalog.view', 'legal.manage'], globalPermissions: ['legal.manage'], catalogFailure: options.catalogFailure ?? 0,
    permissionFailure: options.permissionFailure ?? 0, reads: 0, failedReads: 0, permissionReads: 0, documents: [document],
    canManage: true, holdSave: false, releaseSave: () => {}, releasePermissions: () => {}, writes: [] as string[], responses: 0, saveFailure: 0 };
  const save = new Promise<void>(resolve => { state.releaseSave = resolve; });
  const permissions = new Promise<void>(resolve => { state.releasePermissions = resolve; });
  await page.route('**/api/operations/my-permissions/**', async route => {
    state.permissionReads++; if (options.holdPermissions) await permissions;
    return route.fulfill(state.permissionFailure ? { status: state.permissionFailure, json: { detail: 'Отказ проверки прав' } } :
      { json: { permissions: state.permissions, global_permissions: state.globalPermissions, roles: [] } });
  });
  await page.route('**/api/ops/legal-documents/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/ops/legal-documents/') {
      state.reads++;
      if (state.catalogFailure) { state.failedReads++; return route.fulfill({ status: state.catalogFailure, json: { detail: 'Отказ чтения нормативной базы' } }); }
      return route.fulfill({ json: { results: state.documents, canManage: state.canManage, maxFileSizeBytes: 10 * 1024 * 1024 } });
    }
    if ((request.method() === 'PATCH' && pathname === '/api/ops/legal-documents/ux-legal-1/') || (request.method() === 'POST' && pathname === '/api/ops/legal-documents/')) {
      state.writes.push(request.postData() ?? ''); if (state.holdSave) await save; state.responses++;
      return route.fulfill(state.saveFailure ? { status: state.saveFailure, json: { detail: 'Сохранение не выполнено' } } :
        { json: { ...document, id: request.method() === 'POST' ? 'ux-legal-new' : document.id, version: 2 } });
    }
    return route.fallback();
  });
  await page.clock.install(); await signIn(page); return state;
}
async function reconnect(page: Page) {
  const permissionResponse = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/operations/my-permissions/');
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await permissionResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function openEditor(page: Page) {
  await page.goto('/security-ops/laws/?kind=ORDER');
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
}

test('a transient legal catalog failure keeps the draft and offers retry inside its dialog', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page);
  await page.getByLabel('Название', { exact: true }).fill('Несохранённое название');
  state.catalogFailure = 503; await reconnect(page); await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('alert')).toContainText('Черновик сохранён');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Несохранённое название');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  state.catalogFailure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0); await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Несохранённое название');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Приказ', exact: true })).toHaveAttribute('aria-pressed', 'true'); expect(businessWrites).toEqual([]);
});

test('a confirmed legal catalog denial hides the old editor and does not reopen it on recovery', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); await page.getByLabel('Название', { exact: true }).fill('Скрытый черновик');
  state.catalogFailure = 403; await reconnect(page); await expect.poll(() => state.failedReads).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state.catalogFailure = 0; await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(document.title); expect(businessWrites).toEqual([]);
});

test('a late document save cannot close a new editor after viewing permission is revoked and returned', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); state.holdSave = true;
  await page.getByLabel('Название', { exact: true }).fill('Старая отправка'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  state.permissions = []; await reconnect(page); await expect(page.getByRole('dialog')).toHaveCount(0);
  state.permissions = ['catalog.view', 'legal.manage']; await reconnect(page);
  // The baseline revives its previous editor; close it to isolate the stale
  // save callback from the separate recovery/auto-reopen contract.
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить документ', exact: true }).click(); await page.getByLabel('Название', { exact: true }).fill('Новая форма');
  const received = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/legal-documents/ux-legal-1/'); state.releaseSave(); await received;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Новая форма'); expect(businessWrites).toEqual([]);
});

test('legal catalog reads wait for confirmed viewing permission', async ({ page, businessWrites }) => {
  const state = await prepare(page, { holdPermissions: true });
  try {
    await page.goto('/security-ops/laws/'); await expect.poll(() => state.permissionReads).toBeGreaterThan(0);
    await expect(page.getByText('Проверка доступа к нормативной базе…', { exact: true })).toBeVisible(); expect(state.reads).toBe(0);
    state.releasePermissions(); await expect(page.getByRole('heading', { name: document.title, exact: true })).toBeVisible();
  } finally { state.releasePermissions(); }
  expect(businessWrites).toEqual([]);
});

test('an initial legal catalog failure retries without claiming that no documents exist', async ({ page, businessWrites }) => {
  const state = await prepare(page, { catalogFailure: 503 }); await page.goto('/security-ops/laws/');
  await expect.poll(() => state.failedReads).toBeGreaterThan(0); await expect(page.getByText('Документы не найдены', { exact: true })).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible();
  state.catalogFailure = 0; await retry.click();
  await expect(page.getByRole('heading', { name: document.title, exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('legal permission recovery retries without reading the unavailable catalog', async ({ page, businessWrites }) => {
  const state = await prepare(page, { permissionFailure: 503 }); await page.goto('/security-ops/laws/');
  const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible(); expect(state.reads).toBe(0);
  state.permissionFailure = 0; await retry.click(); await expect(page.getByRole('heading', { name: document.title, exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('losing only legal management preserves the current draft for reading and blocks its submission', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); await page.getByLabel('Название', { exact: true }).fill('Черновик без управления');
  state.globalPermissions = []; await reconnect(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('только для просмотра');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Черновик без управления');
  await expect(page.getByLabel('Название', { exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a pending legal save locks all draft fields and dismissal while a rejection retains the draft', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); state.holdSave = true; state.saveFailure = 503;
  await page.getByLabel('Название', { exact: true }).fill('Ожидающее название'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1); const dialog = page.getByRole('dialog');
  for (const label of ['Название', 'Номер документа', 'Файл документа']) await expect(dialog.getByLabel(label, { exact: true })).toBeDisabled();
  for (const name of ['Вид документа', 'Состояние']) await expect(dialog.getByRole('combobox', { name, exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled(); await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); state.releaseSave();
  await expect(dialog.getByRole('alert')).toBeVisible(); await expect(page.getByLabel('Название', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Ожидающее название'); expect(businessWrites).toEqual([]);
});

test('a pending legal save never regains its old callback authority after management permission returns', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); state.holdSave = true;
  await page.getByLabel('Название', { exact: true }).fill('Черновик прежней отправки'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1); state.globalPermissions = []; await reconnect(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('только для просмотра'); state.globalPermissions = ['legal.manage']; await reconnect(page);
  const received = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/ops/legal-documents/ux-legal-1/'); state.releaseSave(); await received;
  await expect(page.getByLabel('Название', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Черновик прежней отправки');
  expect(businessWrites).toEqual([]);
});

test('a temporary legal read failure does not discard the confirmed success of an already submitted save', async ({ page, businessWrites }) => {
  const state = await prepare(page); await openEditor(page); state.holdSave = true;
  await page.getByLabel('Название', { exact: true }).fill('Уже отправленный документ'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1); state.catalogFailure = 503; await reconnect(page);
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('alert')).toContainText('Черновик сохранён');
  state.catalogFailure = 0; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(dialog.getByRole('alert')).toHaveCount(0);
  state.releaseSave(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Документ сохранён: ' + document.code); expect(state.writes).toHaveLength(1); expect(businessWrites).toEqual([]);
});

for (const denial of [403, 404]) {
  test('legal catalog: ' + denial + ' followed by retry503 cannot disclose previous cached cards', async ({ page, businessWrites }) => {
    const state = await prepare(page); await page.goto('/security-ops/laws/');
    const card = page.getByRole('heading', { name: document.title, exact: true }); await expect(card).toBeVisible();
    state.catalogFailure = denial; await reconnect(page); await expect(card).toBeHidden();
    const retry = page.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeEnabled();
    state.catalogFailure = 503; const reads = state.failedReads; await retry.click();
    await expect.poll(() => state.failedReads).toBeGreaterThanOrEqual(reads + 2); await expect(retry).toBeEnabled();
    await expect(card).toBeHidden(); await expect(page.getByRole('dialog')).toHaveCount(0);
    state.catalogFailure = 0; await retry.click(); await expect(card).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
  });
}
