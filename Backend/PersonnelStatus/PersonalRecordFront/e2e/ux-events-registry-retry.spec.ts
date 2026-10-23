import type { APIRequestContext, Page } from '@playwright/test';
import type { SecurityEvent } from '@/entities/security-event';
import { test, expect, signIn, readEvent } from './ux-fixture';

const SEARCH = 'Контекст';
const OWNER = 'Ведущий проверки';
const OTHER_OWNER = 'Другой ведущий';
const PATH = '/api/ops/security-events/';
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function prepare(page: Page, request: APIRequestContext) {
  // Retain the complete real DTO. Only browser GET responses are substituted;
  // all business writes remain blocked by ux-fixture.
  const source = await readEvent(request);
  const events: SecurityEvent[] = ['2026-10-23', '2026-11-23'].map((businessDate, index) => ({
    ...source, id: `ux-registry-retry-${index + 1}`, code: `UX-REG-${index + 1}`,
    title: `${SEARCH} реестра ${index + 1}`, ownerName: OWNER,
    businessDate, businessDateEnd: null, stage: 'RECON', visitObjects: [],
  }));
  const state = { mode: 'failure' as 'failure' | 'success' | 'forbidden', urls: [] as string[], successfulAttempts: 0,
    responseGate: null as ReturnType<typeof gate> | null };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['event.view'], global_permissions: ['event.view'], roles: [],
  } }));
  await page.route('**/api/ops/security-events/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET' || url.pathname !== PATH) return route.fallback();
    // The sidebar's independent badge probe must not consume registry failures
    // or enter the counters that assert the filtered query's retry behavior.
    if (url.searchParams.get('page_size') === '1') return route.fulfill({ json: {
      count: 41, next: '?page=2&page_size=1', previous: null,
      owners: [OWNER, OTHER_OWNER], results: [events[0]],
    } });
    state.urls.push(url.searchParams.toString());
    if (state.mode === 'forbidden') return route.fulfill({ status: 403, json: { detail: 'PERMISSION_DENIED' } });
    if (state.mode === 'failure') return route.fulfill({ status: 503, json: { detail: 'Реестр временно недоступен' } });
    state.successfulAttempts++;
    if (state.responseGate) await state.responseGate.promise;
    const calendar = url.searchParams.get('page_size') === '200';
    return route.fulfill({ json: { count: calendar ? 402 : 41, next: null, previous: '?page=2',
      owners: [OWNER, OTHER_OWNER], results: calendar ? events : [events[0]] } });
  });
  await signIn(page);
  return { state, events };
}

function query(view: 'list' | 'calendar') {
  const value = new URLSearchParams({ search: SEARCH, stage: 'RECON', from: '2026-10-01', to: '2026-11-30', owner: OWNER, page: '3' });
  if (view === 'calendar') value.set('view', 'calendar');
  return value;
}

async function assertFilters(page: Page, view: 'list' | 'calendar', owner = OWNER) {
  await expect(page.getByRole('textbox', { name: 'Поиск мероприятий', exact: true })).toHaveValue(SEARCH);
  await expect(page.getByLabel('Этап', { exact: true })).toHaveValue('RECON');
  await expect(page.getByLabel('Период с', { exact: true })).toHaveValue('2026-10-01');
  await expect(page.getByLabel('Период по', { exact: true })).toHaveValue('2026-11-30');
  await expect(page.getByLabel('Ведущий', { exact: true })).toHaveValue(owner);
  await expect(page.getByRole('button', { name: view === 'calendar' ? 'К списку' : 'Календарь', exact: true })).toBeVisible();
}

async function assertNoEmptyResultsControls(page: Page) {
  await expect(page.getByRole('columnheader')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: /Пагинация|Страницы/ })).toHaveCount(0);
  await expect(page.getByText('Мероприятия не найдены', { exact: true })).toHaveCount(0);
}

