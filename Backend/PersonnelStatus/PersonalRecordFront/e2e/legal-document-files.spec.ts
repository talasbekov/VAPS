import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3346';
const bytes = Buffer.from('%PDF-1.4\nУчебный файл для проверки скачивания\n%%EOF');
const file = { id: '7', name: 'Порядок.pdf', contentType: 'application/pdf', size: bytes.length, sha256: 'a'.repeat(64), uploadedAt: '2026-10-10T16:00:00Z', uploadedBy: '42' };
const initial = { id: '3', kind: 'INSTRUCTION', code: 'И-01', title: 'Порядок проверки', description: 'Учебный документ', revision: 'Редакция 1', status: 'IN_FORCE', pages: 1, fileUrl: null as string | null, version: 1, file: null as typeof file | null };

async function setup(page: Page, options: { reader?: boolean; scoped?: boolean; withFile?: boolean; fail?: number; legacy?: boolean } = {}) {
  const state = { rows: [{ ...initial, file: options.withFile ? file : null, fileUrl: options.legacy ? 'https://example.test/instruction.pdf' : null }], writes: [] as { method: string; body: string; contentType: string }[], fail: options.fail ?? 0 };
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: options.reader ? ['catalog.view'] : ['legal.manage'], global_permissions: options.reader || options.scoped ? [] : ['legal.manage'], roles: [] } }));
  await page.route('**/api/ops/legal-documents/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/download/')) return route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('Порядок.pdf') }, body: bytes });
    if (url.pathname.endsWith('/files/')) return route.fulfill({ json: { results: [file] } });
    if (request.method() === 'GET') return route.fulfill({ json: { results: state.rows, canManage: !options.reader && !options.scoped, maxFileSizeBytes: 10485760 } });
    state.writes.push({ method: request.method(), body: request.postData() ?? '', contentType: request.headers()['content-type'] ?? '' });
    if (state.fail) return route.fulfill({ status: state.fail, json: { error_code: state.fail === 409 ? 'LEGAL_DOCUMENT_VERSION_CONFLICT' : 'SERVICE_UNAVAILABLE', message: state.fail === 409 ? 'Документ изменён другим пользователем. Обновите карточку.' : 'Сервис временно недоступен', details: {}, request_id: null, timestamp: '' } });
    const saved = { ...initial, id: request.method() === 'POST' ? '4' : '3', title: request.method() === 'POST' ? 'Новая инструкция' : initial.title, file, version: request.method() === 'POST' ? 1 : 2 };
    state.rows = request.method() === 'POST' ? [...state.rows, saved] : [saved];
    return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: saved });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(APP + '/security-ops/laws/');
  return state;
}

async function newDocument(page: Page) {
  await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить документ', exact: true });
  await dialog.getByLabel('Номер документа').fill('И-02');
  await dialog.getByLabel('Название').fill('Новая инструкция');
  await dialog.getByLabel('Файл документа').setInputFiles({ name: 'Порядок.pdf', mimeType: 'application/pdf', buffer: bytes });
  return dialog;
}

