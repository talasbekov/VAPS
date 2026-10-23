import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import type { CalculationDocument, CalculationResponse } from '@/features/force-calculation/model';

// Business requests are intercepted before the UX fixture's write-denial guard.
// Synthetic UUIDs and per-test memory are never persisted on the working stand.
const eventId = '900001';
const groupId = '60000000-0000-4000-8000-000000000002';
const segmentId = '60000000-0000-4000-8000-000000000003';
const routeId = '60000000-0000-4000-8000-000000000004';
const rowId = '60000000-0000-4000-8000-000000000005';
const title = 'Учебный расчёт маршрутов';
const href = `/security-ops/events/${eventId}/force-calculation/`;
const emptyDocument = (): CalculationDocument => ({ schemaVersion: 1, groups: [], segments: [], routes: [], assignments: {} });
function completeDocument(): CalculationDocument {
  return { schemaVersion: 1,
    groups: [{ id: groupId, organization: 'Учебная организация', callsign: 'Учебная группа', vehicle: 'Учебная техника', vehicleType: 'PASSENGER' }],
    segments: [{ id: segmentId, name: 'Общий участок', type: 'Дорога', tags: '', pointA: 'Начало участка', pointB: 'Конец участка' }],
    routes: [{ id: routeId, name: 'Первый маршрут', start: 'Начало маршрута', end: 'Конец маршрута', date: '2026-10-23', time: '10:00',
      rows: [{ id: rowId, segmentId, reversed: false, position: 'RIGHT', note: '' }] }],
    assignments: { [segmentId]: groupId } };
}
function response(document: CalculationDocument = emptyDocument(), exists = false): CalculationResponse {
  return { event: { id: eventId, title, dateFrom: '2026-10-23', dateTo: null, stage: 'BULLETIN' },
    exists, version: exists ? 1 : 0, ownerDivisionId: exists ? 901 : null, ownerDivisionName: exists ? 'Учебный отдел' : '',
    ownerChoices: [{ id: 901, name: 'Учебный отдел' }], canManage: true,
    snapshot: exists ? { title, dateFrom: '2026-10-23', dateTo: null } : null,
    document, issues: [], updatedAt: exists ? '2026-10-23T06:00:00Z' : null };
}
interface FixtureState {
  calculation: CalculationResponse; getStatus: number; putStatus: number; listStatus: number;
  putConflictReason: string;
  permissions: string[]; puts: { expectedVersion: number; ownerDivisionId?: number; document: CalculationDocument }[];
  listPages: number[]; exports: string[]; count: number; reads: number; scope: number;
  beforePutReply: (() => Promise<void>) | null;
}
async function fixture(page: Page, saved = false) {
  const state: FixtureState = { calculation: response(saved ? completeDocument() : emptyDocument(), saved),
    putConflictReason: 'Версия расчёта изменилась',
    getStatus: 200, putStatus: 200, listStatus: 200, puts: [], listPages: [], exports: [], count: saved ? 1 : 0, reads: 0, scope: 901, beforePutReply: null,
    permissions: ['event.view', 'resource_calculation.view', 'resource_calculation.manage'] };
  await page.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    if (path.startsWith('/api/auth/')) return route.fallback();
    if (path === '/api/operations/my-permissions/') return route.fulfill({ json: {
      permissions: state.permissions, global_permissions: ['event.view'], roles: [{ code: 'RESOURCE_CALCULATION_PLANNER',
        name: 'Планировщик расчёта', scope_division_id: state.scope, scope_division_name: `Учебный отдел ${state.scope}` }],
    } });
    if (path === `/api/ops/security-events/${eventId}/resource-calculation/`) {
      if (req.method() === 'GET') { state.reads += 1; return route.fulfill({ status: state.getStatus,
        json: state.getStatus === 200 ? state.calculation : { detail: 'Расчёт недоступен' } }); }
      if (req.method() === 'PUT') {
        const body = req.postDataJSON(); state.puts.push(body);
        if (state.putStatus === 409 && state.calculation.event.stage === 'CLOSED') return route.fulfill({ status: 409,
          json: { detail: state.putConflictReason } });
        if (state.putStatus !== 200) return route.fulfill({ status: state.putStatus, json: {
          error_code: state.putStatus === 409 ? 'VERSION_CONFLICT' : 'PERMISSION_DENIED',
          message: state.putStatus === 409 ? state.putConflictReason : 'Доступ к расчёту закрыт', details: {},
        } });
        if (body.expectedVersion !== state.calculation.version) return route.fulfill({ status: 409, json: { detail: 'Версия изменилась' } });
        state.calculation = { ...state.calculation, document: structuredClone(body.document), exists: true,
          ownerDivisionId: 901, ownerDivisionName: 'Учебный отдел', version: state.calculation.version + 1,
          snapshot: { title, dateFrom: '2026-10-23', dateTo: null }, updatedAt: '2026-10-23T07:00:00Z' };
        state.count = Math.max(state.count, 1);
        if (state.beforePutReply) await state.beforePutReply();
        return route.fulfill({ json: state.calculation });
      }
    }
    if (path === `/api/ops/security-events/${eventId}/resource-calculation/export/`) {
      const format = url.searchParams.get('format')!; state.exports.push(format);
      return route.fulfill({ contentType: format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/json',
        headers: { 'Content-Disposition': `attachment; filename="resource-calculation.${format}"` },
        body: format === 'json' ? JSON.stringify(state.calculation) : Buffer.from('PK\x03\x04isolated-download-fixture') });
    }
    if (path === '/api/ops/resource-calculations/') {
      const pageNumber = Number(url.searchParams.get('page') ?? 1); state.listPages.push(pageNumber);
      return route.fulfill({ status: state.listStatus, json: state.listStatus === 200 ? {
        count: state.count, next: state.count > 25 && pageNumber === 1 ? '?page=2' : null, previous: pageNumber > 1 ? '?page=1' : null,
        results: state.count ? [{ eventId, title: pageNumber > 1 ? 'Следующий учебный расчёт' : title, dateFrom: '2026-10-23', dateTo: null,
          stage: state.calculation.event.stage, ownerDivisionName: 'Учебный отдел', version: state.calculation.version,
          updatedAt: state.calculation.updatedAt, routeCount: state.calculation.document.routes.length }] : [],
      } : { detail: 'Нет доступа к расчётам' } });
    }
    if (path === `/api/ops/security-events/${eventId}/`) return route.fulfill({ json: {
      id: eventId, code: 'УЧ-01', title, businessDate: '2026-10-23', businessDateEnd: null, stage: 'BULLETIN',
      readinessPercent: 0, ownerName: 'Учебный ответственный', objectId: null, objectName: '', passportBinding: null,
      visitObjects: [], reconSectorPosts: [], forceRoster: [], placementAssignments: [], kind: 'INTERNAL',
      eventType: '', location: '', protectedPersons: [], bulletinProtectedPersons: [], bulletinTasks: [],
      description: '', tasks: '', foreignDelegation: null, chiefName: '', eventTime: null,
    } });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fallback();
    return route.fulfill({ json: { results: [], count: 0, total: 0, unreadCount: 0, notifications: [] } });
  });
  await signIn(page);
  return state;
}