for (const view of ['list', 'calendar'] as const) for (const width of [320, 1440]) {
  test(`registry ${view} retries exhausted503 in the same context at ${width}px`, async ({ page, request, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { state, events } = await prepare(page, request);
    const selectedQuery = query(view);
    await page.goto('/security-ops/events/?' + selectedQuery);
    await expect(page.getByText(/Не удалось загрузить реестр ОМ\./).first()).toBeVisible();
    expect(state.urls).toHaveLength(2); // The provider's one automatic transient retry is exhausted.
    await assertNoEmptyResultsControls(page);
    await assertFilters(page, view);
    const urlBefore = page.url(), documentBefore = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole('button', { name: 'Дополнительные фильтры', exact: true }).click();
    const retry = page.getByRole('button', { name: /^Повтор(ить|яем)/ });
    await expect(retry).toBeVisible();
    state.mode = 'success'; state.responseGate = gate();
    try {
      await retry.click();
      await expect.poll(() => state.successfulAttempts).toBe(1);
      if (await retry.count()) await expect(retry).toBeDisabled();
      else await expect(page.getByText(view === 'calendar' ? 'Загрузка календаря…' : 'Загрузка реестра…', { exact: true })).toBeVisible();
      expect(page.url()).toBe(urlBefore);
      await assertNoEmptyResultsControls(page);
    } finally { state.responseGate.release(); }
    const name = view === 'calendar' ? events[0].title : `Открыть мероприятие ${events[0].code}: ${events[0].title}`;
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    expect(page.url()).toBe(urlBefore);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentBefore);
    expect(state.urls).toHaveLength(3); expect(state.urls[2]).toBe(state.urls[0]);
    const outgoing = new URLSearchParams(state.urls[2]);
    for (const [key, value] of selectedQuery) if (key !== 'view') expect(outgoing.get(key)).toBe(value);
    expect(outgoing.get('page_size')).toBe(view === 'calendar' ? '200' : '20');
    await expect(page.getByRole('button', { name: 'Дополнительные фильтры', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Дополнительные фильтры', exact: true }).click();
    await assertFilters(page, view);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(businessWrites).toEqual([]);
  });
}

test('registry calendar retry retains the selected month and day after a read failure', async ({ page, request, businessWrites }) => {
  const { state, events } = await prepare(page, request);
  state.mode = 'success';
  await page.goto('/security-ops/events/?' + query('calendar'));
  await expect(page.getByRole('link', { name: events[0].title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Следующий месяц', exact: true }).click();
  const day = page.getByRole('button', { name: '23 Ноябрь: мероприятий 1', exact: true });
  await day.click(); await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: events[1].title, exact: true })).toBeVisible();
  state.mode = 'failure';
  await page.getByLabel('Ведущий', { exact: true }).selectOption(OTHER_OWNER);
  await expect(page.getByText(/Не удалось загрузить реестр ОМ\./).first()).toBeVisible();
  const failedUrl = page.url(), failedQuery = state.urls.at(-1), documentBefore = await page.evaluate(() => performance.timeOrigin);
  expect(new URL(failedUrl).searchParams.get('owner')).toBe(OTHER_OWNER);
  state.mode = 'success';
  await page.getByRole('button', { name: /^Повтор(ить|яем)/ }).click();
  await expect(page.getByText('Календарь мероприятий · Ноябрь 2026', { exact: true })).toBeVisible();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Мероприятия дня', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: events[1].title, exact: true })).toBeVisible();
  expect(page.url()).toBe(failedUrl); expect(state.urls.at(-1)).toBe(failedQuery);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentBefore);
  await assertFilters(page, 'calendar', OTHER_OWNER);
  expect(businessWrites).toEqual([]);
});

test('registry read403 remains an access failure without transient recovery controls', async ({ page, request, businessWrites }) => {
  const { state } = await prepare(page, request); state.mode = 'forbidden';
  await page.goto('/security-ops/events/?' + query('list'));
  await expect(page.getByText('Недостаточно прав для просмотра реестра ОМ.', { exact: true })).toBeVisible();
  expect(state.urls).toHaveLength(1);
  await expect(page.getByRole('button', { name: /^Повтор(ить|яем)/ })).toHaveCount(0);
  await assertNoEmptyResultsControls(page);
  await assertFilters(page, 'list');
  expect(businessWrites).toEqual([]);
});
