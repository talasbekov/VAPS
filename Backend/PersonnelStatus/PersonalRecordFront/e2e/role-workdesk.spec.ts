import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const id = '42222222-2222-4222-8222-222222222222';
const task = { id, initiatedBy: 'chief', message: 'Наряд на Аккорду на 23 октября 200 человек', revision: 1,
  status: 'needs_information', delegated: false, canEdit: true, canContinue: false,
  questions: [{ field: 'kind', text: 'Укажите вид ОМ' }], interpretationNotice: null,
  plan: { objectName: 'Аккорда', objectId: '13', businessDate: '2026-10-23', personnelTotal: 200 },
  event: null, receipts: [], updatedAt: '2026-10-23T06:00:00Z' };
async function access(page: Page, permissions = ['event.create', 'event.view']) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions, global_permissions: permissions, roles: [{ code: 'TEST', name: 'Рабочая роль', scope_division_id: null, scope_division_name: null }],
  } }));
}
async function assistant(page: Page, state: { status?: number; rows?: typeof task[] } = {}) {
  await page.route('**/api/ops/assistant/tasks/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/configuration/')) return route.fulfill({ json: { enabled: true, isHeadquarters: false } });
    if (path.endsWith('/catalogs/')) return route.fulfill({ json: { objects: [{ id: '13', name: 'Аккорда' }], departments: [] } });
    if (path.includes(id)) return route.fulfill({ json: task });
    return route.fulfill({ status: state.status ?? 200, json: state.status ? { message: 'Источник недоступен' } : {
      results: state.rows ?? [task], page: 1, pageCount: 2, total: 21, nextPage: 2, previousPage: null, isHeadquarters: false,
    } });
  });
}

for (const width of [320, 1440]) test(`commander opens actual work from the desk at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 950 }); await access(page); await assistant(page);
  await signIn(page); await page.goto('/workspace/');
  await expect(page.getByRole('heading', { name: 'Поручения и подготовка наряда', exact: true })).toBeVisible();
  const queue = page.getByRole('region', { name: 'Последние поручения', exact: true });
  await expect(queue.getByRole('link', { name: /Наряд: Аккорда/ })).toBeVisible();
  await expect(queue).toContainText('Инициатор поручения');
  await expect(queue).toContainText('23.10.2026');
  await expect(queue).toContainText('Показаны последние');
  await expect(page.getByLabel('Какой наряд нужно подготовить?', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await queue.getByRole('link', { name: /Наряд: Аккорда/ }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('Аккорда');
  expect(businessWrites).toEqual([]);
});

test('home creates only on explicit submit and lost response retry reuses the same request', async ({ page, businessWrites }) => {
  await access(page); await assistant(page, { rows: [] });
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/ops/assistant/tasks/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return bodies.length === 1 ? route.fulfill({ status: 503, json: { message: 'Lost response' } }) : route.fulfill({ json: task });
  });
  await signIn(page); await page.goto('/workspace/');
  const input = page.getByLabel('Какой наряд нужно подготовить?', { exact: true });
  await input.fill(task.message); expect(bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Подготовить по поручению', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible();
  await expect(input).toHaveValue(task.message); await expect(input).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ message: task.message, interpret: true, fields: {} });
  expect(businessWrites).toEqual([]);
});

test('desk queue hides cached protected rows on denial and recovers without losing a draft', async ({ page, businessWrites }) => {
  const state = { rows: [task], status: 200 }; await access(page); await assistant(page, state);
  // A successful status must use the list envelope.
  state.status = 0;
  await signIn(page); await page.goto('/workspace/');
  const queue = page.getByRole('region', { name: 'Последние поручения', exact: true });
  await expect(queue.getByRole('link', { name: /Наряд: Аккорда/ })).toBeVisible();
  await page.getByLabel('Какой наряд нужно подготовить?', { exact: true }).fill('Несохранённое поручение');
  state.status = 403; await queue.getByRole('button', { name: 'Обновить поручения' }).click();
  await expect(queue.getByRole('alert')).toBeVisible();
  await expect(queue.getByRole('link', { name: /Наряд: Аккорда/ })).toHaveCount(0);
  state.status = 503; await queue.getByRole('button', { name: 'Обновить поручения' }).click();
  await expect(queue.getByRole('link', { name: /Наряд: Аккорда/ })).toHaveCount(0);
  state.status = 0; await queue.getByRole('button', { name: 'Обновить поручения' }).click();
  await expect(queue.getByRole('link', { name: /Наряд: Аккорда/ })).toBeVisible();
  await expect(page.getByLabel('Какой наряд нужно подготовить?', { exact: true })).toHaveValue('Несохранённое поручение');
  expect(businessWrites).toEqual([]);
});

test('department sees addressed requests and opens the exact request without an assistant request', async ({ page, businessWrites }) => {
  await access(page, ['forces.allocate']); let assistantCalls = 0;
  page.on('request', request => { if (request.url().includes('/assistant/tasks/')) assistantCalls++; });
  await page.route('**/api/ops/security-events/forces/requests/**', route => route.fulfill({ json: { results: [{
    allocationId: '42', eventId: '20', code: 'ОМ-20', title: 'Учебная встреча', businessDate: '2026-10-25',
    departmentName: 'Шестой департамент', need: 20, allocating: null, assigned: 0, status: 'NOTIFIED', stage: 'FORCES', overdue: true,
  }] } }));
  await signIn(page); await page.goto('/workspace/');
  await expect(page.getByRole('heading', { name: 'Работа департамента', exact: true })).toBeVisible();
  const row = page.getByRole('region', { name: 'Запросы вашему департаменту' }).getByRole('link', { name: /Учебная встреча/ });
  await expect(row).toBeVisible(); await expect(row).toContainText('20 чел.');
  await expect(row).toHaveAttribute('href', /request=42/);
  await expect(page.getByLabel('Какой наряд нужно подготовить?')).toHaveCount(0);
  expect(assistantCalls).toBe(0); expect(businessWrites).toEqual([]);
});

test('permission refresh failure removes both queue and composer from the desk', async ({ page, businessWrites }) => {
  await access(page); await assistant(page); await signIn(page); await page.goto('/workspace/');
  await expect(page.getByLabel('Какой наряд нужно подготовить?')).toBeVisible();
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ status: 403, json: { message: 'Denied' } }));
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Какой наряд нужно подготовить?')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Последние поручения' })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('dark theme keeps the workdesk legible and resizing keeps content outside the sidebar', async ({ page, businessWrites }) => {
  await access(page); await assistant(page); await signIn(page); await page.goto('/workspace/');
  await page.getByRole('button', { name: 'Переключить на тёмную тему', exact: true }).click();
  const title = page.locator('main h1');
  await expect.poll(() => title.evaluate(el => Number(getComputedStyle(el).color.match(/\d+/)?.[0]))).toBeGreaterThan(180);
  await page.setViewportSize({ width: 320, height: 950 });
  await expect(page.getByLabel('Какой наряд нужно подготовить?', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => title.evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThan(256);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});
