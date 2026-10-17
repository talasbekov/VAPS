import { test, expect, signIn } from './ux-fixture';

const path = '/security-ops/dictionaries/SERVICE_DUTY_KINDS/';
const entriesApi = '**/api/ops/dictionaries/SERVICE_DUTY_KINDS/entries/';
const grants = { permissions: ['dictionary.view', 'dictionary_value.manage'], global_permissions: [], roles: [] };
const entry = { id: '1001', dictionaryCode: 'SERVICE_DUTY_KINDS', code: 'GBR', label: 'Контрольный вид', labelKk: '', description: '', isActive: true,
  groupCode: null, ownerDivisionId: null, updatedAt: '2026-10-13T12:00:00+05:00', inactiveSince: null, supersedes: null, supersededBy: null,
  usage: { status: 'TRACKED', reason: null, references: [], totalCount: 0 } };

test('a denied direct dictionary link makes no protected catalogue requests', async ({ page, businessWrites }) => {
  await signIn(page);
  const reads: string[] = [];
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['analytics.view'], roles: [] } }));
  await page.route('**/api/ops/dictionaries/**', route => { reads.push(new URL(route.request().url()).pathname); return route.fulfill({ status: 403, json: { detail: 'Not permitted' } }); });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('dictionary reads wait for the first permission response', async ({ page, businessWrites }) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const reads: string[] = [];
  await page.route('**/api/operations/my-permissions/', async route => { await ready; await route.fulfill({ json: grants }); });
  await page.route('**/api/ops/dictionaries/**', route => { reads.push(new URL(route.request().url()).pathname); return route.fallback(); });
  await page.route(entriesApi, route => { reads.push('entries'); return route.fulfill({ json: { results: [entry] } }); });
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/operations/my-permissions/');
  try {
    await page.goto(path); await requested;
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(reads).toEqual([]);
    release();
    await expect(page.getByRole('row').filter({ hasText: entry.label })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Виды дежурств', exact: true })).toBeVisible();
  } finally { release(); }
  expect(businessWrites).toEqual([]);
});

test('a permission outage keeps catalogue reads disabled until an explicit retry succeeds', async ({ page, businessWrites }) => {
  await signIn(page);
  let failed = true;
  const reads: string[] = [];
  await page.route('**/api/operations/my-permissions/', route => failed ? route.fulfill({ status: 503, json: { detail: 'Temporary permission failure' } }) : route.fulfill({ json: grants }));
  await page.route('**/api/ops/dictionaries/**', route => { reads.push(new URL(route.request().url()).pathname); return route.fallback(); });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  failed = false; await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Виды дежурств', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a denied cached dictionary stays hidden through a later temporary failure and can recover', async ({ page, businessWrites }) => {
  await signIn(page);
  let mode: 'allowed' | 'denied' | 'temporary' = 'allowed';
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: grants }));
  await page.route(entriesApi, route => mode === 'allowed' ? route.fulfill({ json: { results: [entry] } }) : route.fulfill({ status: mode === 'denied' ? 403 : 503, json: { detail: 'Catalogue read failed' } }));
  await page.goto(path);
  const row = page.getByRole('row').filter({ hasText: entry.label });
  await expect(row).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Выбор справочника', exact: true });
  const failure = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить значения справочника.' });
  await navigation.getByRole('link', { name: 'Причины возврата', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Причины возврата', exact: true })).toBeVisible();
  const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/dictionaries/SERVICE_DUTY_KINDS/entries/' && response.status() === 403);
  mode = 'denied'; await navigation.getByRole('link', { name: 'Виды дежурств', exact: true }).click();
  await denied;
  await expect(failure).toBeVisible(); await expect(row).toHaveCount(0);
  await navigation.getByRole('link', { name: 'Причины возврата', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Причины возврата', exact: true })).toBeVisible();
  const temporary = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/dictionaries/SERVICE_DUTY_KINDS/entries/' && response.status() === 503);
  mode = 'temporary'; await navigation.getByRole('link', { name: 'Виды дежурств', exact: true }).click();
  await temporary;
  await expect(failure).toBeVisible(); await expect(row).toHaveCount(0);
  mode = 'allowed'; await failure.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(row).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const reason of ['catalogue_failure', 'permission_change'] as const) test(`an open similarity confirmation cannot create after ${reason}`, async ({ page, businessWrites }) => {
  await signIn(page);
  let allowed = true, failed = false, posts = 0;
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { ...grants, permissions: allowed ? grants.permissions : ['dictionary.view'] } }));
  await page.route(entriesApi, route => {
    if (route.request().method() === 'GET') return failed ? route.fulfill({ status: 503, json: { detail: 'Temporary catalogue failure' } }) : route.fulfill({ json: { results: [entry] } });
    posts++;
    return route.fulfill({ status: 409, json: { error_code: 'DICTIONARY_SIMILAR_ENTRIES', message: 'Найдены похожие записи', details: { similarEntries: [entry] }, request_id: null, timestamp: '' } });
  });
  await page.goto(path);
  await page.getByRole('textbox', { name: 'Название *', exact: true }).fill('Контрольный вид — дополнение');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Найдены похожие записи', exact: true }); await expect(dialog).toBeVisible();
  if (reason === 'catalogue_failure') {
    // Advance only the browser clock past the shared 60s cache policy used by the old build.
    await page.clock.setSystemTime(Date.now() + 65_000);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ops/dictionaries/SERVICE_DUTY_KINDS/entries/' && response.status() === 503);
    failed = true; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await refreshed;
  } else {
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/my-permissions/');
    allowed = false; await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await refreshed;
  }
  await expect(dialog.getByRole('button', { name: 'Всё равно создать', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Использовать существующую', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText(entry.label, { exact: true }).last()).toBeVisible();
  expect(posts).toBe(1); expect(businessWrites).toEqual([]);
});