test('calculation desk has an empty state and scoped pagination, hides denied cached rows and recovers', async ({ page, businessWrites }) => {
  const state = await fixture(page); await page.goto('/workspace/');
  await expect(page.getByRole('heading', { name: 'Расчёт сил и средств', exact: true, level: 1 })).toBeVisible();
  const queue = page.getByRole('region', { name: 'Сохранённые расчёты', exact: true });
  await expect(queue).toContainText('Расчётов пока нет');
  await expect(queue.getByRole('link', { name: 'Открыть реестр ОМ', exact: true })).toBeVisible();
  state.count = 26; await queue.getByRole('button', { name: 'Обновить расчёты' }).click();
  await queue.getByRole('button', { name: 'Следующая страница' }).click();
  await expect(queue).toContainText('Следующий учебный расчёт'); expect(state.listPages).toContain(2);
  state.listStatus = 403; await queue.getByRole('button', { name: 'Обновить расчёты' }).click();
  await expect(queue.getByRole('alert')).toBeVisible(); await expect(queue).not.toContainText('Следующий учебный расчёт');
  state.listStatus = 200; await queue.getByRole('button', { name: 'Обновить расчёты' }).click();
  await expect(queue).toContainText('Следующий учебный расчёт');
  await queue.getByRole('button', { name: 'Предыдущая страница' }).click();
  await expect(queue.getByRole('link', { name: new RegExp(title) })).toHaveAttribute('href', href);
  expect(businessWrites).toEqual([]);
});

