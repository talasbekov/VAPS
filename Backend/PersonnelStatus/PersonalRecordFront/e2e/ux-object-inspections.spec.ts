import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { ObjectInspection } from '@/features/object-passport/model/inspections';

async function prepare(page: Page, scope: 'manager' | 'reader' | 'department' = 'manager', reviewerName = 'Проверяющий') {
  const user = {id: '1', username: 'inspector', name: reviewerName};
  const object = {id: '1', name: 'Проверяемый объект', code: 'INSP', type: 'Здание', region: 'Астана', address: 'Адрес',
    objectState: 'ACTIVE', passportState: 'GREEN', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
    sectors: [], passportVersions: [], createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z'};
  const permissions = ['object.view', ...(scope === 'manager' ? ['object.manage'] : [])];
  const state = {rows: [] as ObjectInspection[], writes: [] as unknown[], conflict: false};
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({json: {
    permissions, global_permissions: scope === 'department' ? [] : permissions, roles: [],
  }}));
  await page.route('**/api/ops/objects/**', route => route.fulfill({json:
    new URL(route.request().url()).pathname === '/api/ops/objects/1/' ? object
      : {results: [object], freshness: [], unavailableKpi: [], kpi: {total: 1}, freshnessPolicy: {version: 'test', verificationIntervalDays: 90, dueSoonPercent: 20}}}));
  await page.route('**/api/ops/object-inspections/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path.endsWith('/assignees/')) return route.fulfill({json: {results: [user]}});
      if (path.endsWith('/1/')) return route.fulfill({json: state.rows[0]});
      return route.fulfill({json: {results: state.rows, count: state.rows.length, page: 1, hasNext: false,
        today: '2026-10-27', currentUser: user, canManage: scope === 'manager'}});
    }
    const body = request.postDataJSON(); state.writes.push(body);
    if (state.conflict) return route.fulfill({status: 409, json: {detail: 'Обследование изменилось. Обновите сохранённые сведения.'}});
    if (path.endsWith('/complete/')) {
      state.rows[0] = {...state.rows[0], state: 'completed', completedAt: '2026-10-27T10:00:00Z', revision: 2};
    } else {
      state.rows = [{id: '1', objectId: '1', inspectedOn: body.inspectedOn, reviewer: user,
        items: body.items.map((item: Record<string, unknown>) => ({...item, responsible: null, resolution: '', resolvedAt: null, resolvedBy: null})),
        state: 'draft', revision: 1, completedAt: null, updatedAt: '2026-10-27T10:00:00Z', openFindings: 0, overdueFindings: 0}];
    }
    return route.fulfill({status: path === '/api/ops/object-inspections/' ? 201 : 200, json: state.rows[0]});
  });
  await signIn(page);
  return state;
}

test('object inspection is created only on save and can then be completed', async ({page, businessWrites}) => {
  const reviewerName = 'П'.repeat(150);
  const state = await prepare(page, 'manager', reviewerName);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/security-ops/objects/1?tab=check');
  await expect(page.getByText('Обследований пока нет.', {exact: true})).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', {name: 'Инфраструктура'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Начать обследование'}).click();
  expect(state.writes).toEqual([]);
  await page.getByRole('button', {name: 'Добавить вопрос'}).click();
  await page.getByRole('textbox', {name:'Вопрос',exact:true}).fill('Документы сверены?');
  await page.getByRole('combobox', {name:'Результат',exact:true}).selectOption('yes');
  await page.getByRole('button', {name: 'Сохранить черновик'}).click();
  await expect(page.getByRole('button', {name: 'Завершить обследование'})).toBeEnabled();
  expect(state.writes).toHaveLength(1);
  await page.getByRole('button', {name: 'Завершить обследование'}).click();
  await expect(page.getByRole('heading', {name: /Обследование завершено/})).toBeVisible();
  await expect(page.getByText(`Проверяющий: ${reviewerName}`, {exact: false})).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(businessWrites).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('read-only and department scopes do not get inspection writing controls', async ({page, businessWrites}) => {
  await prepare(page, 'reader');
  await page.goto('/security-ops/objects/1?tab=check');
  await expect(page.getByText('Первое обследование создаёт ответственный за объект.', {exact: false})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Начать обследование'})).toHaveCount(0);
  await prepare(page, 'department');
  await page.goto('/security-ops/objects/1?tab=check');
  await expect(page.getByText(/Для обследований нужен доступ к объектам без ограничения департаментом/)).toBeVisible();
  await expect(page.getByText('Обследований пока нет.', {exact: true})).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('stale saved inspection keeps typed draft and offers an explicit reload', async ({page, businessWrites}) => {
  const state = await prepare(page);
  state.rows = [{id: '1', objectId: '1', inspectedOn: '2026-10-20', reviewer: {id: '1', username: 'inspector', name: 'Проверяющий'},
    items: [{id: 'q1', question: 'Исходный вопрос', answer: 'yes', finding: '', responsibleUsername: '', dueOn: null,
      responsible: null, resolution: '', resolvedAt: null, resolvedBy: null}],
    state: 'draft', revision: 1, completedAt: null, updatedAt: '2026-10-20T10:00:00Z', openFindings: 0, overdueFindings: 0}];
  await page.goto('/security-ops/objects/1?tab=check');
  await page.getByRole('button', {name: 'Продолжить заполнение'}).click();
  await page.getByRole('textbox', {name:'Вопрос',exact:true}).fill('Мой несохранённый вопрос');
  state.conflict = true;
  await page.getByRole('button', {name: 'Сохранить черновик'}).click();
  await expect(page.getByRole('region', {name:'Обследования объекта'}).getByRole('alert')).toContainText('Обследование изменилось');
  await expect(page.getByRole('textbox', {name:'Вопрос',exact:true})).toHaveValue('Мой несохранённый вопрос');
  await expect(page.getByRole('button', {name: 'Загрузить сохранённую версию'})).toBeVisible();
  expect(businessWrites).toEqual([]);
});

