import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page, failedView: 'list' | 'card') {
  const state = { fail: true, hold: false, empty: false, reads: 0, release: () => {} };
  const pending = new Promise<void>(resolve => { state.release = resolve; });
  const event = { eventId: 'ux-event', code: 'ОМ-UX-READ', title: 'Заявка проверки повтора', businessDate: '2026-10-14', eventTime: null, location: 'Площадка проверки', stage: 'PLACEMENT' };
  const allocation = { id: 'ux-request', departmentId: '3', departmentName: 'Департамент проверки', need: 5, allocating: null, status: 'DRAFT', comment: '', answerComment: '', notifiedAt: null, submittedAt: null, decidedAt: null, decisionComment: '', groupDemands: [], groupOffers: [], dueAt: null, overdue: false, submittedLate: false, directorates: [], members: [] };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['forces.allocate'], global_permissions: [], roles: [] } }));
  await page.route('**/api/core/divisions/**', route => route.fulfill({ json: { results: [{ id: 3, name: 'Департамент проверки', type_code: 'department', parent: null, is_active: true }] } }));
  await page.route('**/api/ops/security-events/forces/requests/**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const isCard = new URL(route.request().url()).pathname.endsWith('/ux-request/');
    const target = failedView === (isCard ? 'card' : 'list');
    if (target) {
      state.reads++;
      if (state.hold) await pending;
      if (state.fail) return route.fulfill({ status: 503, json: { detail: 'Проверка отказа чтения заявки' } });
    }
    return route.fulfill({ json: isCard ? { ...event, allocation, memberDirectorateById: {} } : { results: state.empty ? [] : [{ ...event, ...allocation, allocationId: allocation.id, assigned: 0 }] } });
  });
  await signIn(page);
  return state;
}

for (const view of ['list', 'card'] as const) for (const width of [1440, 320]) test(`a failed request ${view} at ${width}px can retry in place without changing work context or making a business write`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await prepare(page, view);
  await page.goto('/employees/?view=forces&tab=requests&businessDate=2026-10-14&opsPage=2' + (view === 'card' ? '&request=ux-request' : ''));
  await expect.poll(() => state.reads).toBeGreaterThan(0);
  await expect(page.getByRole('alert').filter({ hasText: /Проверка отказа чтения заявки|Сервис временно недоступен/ })).toBeVisible();
  await expect(page.getByText('Заявок нет — штаб пока не запрашивал силы с вашего департамента', { exact: true })).toHaveCount(0);
  const currentURL = page.url(), before = state.reads;
  state.fail = false; state.hold = true;
  try {
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect.poll(() => state.reads).toBeGreaterThan(before);
    await expect.poll(() => page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => /^Повторить$|^Повторяем…$/.test(button.textContent?.trim() ?? '') && button.getClientRects().length > 0);
      return buttons.length > 0 ? buttons.every(button => button.disabled) : [...document.querySelectorAll('[aria-busy="true"]')].some(element => element.getClientRects().length > 0);
    })).toBe(true);
    await page.waitForTimeout(150);
    expect(state.reads).toBe(before + 1);
    expect(page.url()).toBe(currentURL);
  } finally { state.hold = false; state.release(); }
  await expect(page.getByText('Заявка проверки повтора', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBe(0);
  expect(page.url()).toBe(currentURL);
  expect(businessWrites).toEqual([]);
});

test('a request-list failure becomes a confirmed empty list only after a successful retry', async ({ page, businessWrites }) => {
  const state = await prepare(page, 'list');
  await page.goto('/employees/?view=forces&tab=requests&businessDate=2026-10-14');
  await expect.poll(() => state.reads).toBeGreaterThan(0);
  await expect(page.getByRole('alert').filter({ hasText: /Проверка отказа чтения заявки|Сервис временно недоступен/ })).toBeVisible();
  state.fail = false; state.empty = true;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Заявок нет — штаб пока не запрашивал силы с вашего департамента', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-14');
  expect(businessWrites).toEqual([]);
});

test('a cached request read failure preserves the unsent department answer when retried', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page, 'card'); state.fail = false;
  await page.goto('/employees/?view=forces&tab=requests&request=ux-request&businessDate=2026-10-14');
  await page.getByLabel('Выделяем', { exact: true }).fill('3');
  await page.getByLabel('Комментарий', { exact: true }).fill('Несохранённый ответ департамента');
  const currentURL = page.url(), before = state.reads; state.fail = true;
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(page.getByRole('alert').filter({ hasText: /Проверка отказа чтения заявки|Сервис временно недоступен/ })).toBeVisible();
  state.fail = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Выделяем', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Несохранённый ответ департамента');
  expect(page.url()).toBe(currentURL);
  expect(businessWrites).toEqual([]);
});