for (const granted of [true, false]) test(`event header offers one calculation entry only with grant=${granted}`, async ({ page, businessWrites }) => {
  const state = await fixture(page); if (!granted) state.permissions = ['event.view'];
  await page.goto(`/security-ops/events/${eventId}/`);
  const header = page.locator('[data-slot="event-workspace-header"]');
  await expect(header.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const entry = header.getByRole('link', { name: 'Расчёт сил и средств →', exact: true });
  await expect(entry).toHaveCount(granted ? 1 : 0);
  if (granted) await expect(entry).toHaveAttribute('href', href);
  expect(businessWrites).toEqual([]);
});

async function openCatalog(page: Page, name: 'Группы' | 'Участки') {
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${name} \\(`) }) });
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
async function fillRoute(page: Page, name: string) {
  await page.getByLabel('Название маршрута', { exact: true }).fill(name);
  await page.getByLabel('Начало маршрута', { exact: true }).fill('Учебное начало');
  await page.getByLabel('Конец маршрута', { exact: true }).fill('Учебный конец');
  await page.getByLabel('Дата маршрута', { exact: true }).fill('2026-10-23');
  await page.getByLabel('Время маршрута', { exact: true }).fill('10:30');
}
async function addSegment(page: Page, name: string) {
  await page.getByRole('button', { name: 'Добавить участок', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Выбрать участок', exact: true });
  await picker.getByRole('region', { name: 'Участки для добавления', exact: true }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

for (const width of [390, 1440]) test(`empty calculation creates, saves, reloads and cancels the entire catalog draft at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 950 }); const state = await fixture(page); await page.goto(href);
  await expect(page.getByRole('heading', { name: 'Расчёт ещё не создан', exact: true })).toBeVisible();
  expect(state.puts).toEqual([]); await page.getByRole('button', { name: 'Создать расчёт', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Подразделение — владелец расчёта', exact: true })).toHaveValue('901');
  await openCatalog(page, 'Группы'); await page.getByRole('button', { name: 'Добавить группу', exact: true }).click();
  await page.getByLabel('Организация 1', { exact: true }).fill('Учебная организация');
  await page.getByLabel('Позывной 1', { exact: true }).fill('Учебная группа');
  await page.getByLabel('Техника 1', { exact: true }).fill('Учебная техника');
  await openCatalog(page, 'Участки'); await page.getByRole('button', { name: 'Создать участок', exact: true }).click();
  await page.getByLabel('Название участка 1', { exact: true }).fill('Учебный участок');
  await page.getByLabel('Тип участка 1', { exact: true }).fill('Дорога');
  await page.getByLabel('Точка А 1', { exact: true }).fill('Учебная А');
  await page.getByLabel('Точка Б 1', { exact: true }).fill('Учебная Б');
  await page.getByRole('button', { name: 'Добавить маршрут', exact: true }).click(); await fillRoute(page, 'Учебный маршрут');
  await addSegment(page, 'Учебный участок');
  await page.getByRole('combobox', { name: 'Группа участка 1', exact: true }).selectOption({ label: 'Учебная группа · Учебная организация' });
  await expect(page.getByRole('region', { name: 'Сводка', exact: true })).toContainText('Назначено групп: 1 · единиц техники: 1');
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeDisabled();
  expect(state.puts).toEqual([]); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Расчёт сохранён.', { exact: true })).toBeVisible();
  expect(state.puts).toHaveLength(1); expect(state.puts[0]).toMatchObject({ expectedVersion: 0, ownerDivisionId: 901 });
  expect(state.calculation.document.routes[0].rows[0].segmentId).toBe(state.calculation.document.segments[0].id);
  expect(Object.values(state.calculation.document.assignments)).toEqual([state.calculation.document.groups[0].id]);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Учебный маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath(`saved-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click(); await openCatalog(page, 'Группы');
  await page.getByLabel('Позывной 1', { exact: true }).fill('Несохранённый позывной');
  await page.getByRole('button', { name: 'Добавить группу', exact: true }).click();
  await openCatalog(page, 'Участки'); await page.getByLabel('Название участка 1', { exact: true }).fill('Несохранённый участок');
  await page.getByRole('button', { name: 'Создать участок', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText('Изменения отменены.', { exact: true })).toBeVisible();
  await expect(page.getByText('Группы (1)', { exact: true })).toBeVisible();
  await expect(page.getByText('Участки (1)', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Несохранённый');
  expect(state.puts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('shared physical segment carries one group across routes and releases it only after the last use', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить маршрут', exact: true }).click(); await fillRoute(page, 'Второй маршрут');
  await addSegment(page, 'Общий участок');
  await expect(page.getByRole('combobox', { name: 'Группа участка 1', exact: true })).toHaveValue(groupId);
  await expect(page.getByText('Общий участок · маршрутов: 2. Группа меняется во всех этих маршрутах.', { exact: true })).toBeVisible();
  await page.getByLabel('Обратное направление 1', { exact: true }).check();
  await expect(page.getByRole('article', { name: 'Участок маршрута 1', exact: true })).toContainText('Конец участка → Начало участка');
  await expect(page.getByRole('region', { name: 'Сводка', exact: true })).toContainText('Назначено групп: 1 · единиц техники: 1');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  expect(state.calculation.document.routes).toHaveLength(2);
  expect(state.puts[0].expectedVersion).toBe(1);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить маршрут', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Выбранный маршрут', exact: true })).toHaveValue(routeId);
  await expect(page.getByRole('combobox', { name: 'Группа участка 1', exact: true })).toHaveValue(groupId);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  expect(state.calculation.document.assignments).toEqual({ [segmentId]: groupId });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить маршрут', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  expect(state.calculation.document.routes).toHaveLength(0); expect(state.calculation.document.assignments).toEqual({});
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('stale version preserves the draft until explicit replacement, with no silent retry', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Мой несохранённый маршрут');
  state.putStatus = 409; state.calculation.version = 2; state.calculation.document.routes[0].name = 'Сохранено другим планировщиком';
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Версия расчёта изменилась');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ваш черновик сохранён на экране');
  await expect(page.getByLabel('Название маршрута', { exact: true })).toHaveValue('Мой несохранённый маршрут');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled(); expect(state.puts).toHaveLength(1);
  await page.getByRole('button', { name: 'Загрузить сохранённую версию', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить черновик', exact: true }).click();
  await expect(page.getByLabel('Название маршрута', { exact: true })).toHaveValue('Мой несохранённый маршрут');
  await page.getByRole('button', { name: 'Загрузить сохранённую версию', exact: true }).click();
  await page.getByRole('button', { name: 'Заменить черновик', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сохранено другим планировщиком', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  expect(state.puts).toHaveLength(1); expect(state.puts[0].expectedVersion).toBe(1); expect(businessWrites).toEqual([]);
});

test('event closed while editing reports the server reason and retains the draft until explicit reload', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Черновик до закрытия мероприятия');
  state.calculation.event.stage = 'CLOSED'; state.calculation.canManage = false; state.putStatus = 409;
  state.putConflictReason = 'Закрытое мероприятие доступно только для чтения.';
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('Закрытое мероприятие доступно только для чтения.');
  await expect(alert).toContainText('Ваш черновик сохранён на экране');
  await expect(alert).not.toContainText('другим пользователем');
  await expect(page.getByLabel('Название маршрута', { exact: true })).toHaveValue('Черновик до закрытия мероприятия');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Загрузить сохранённую версию', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить черновик', exact: true }).click();
  await expect(page.getByLabel('Название маршрута', { exact: true })).toHaveValue('Черновик до закрытия мероприятия');
  await page.getByRole('button', { name: 'Загрузить сохранённую версию', exact: true }).click();
  await page.getByRole('button', { name: 'Заменить черновик', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Первый маршрут', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Мероприятие закрыто. Расчёт доступен для чтения и выгрузки.');
  for (const name of ['Редактировать', 'Сохранить']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeEnabled();
  expect(state.puts).toHaveLength(1); expect(businessWrites).toEqual([]);
});

for (const width of [390, 1440]) test(`one route shows totals once with coverage and multiple routes retain both summaries at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 950 }); const state = await fixture(page, true); await page.goto(href);
  const global = page.getByRole('region', { name: 'Сводка', exact: true });
  const selected = page.getByRole('region', { name: 'Сводка выбранного маршрута', exact: true });
  await expect(global).toContainText('Назначено групп: 1 · единиц техники: 1');
  await expect(global).toContainText('Участков: 1 · с группой: 1 · без группы: 0');
  await expect(selected).toHaveCount(0);
  await expect(page.getByText('Назначено групп:', { exact: false })).toHaveCount(1);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить маршрут', exact: true }).click(); await fillRoute(page, 'Второй маршрут');
  await addSegment(page, 'Общий участок');
  await expect(selected).toContainText('Участков: 1 · с группой: 1 · без группы: 0 · общих с другими маршрутами: 1');
  await expect(selected).toContainText('Назначено групп: 1 · единиц техники: 1');
  await expect(global).toContainText('Назначено групп: 1 · единиц техники: 1');
  await expect(page.getByText('Назначено групп:', { exact: false })).toHaveCount(2);
  await page.getByRole('button', { name: 'Удалить маршрут', exact: true }).click();
  await expect(selected).toHaveCount(0);
  await expect(global).toContainText('Участков: 1 · с группой: 1 · без группы: 0');
  await expect(page.getByText('Назначено групп:', { exact: false })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});

test('segment picker searches tags, filters type, shows shared context and creates a cancelable catalog entry', async ({ page, businessWrites }) => {
  const state = await fixture(page, true);
  state.calculation.document.segments.push({ id: '60000000-0000-4000-8000-000000000006', name: 'Дальний участок', type: 'Пешеходный', tags: 'обход', pointA: 'Дальняя А', pointB: 'Дальняя Б' });
  await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить маршрут', exact: true }).click(); await fillRoute(page, 'Проверка выбора');
  await page.getByRole('button', { name: 'Добавить участок', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Выбрать участок', exact: true });
  const choices = picker.getByRole('region', { name: 'Участки для добавления', exact: true });
  await picker.getByRole('combobox', { name: 'Фильтр по типу участка', exact: true }).selectOption('Дорога');
  await expect(choices.getByRole('button')).toHaveCount(1); await expect(choices).toContainText('В маршрутах: 1. Группа: Учебная группа');
  await picker.getByRole('combobox', { name: 'Фильтр по типу участка', exact: true }).selectOption('');
  await picker.getByLabel('Поиск участка для маршрута', { exact: true }).fill('обход');
  await expect(choices.getByRole('button')).toHaveCount(1); await choices.getByRole('button', { name: /^Дальний участок/ }).click();
  await expect(page.getByRole('combobox', { name: 'Группа участка 1', exact: true }).getByRole('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Добавить участок', exact: true }).click();
  await expect(choices.getByRole('button', { name: /^Дальний участок/ })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Создать новый участок', exact: true }).click();
  await picker.getByLabel('Название нового участка', { exact: true }).fill('Новый несохранённый участок');
  await picker.getByLabel('Точка А нового участка', { exact: true }).fill('Новая А');
  await picker.getByLabel('Точка Б нового участка', { exact: true }).fill('Новая Б');
  await picker.getByRole('button', { name: 'Создать и добавить', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Участок маршрута 2', exact: true })).toContainText('Новый несохранённый участок');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText('Участки (2)', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Новый несохранённый участок'); expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});

test('save denial clears saved, draft and printable protected content', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Закрытый несохранённый маршрут');
  state.putStatus = 403; await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к расчёту закрыт');
  for (const text of [title, 'Первый маршрут', 'Закрытый несохранённый маршрут', 'Учебная группа']) await expect(page.getByRole('main')).not.toContainText(text);
  await expect(page.locator('[data-force-print]')).toHaveCount(0);
  for (const name of ['Редактировать', 'Сохранить', 'Печать', 'Word', 'JSON']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(state.puts).toHaveLength(1); expect(businessWrites).toEqual([]);
});

test('direct link without calculation permission never reads the document', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); state.permissions = ['event.view']; await page.goto(href);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к расчёту закрыт');
  await expect(page.getByRole('main')).not.toContainText('Учебная группа');
  expect(state.reads).toBe(0); expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});

test('permission revocation removes an open draft immediately after the access refresh', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Черновик до отзыва права');
  state.permissions = ['event.view'];
  const refreshed = page.waitForResponse(res => new URL(res.url()).pathname === '/api/operations/my-permissions/');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await refreshed;
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к расчёту закрыт');
  await expect(page.getByRole('main')).not.toContainText('Черновик до отзыва права');
  await expect(page.getByRole('main')).not.toContainText('Учебная группа');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});

test('scope change during a delayed save prevents the old response restoring protected data', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Сохранение прежней области');
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }); state.beforePutReply = () => gate;
  const saveResponse = page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/resource-calculation/') && res.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect.poll(() => state.puts.length).toBe(1);
  state.scope = 902; state.getStatus = 403;
  const refreshed = page.waitForResponse(res => new URL(res.url()).pathname === '/api/operations/my-permissions/');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange'))); await refreshed;
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к расчёту закрыт');
  release(); await saveResponse;
  await expect(page.getByRole('main')).not.toContainText('Сохранение прежней области');
  await expect(page.getByRole('main')).not.toContainText('Учебная группа');
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-force-print]')).toHaveCount(0); expect(businessWrites).toEqual([]);
});

