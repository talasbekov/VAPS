import { test, expect, signIn } from './ux-fixture';
import type { Page, Route } from '@playwright/test';

const periods = [
  { id: 9601, status_type: 'business_trip', status_type_display: 'В командировке',
    state: 'active', state_display: 'Действует', start_date: '2026-10-15',
    end_date: '2026-11-05', effective_end_date: '2026-11-05', comment: 'Синтетический текущий статус' },
  { id: 9602, status_type: 'vacation', status_type_display: 'В отпуске',
    state: 'planned', state_display: 'Запланирован', start_date: '2026-11-20',
    end_date: '2026-11-25', effective_end_date: '2026-11-25', comment: 'Синтетический будущий статус' },
];
const cards = [
  { index: 0, name: 'Текущий статус', title: 'Основание текущего статуса', filename: 'Текущий приказ.txt' },
  { index: 1, name: 'Запланированный статус: В отпуске', title: 'Основание будущего статуса', filename: 'Будущий приказ.txt' },
] as const;

// Preserve the shared fixture's write blocker even for mocked read endpoints.
function readOnly(route: Route, json: unknown) {
  return route.request().method() === 'GET' ? route.fulfill({ json }) : route.fallback();
}

async function openDocuments(page: Page, card: typeof cards[number], denied: boolean) {
  const period = periods[card.index];
  const documentId = 9701 + card.index;
  const endpoint = `/api/statuses/statuses/${period.id}/documents/${documentId}/content/`;
  const bytes = Buffer.from(`Synthetic status attachment ${period.id}\n`, 'utf8');
  const state = {
    detailReads: [] as number[],
    downloads: [] as { path: string; query: string; method: string; bearer: boolean; kind: string }[],
    unexpectedFiles: [] as string[],
  };
  await page.route('**/api/operations/my-permissions/**', route => readOnly(route, {
    permissions: ['status.view', 'status.workspace', 'status.manage'],
    global_permissions: ['status.view', 'status.workspace', 'status.manage'], status_manage_division_ids: null, roles: [],
  }));
  const unit = {
    id: 9610, index: 1, parent_id: null, vacancy: null,
    division: { id: 3, name: 'Учебное управление' }, directorate_id: 3, directorate_name: 'Учебное управление',
    position: { id: 1, name: 'Специалист', level: 1 },
    employee: { id: 9600, last_name: 'Учебный', first_name: 'Сотрудник', middle_name: 'Документы', current_status: periods[0] },
  };
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => readOnly(route, {
    division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false,
  }));
  await page.route('**/api/statuses/types/**', route => readOnly(route, periods.map(row => ({ code: row.status_type, label: row.status_type_display, color: '' }))));
  await page.route('**/api/operations/status-types/**', route => readOnly(route, { count: 0, next: null, results: [] }));
  await page.route('**/api/operations/statuses/**', route => readOnly(route, { count: 0, next: null, results: [] }));
  await page.route('**/api/operations/tomorrow-block/**', route => readOnly(route, { business_date: '2026-10-19', blocked: false, laggards: [] }));
  await page.route('**/media/status_documents/**', route => {
    state.unexpectedFiles.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 403, body: 'Public status documents are forbidden' });
  });
  await page.route('**/api/statuses/statuses/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/planned/')) return route.fulfill({ json: { current: periods[0], planned: [periods[1]] } });
    const detail = periods.find(row => url.pathname === `/api/statuses/statuses/${row.id}/`);
    if (detail) {
      state.detailReads.push(detail.id);
      return route.fulfill({ json: { ...detail, documents: detail.id === period.id
        ? [{ id: documentId, title: card.title, file: endpoint, file_url: endpoint }] : [] } });
    }
    if (url.pathname === endpoint) {
      state.downloads.push({ path: url.pathname, query: url.search, method: request.method(),
        bearer: /^Bearer \S+$/.test(request.headers().authorization ?? ''), kind: request.resourceType() });
      if (denied) return route.fulfill({ status: 403, json: { detail: 'Документ вне доступного подразделения' } });
      return route.fulfill({ status: 200, body: bytes, headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(card.filename)}`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    // Never fall through to real personnel files if an endpoint is incorrect.
    state.unexpectedFiles.push(url.pathname);
    return route.fulfill({ status: 404, json: { detail: 'Only synthetic status fixtures are available' } });
  });
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('button', { name: 'Действия: Учебный Сотрудник Документы', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Запланированные статусы', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Запланированные статусы сотрудника', exact: true });
  const article = dialog.getByRole('article', { name: card.name, exact: true });
  await expect(article).toBeVisible();
  expect(state.detailReads, 'Document metadata loads only after expanding its card').toEqual([]);
  await article.getByRole('button', { name: 'Документы статуса', exact: true }).click();
  const button = article.getByRole('button', { name: card.title, exact: true });
  await expect(button).toBeVisible();
  expect(state.detailReads).toEqual([period.id]);
  await expect(article.getByRole('link', { name: card.title, exact: true })).toHaveCount(0);
  expect(state.downloads).toEqual([]);
  return { article, button, state, endpoint, bytes };
}

for (const card of cards) {
  test(`${card.name}: authenticated document download keeps the server filename and synthetic bytes`, async ({ page, businessWrites }) => {
    const { button, state, endpoint, bytes } = await openDocuments(page, card, false);
    const downloaded = page.waitForEvent('download');
    await button.click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(card.filename);
    expect(download.url()).toMatch(/^blob:/);
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(state.downloads).toEqual([{ path: endpoint, query: '', method: 'GET', bearer: true, kind: 'fetch' }]);
    expect(state.unexpectedFiles).toEqual([]);
    expect(businessWrites).toEqual([]);
  });

  test(`${card.name}: foreign document 403 shows an alert without starting a download`, async ({ page, businessWrites }) => {
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    const { article, button, state, endpoint } = await openDocuments(page, card, true);
    await button.click();
    await expect(article.getByRole('alert')).toHaveText('Не удалось скачать документ. Проверьте доступ и повторите попытку.');
    await expect(button).toBeEnabled();
    await expect(article.getByRole('status')).toHaveCount(0);
    expect(state.downloads).toEqual([{ path: endpoint, query: '', method: 'GET', bearer: true, kind: 'fetch' }]);
    expect(downloads).toBe(0);
    expect(state.unexpectedFiles).toEqual([]);
    expect(businessWrites).toEqual([]);
  });
}