test.describe('private legal document files', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend; all business writes intercepted');
  test('global legal manager creates metadata and file in one multipart save', async ({ page }) => {
    const state = await setup(page);
    const dialog = await newDocument(page);
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Новая инструкция', exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].method).toBe('POST');
    expect(state.writes[0].contentType).toContain('multipart/form-data; boundary=');
    expect(state.writes[0].body).toContain('name="title"');
    expect(state.writes[0].body).toContain('Новая инструкция');
    expect(state.writes[0].body).toContain('name="file"');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Новая инструкция', exact: true })).toBeVisible();
  });
  test('reader downloads private bytes with original name and sees no write actions', async ({ page }) => {
    await setup(page, { reader: true, withFile: true });
    await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить документ', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(0);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PDF', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('Порядок.pdf');
    expect(await readFile((await download.path())!)).toEqual(bytes);
  });
  test('failed upload keeps file and metadata for retry without a success message', async ({ page }) => {
    const state = await setup(page, { fail: 503 });
    const dialog = await newDocument(page);
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Сервис временно недоступен');
    await expect(dialog.getByLabel('Название')).toHaveValue('Новая инструкция');
    await expect(dialog.getByLabel('Файл документа')).toHaveValue(/Порядок\.pdf$/);
    await expect(page.getByText('Документ сохранён', { exact: true })).toHaveCount(0);
    state.fail = 0;
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.writes).toHaveLength(2);
  });
  test('scoped legal manager can read but cannot edit shared documents', async ({ page }) => {
    await setup(page, { scoped: true });
    await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить документ', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(0);
  });
  test('stale replacement preserves draft and submits its original version', async ({ page }) => {
    const state = await setup(page, { withFile: true, fail: 409 });
    await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить документ', exact: true });
    await dialog.getByLabel('Название').fill('Моя редакция');
    await dialog.getByLabel('Файл документа').setInputFiles({ name: 'Замена.pdf', mimeType: 'application/pdf', buffer: bytes });
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Документ изменён другим пользователем');
    await expect(dialog.getByLabel('Название')).toHaveValue('Моя редакция');
    await expect(dialog.getByLabel('Файл документа')).toHaveValue(/Замена\.pdf$/);
    expect(state.writes[0].method).toBe('PATCH');
    expect(state.writes[0].body).toMatch(/name="expectedVersion"\r?\n\r?\n1/);
  });
  test('legacy link remains available without invented file history', async ({ page }) => {
    await setup(page, { reader: true, legacy: true });
    await expect(page.getByRole('link', { name: 'Открыть', exact: true })).toHaveAttribute('href', 'https://example.test/instruction.pdf');
    await expect(page.getByRole('button', { name: 'Версии файла', exact: true })).toHaveCount(0);
  });
  for (const href of ['./docs/law.pdf', 'documents/law.pdf', 'javascript:alert(1)', '//example.test/law.pdf']) test(`legacy URL handling: ${href}`, async ({ page }) => {
    await setup(page, { reader: true });
    await page.route('**/api/ops/legal-documents/**', route => route.fulfill({ json: { results: [{ ...initial, fileUrl: href }], canManage: false, maxFileSizeBytes: 10485760 } }));
    await page.reload();
    await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeVisible();
    const link = page.getByRole('link', { name: 'Открыть', exact: true });
    if (href.startsWith('./') || href.startsWith('documents/')) await expect(link).toHaveAttribute('href', href);
    else await expect(link).toHaveCount(0);
  });
  test('history is fetched on demand and a previous version can be downloaded', async ({ page }) => {
    await setup(page, { reader: true, withFile: true });
    let historyCalls = 0;
    await page.route('**/api/ops/legal-documents/3/files/', async route => {
      historyCalls++;
      return route.fulfill({ json: { results: [file, { ...file, id: '6', name: 'Предыдущая.pdf' }] } });
    });
    await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeVisible();
    expect(historyCalls).toBe(0);
    await page.getByRole('button', { name: 'Версии файла', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Версии файла', exact: true });
    await expect(dialog.getByText('Предыдущая.pdf', { exact: true })).toBeVisible();
    expect(historyCalls).toBe(1);
    const request = page.waitForRequest('**/api/ops/legal-documents/3/files/6/download/');
    const download = page.waitForEvent('download');
    await dialog.getByRole('listitem').filter({ hasText: 'Предыдущая.pdf' }).getByRole('button', { name: 'Скачать', exact: true }).click();
    await request;
    expect(await readFile((await (await download).path())!)).toEqual(bytes);
  });
  test('pending upload blocks double submit and accidental dismissal', async ({ page }) => {
    await setup(page);
    let writes = 0;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/ops/legal-documents/', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      writes++;
      await hold;
      return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    });
    const dialog = await newDocument(page);
    try {
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Сохранение…', exact: true })).toBeDisabled();
      await expect(dialog.getByLabel('Название')).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      expect(writes).toBe(1);
    } finally { release(); }
    await expect(dialog.getByRole('alert')).toContainText('Сервис временно недоступен');
    await expect(dialog.getByLabel('Название')).toBeEnabled();
  });
  test('failed permission refresh closes the workspace without writes and can be retried', async ({ page }) => {
    const state = await setup(page);
    await newDocument(page);
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['legal.manage'], global_permissions: ['legal.manage'], roles: [] } }));
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Добавить документ', exact: true })).toBeVisible();
  });
  for (const width of [1366, 390]) test(`catalog and editor fit a ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page, { withFile: true });
    await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('catalog.png'), fullPage: true });
    await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить документ', exact: true });
    await expect(dialog).toBeVisible();
    // Radix opening animation briefly changes the translated bounding box.
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width;
    }).toBe(true);
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('editor.png') });
    expect(state.writes).toHaveLength(0);
  });
});