for (const mode of ['reader', 'closed', 'empty-reader'] as const) test(`${mode} keeps calculation read-only`, async ({ page, businessWrites }) => {
  const state = await fixture(page, mode !== 'empty-reader'); state.permissions = ['event.view', 'resource_calculation.view'];
  state.calculation.canManage = mode === 'closed';
  if (mode === 'closed') state.calculation.event.stage = 'CLOSED';
  await page.goto(href); await expect(page.getByRole('heading', { name: 'Расчёт сил и средств', exact: true })).toBeVisible();
  for (const name of ['Редактировать', 'Создать расчёт', 'Сохранить', 'Добавить маршрут']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  if (mode !== 'empty-reader') await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeEnabled();
  expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});

test('transient save failure preserves input for explicit retry and initial denial exposes no content', async ({ page, businessWrites }) => {
  const state = await fixture(page, true); await page.goto(href); await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Маршрут для повтора'); state.putStatus = 503;
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('введённые данные остаются на экране');
  await expect(page.getByLabel('Название маршрута', { exact: true })).toHaveValue('Маршрут для повтора');
  state.putStatus = 200; await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут для повтора', exact: true })).toBeVisible();
  expect(state.puts).toHaveLength(2); expect(state.puts[1]).toEqual(state.puts[0]);
  state.getStatus = 403; await page.reload(); await expect(page.getByRole('main').getByRole('alert')).toContainText('Доступ к расчёту закрыт');
  await expect(page.getByRole('main')).not.toContainText(title); expect(businessWrites).toEqual([]);
});

test('protected downloads and print use the saved snapshot and stay disabled during edit', async ({ page, businessWrites }) => {
  await page.addInitScript(() => { (window as any).__resourcePrints = 0; window.print = () => { (window as any).__resourcePrints += 1; }; });
  const state = await fixture(page, true); await page.goto(href);
  const jsonDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const json = await jsonDownload; expect(json.suggestedFilename()).toBe('resource-calculation.json');
  const downloaded = JSON.parse(await fs.readFile((await json.path())!, 'utf8'));
  expect(downloaded.version).toBe(1); expect(downloaded.document).toEqual(state.calculation.document);
  const wordDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Word', exact: true }).click();
  expect((await wordDownload).suggestedFilename()).toBe('resource-calculation.docx');
  expect(state.exports).toEqual(['json', 'docx']);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Название маршрута', { exact: true }).fill('Несохранённая печать');
  for (const name of ['Печать', 'Word', 'JSON']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Печать', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__resourcePrints)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const printed = page.locator('[data-force-print]'); await expect(printed).toBeVisible();
  await expect(printed).toContainText('Первый маршрут'); await expect(printed).toContainText('Учебная группа');
  await expect(printed).not.toContainText('Несохранённая печать'); await expect(printed.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeHidden();
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(printed).toHaveCount(0);
  await page.getByRole('link', { name: '← К мероприятию', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(state.puts).toEqual([]); expect(businessWrites).toEqual([]);
});
