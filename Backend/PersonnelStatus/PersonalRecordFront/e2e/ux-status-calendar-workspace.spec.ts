import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const people = [
  { id: '401', name: 'Календарный Аслан', rank: 'Капитан', division: { id: '11', name: 'Департамент 6' } },
  { id: '402', name: 'Иванов Данияр', rank: '', division: { id: '12', name: 'Управление 1' } },
];
const divisionOptions = [
  { id: '11', name: 'Департамент 6', parent_id: null as string | null },
  { id: '12', name: 'Управление 1', parent_id: '11' },
];
const ninthEmployee = { id: '9401', name: 'Тоғызыншы Ерлан', rank: 'Майор', division: { id: '130', name: 'Девятый департамент' } };
const ninthDivisions = [...divisionOptions, { ...ninthEmployee.division, parent_id: null }];
type CalendarFixture = { viewerOnly?: boolean; people?: typeof people; divisions?: typeof divisionOptions };

async function prepare(page: Page, plannedVacation: boolean | 'duty' = false, fixture: CalendarFixture = {}) {
  const roster = fixture.people ?? people, divisions = fixture.divisions ?? divisionOptions;
  const state = { failure: 0, divisionFailure: 0, reads: [] as URL[] };
  if (fixture.viewerOnly !== false) await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace'], global_permissions: ['status.view'], status_manage_division_ids: [], roles: [],
  } }));
  await page.route('**/api/ops/status-calendar/**', async route => {
    const url = new URL(route.request().url()); state.reads.push(url);
    if (state.failure && !url.pathname.endsWith('/divisions/')) return route.fulfill({ status: state.failure, json: { detail: 'Чтение недоступно' } });
    if (url.pathname.endsWith('/divisions/') && state.divisionFailure) return route.fulfill({ status: state.divisionFailure, json: { detail: 'Список недоступен' } });
    if (url.pathname.endsWith('/divisions/')) return route.fulfill({ json: { results: divisions } });
    const query = (url.searchParams.get('search') ?? '').toLowerCase();
    const division = url.searchParams.get('division_id');
    const rows = roster.filter(row => (!query || row.name.toLowerCase().includes(query)) &&
      (!division || row.division.id === division || divisions.find(option => option.id === row.division.id)?.parent_id === division));
    if (url.pathname.endsWith('/day/')) return route.fulfill({ json: {
      date: url.searchParams.get('date'), total: rows.length, in_service: 0,
      groups: { on_duty: { count: rows.length, has_more: false, employees: rows.map(row => ({ ...row, status: { code: 'DUTY', name: 'На дежурстве' } })) },
        on_event: { count: 0, has_more: false, employees: [] }, absent: { count: 0, has_more: false, employees: [] } },
    } });
    const month = url.searchParams.get('month') ?? '2026-10';
    const length = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const days = Array.from({ length }, (_, i) => month + '-' + String(i + 1).padStart(2, '0'));
    const currentPage = Number(url.searchParams.get('page') ?? 1);
    return route.fulfill({ json: { month, days, count: query || division ? rows.length : 201, page: currentPage, page_size: 100,
      catalog: [{ code: 'IN_SERVICE', name: 'В строю' }, { code: 'DUTY', name: 'На дежурстве' }, { code: 'VACATION', name: 'В отпуске' }],
      summary: days.map(date => ({ date, on_duty: rows.length, on_event: 0, absent: 0, in_service: 0 })),
      results: rows.map(row => ({ ...row, days: days.map((_, i) => i === 18 ? 'DUTY' : plannedVacation === 'duty' && i >= 19 && i <= 22 ? 'DUTY' : i < 2 || (plannedVacation && i >= 19 && i <= 22) ? 'VACATION' : 'IN_SERVICE') })) } });
  });
  await signIn(page); await page.goto('/statuses/');
  await page.getByRole('tab', { name: 'Календарь статусов', exact: true }).click();
  return state;
}

test('calendar and matrix share month, selected date and server-side filters; search resets paging', async ({ page }) => {
  const state = await prepare(page);
  await page.getByLabel('Месяц календаря', { exact: true }).fill('2026-10');
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  const table = page.getByRole('table', { name: /Статусы сотрудников по дням/ });
  await expect(table).toBeVisible();
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await expect.poll(() => state.reads.filter(url => url.pathname.endsWith('/month/')).at(-1)?.searchParams.get('page')).toBe('2');
  await page.getByRole('searchbox', { name: 'Поиск сотрудника в календаре', exact: true }).fill('Аслан');
  await expect(table.getByRole('rowheader')).toHaveCount(1);
  await expect.poll(() => state.reads.filter(url => url.pathname.endsWith('/month/')).at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByLabel('Подразделение календаря', { exact: true }).selectOption('11');
  await table.getByRole('button', { name: /Календарный Аслан.*19.*На дежурстве/ }).click();
  await expect(page.getByLabel('Выбранная ячейка', { exact: true })).toContainText('На дежурстве');
  await expect(page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })).toBeHidden();
  state.divisionFailure = 503; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(page.getByLabel('Подразделение календаря', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Подразделение календаря', { exact: true })).not.toContainText('Департамент 6');
  state.divisionFailure = 0; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(page.getByLabel('Подразделение календаря', { exact: true })).toHaveValue('11');
  await page.getByRole('tab', { name: 'Месяц', exact: true }).click();
  await expect(page.getByRole('grid', { name: /Занятость, Октябрь 2026/ })).toBeVisible();
  await expect(page.getByRole('grid').getByRole('button', { name: /^19 / })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Занятость за выбранный день' })).toContainText('Календарный Аслан');
  await page.getByLabel('Месяц календаря', { exact: true }).fill('2026-02');
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  await expect(page.getByRole('table', { name: /Февраль 2026/ }).getByRole('columnheader')).toHaveCount(29);
});

test('matrix can be read with the keyboard; empty results and read failures keep working controls', async ({ page }) => {
  const state = await prepare(page);
  await page.getByLabel('Месяц календаря', { exact: true }).fill('2026-10');
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  const table = page.getByRole('table', { name: /Статусы сотрудников по дням/ });
  const duty = table.getByRole('button', { name: /Календарный Аслан.*19.*На дежурстве/ });
  await duty.focus(); await page.keyboard.press('End'); await page.keyboard.press('Home');
  const focused = table.locator('button:focus');
  const position = await focused.boundingBox(), label = await table.getByRole('rowheader').first().boundingBox();
  expect(position!.x).toBeGreaterThanOrEqual(label!.x + label!.width - 1);
  await duty.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Выбранная ячейка', { exact: true })).toContainText('20 октября 2026');
  await expect(page.getByLabel('Выбранная ячейка', { exact: true })).toContainText('В строю');
  await expect(page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })).toBeHidden();
  await page.getByRole('searchbox', { name: 'Поиск сотрудника в календаре', exact: true }).fill('Несуществующий');
  await expect(page.getByText('Сотрудники не найдены. Измените поиск или подразделение.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  state.failure = 403; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(table).toBeHidden();
  await expect(page.getByRole('button', { name: 'Следующий месяц', exact: true })).toBeVisible();
  state.failure = 503; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(table).toBeHidden();
  state.failure = 0; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(table.getByRole('rowheader')).toHaveCount(2);
});

test('a denial also hides other cached calendar pages and views until an authorised read', async ({ page }) => {
  const state = await prepare(page);
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  const table = page.getByRole('table', { name: /Статусы сотрудников по дням/ });
  await expect(table).toBeVisible();
  state.failure = 403;
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить шахматку статусов.', { exact: true })).toBeVisible();
  await expect(table).toBeHidden();
  await page.getByRole('tab', { name: 'Месяц', exact: true }).click();
  await expect(page.getByRole('grid', { name: /Занятость/ })).toBeHidden();
  state.failure = 503; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(page.getByRole('grid', { name: /Занятость/ })).toBeHidden();
  state.failure = 0; await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(page.getByRole('grid', { name: /Занятость/ })).toBeVisible();
});

test('on a narrow screen the matrix scrolls within its frame and retains employee labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await prepare(page);
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  const table = page.getByRole('table', { name: /Статусы сотрудников по дням/ });
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  const frame = table.locator('..');
  expect(await frame.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy();
  await table.getByRole('rowheader').first().scrollIntoViewIfNeeded();
  await frame.evaluate(el => { el.scrollLeft = 500; });
  await expect(table.getByRole('rowheader').first()).toBeInViewport();
});

// The browser exercises the real calendar and shared status form. Only HTTP
// boundaries are isolated: these probes must never change the working roster.
async function editableCalendar(page: Page, planned: boolean | 'duty' = false, ninth = false) {
  const employee = ninth ? ninthEmployee : people[0];
  const division = Number(employee.division.id);
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const state = { writeFailure: false, planFailure: false, planChanged: false, timeChanged: false, manage: true, holdPlan: null as Promise<void> | null, heldPlanReads: 0 };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'object.view', ...(state.manage ? ['status.manage'] : [])], global_permissions: [], status_manage_division_ids: state.manage ? [division] : [],
    roles: ninth ? [{ code: 'CALENDAR_EDITOR', name: 'Ответственный за статусы', scope_division_id: division, scope_division_name: employee.division.name }] : [],
  } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (!new URL(route.request().url()).searchParams.has('employee_ids')) return route.fallback();
    return route.fulfill({ json: { division: null, total_count: 1, staff_units: [{ id: 901, division: { id: division, name: employee.division.name },
      employee: { id: Number(employee.id), last_name: employee.name.split(' ')[0], first_name: employee.name.split(' ')[1], current_status: { status_type: 'in_service' } } }] } });
  });
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-20' } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'in_service', label: 'В строю', color: '' }, { code: 'vacation', label: 'В отпуске', color: '' },
    { code: 'sick_leave', label: 'На больничном', color: '' }, { code: 'on_duty', label: 'На дежурстве', color: '' },
  ] }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [
    { code: 'IN_SERVICE', legacy_code: 'in_service', name: 'В строю', is_active: true },
    { code: 'VACATION', legacy_code: 'vacation', name: 'В отпуске', is_active: true },
    { code: 'SICK_LEAVE', legacy_code: 'sick_leave', name: 'На больничном', is_active: true },
    { code: 'DUTY', legacy_code: 'on_duty', name: 'На дежурстве', is_active: true },
  ] } }));
  await page.route('**/api/statuses/statuses/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/planned/')) {
      if (state.holdPlan) { state.heldPlanReads++; await state.holdPlan; }
      return route.fulfill({ status: state.planFailure ? 503 : 200, json: state.planFailure ? { detail: 'Временно недоступно' } : {
      current: null, planned: planned ? [{ id: 501, state: 'planned', status_type: planned === 'duty' ? 'on_duty' : 'vacation', start_date: '2026-10-20', end_date: state.planChanged ? '2026-10-25' : '2026-10-23', comment: 'Согласованный отпуск', location: 'Астана', duty_assignment: planned === 'duty' ? {
        kind: 'POST', object_id: '6', object_name: 'Аккорда', post_id: '9', post_name: 'Пост №1 — центральный вход', sector_name: 'Сектор', group_id: null, group_name: null,
        time_zone: 'Asia/Almaty', intervals: [
          { start_at: '2026-10-20T03:30:00Z', end_at: state.timeChanged ? '2026-10-20T08:00:00Z' : '2026-10-20T07:00:00Z' },
          { start_at: '2026-10-22T17:00:00Z', end_at: '2026-10-22T23:00:00Z' },
        ],
      } : null }] : [],
      } });
    }
    if (url.pathname.endsWith('/duty-assignments/')) return route.fulfill({ json: { results: [] } });
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      return route.fulfill({ status: state.writeFailure ? 409 : 200, json: state.writeFailure ? { detail: 'Период пересекается с другим назначением' } : { id: 501 } });
    }
    return route.fallback();
  });
  const calendar = await prepare(page, planned, { viewerOnly: false,
    ...(ninth ? { people: [ninthEmployee, ...people], divisions: ninthDivisions } : {}) });
  await page.getByLabel('Месяц календаря', { exact: true }).fill('2026-10');
  await page.getByRole('tab', { name: 'Шахматка', exact: true }).click();
  return { state, writes, calendar };
}

test('one click opens the editor and saves a new one-day status for the selected employee without leaving the calendar', async ({ page }) => {
  const { writes } = await editableCalendar(page);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В строю/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
  await page.getByRole('option', { name: 'На больничном', exact: true }).click();
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('Назначение из шахматки');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([{ method: 'POST', path: '/api/statuses/statuses/', body: {
    employee: 401, status_type: 'sick_leave', start_date: '2026-10-20', end_date: '2026-10-20', comment: 'Назначение из шахматки', location: '', related_division: 11,
  } }]);
  await expect(page.getByRole('table', { name: /Статусы сотрудников по дням/ })).toBeVisible();
});

test('a Ninth department editor starts in their role scope and saves the clicked employee and date; later filters stay chosen', async ({ page }) => {
  const { writes, calendar } = await editableCalendar(page, false, true);
  const filter = page.getByLabel('Подразделение календаря', { exact: true });
  const table = page.getByRole('table', { name: /Статусы сотрудников по дням/ });
  await expect(filter).toHaveValue('130');
  await expect(table.getByRole('rowheader')).toHaveCount(1);
  await expect(table.getByRole('rowheader')).toContainText('Тоғызыншы Ерлан');
  await expect.poll(() => calendar.reads.filter(url => url.pathname.endsWith('/month/')).at(-1)?.searchParams.get('division_id')).toBe('130');
  await table.getByRole('button', { name: /Тоғызыншы Ерлан.*21 октября.*В строю/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Тоғызыншы Ерлан');
  await expect(dialog).toContainText('21.10.2026');
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
  await page.getByRole('option', { name: 'На больничном', exact: true }).click();
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('Девятый департамент');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([{ method: 'POST', path: '/api/statuses/statuses/', body: {
    employee: 9401, status_type: 'sick_leave', start_date: '2026-10-21', end_date: '2026-10-21', comment: 'Девятый департамент', location: '', related_division: 130,
  } }]);

  await filter.selectOption('11');
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(filter).toHaveValue('11');
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(table.getByRole('rowheader')).toHaveCount(3);
  await page.getByRole('button', { name: 'Обновить календарь', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(table.getByRole('rowheader')).toHaveCount(3);
});

for (const scenario of [
  { name: 'a different single visible scope is deduplicated and selected by ID', scopes: [12, 12, 999], global: [], expected: '12' },
  { name: 'a global status viewer keeps all divisions despite a scoped role', scopes: [130], global: ['status.view'], expected: '' },
  { name: 'an administrator keeps all divisions despite a scoped role', scopes: [130], global: ['*'], expected: '' },
  { name: 'multiple visible role scopes keep all divisions', scopes: [11, 130], global: [], expected: '' },
]) test(scenario.name, async ({ page }) => {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace'], global_permissions: scenario.global, status_manage_division_ids: [],
    roles: scenario.scopes.map((id, index) => ({ code: 'CALENDAR_READER_' + index, name: 'Читатель календаря', scope_division_id: id, scope_division_name: 'Название не определяет область' })),
  } }));
  await prepare(page, false, { viewerOnly: false, people: [ninthEmployee, ...people], divisions: ninthDivisions });
  const filter = page.getByLabel('Подразделение календаря', { exact: true });
  await expect(filter).toBeEnabled();
  await expect(page.getByRole('table', { name: /Статусы сотрудников по дням/ })).toBeVisible();
  await expect(filter).toHaveValue(scenario.expected);
  await expect(page.getByRole('table').getByRole('rowheader')).toHaveCount(scenario.expected ? 1 : 3);
});

test('editing a planned calendar status preserves its period and uses PATCH; a failed save retains the draft', async ({ page }) => {
  const { state, writes } = await editableCalendar(page, true);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В отпуске/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog).toContainText('20.10.2026 — 23.10.2026');
  await expect(dialog.getByRole('combobox', { name: /Новый статус/ })).toContainText('В отпуске');
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('Уточнённый комментарий');
  state.writeFailure = true;
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toContainText('Период пересекается с другим назначением');
  await expect(dialog.getByRole('textbox', { name: /Комментарий/ })).toHaveValue('Уточнённый комментарий');
  state.writeFailure = false;
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual({ method: 'PATCH', path: '/api/statuses/statuses/501/', body: {
    employee: 401, status_type: 'vacation', start_date: '2026-10-20', end_date: '2026-10-23', comment: '', location: 'Астана', related_division: 11,
  } });
});

test('calendar hides editing outside the managed division', async ({ page }) => {
  const { writes } = await editableCalendar(page);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Иванов Данияр.*20 октября.*В строю/ }).click();
  await expect(page.getByLabel('Выбранная ячейка', { exact: true })).toContainText('Только просмотр');
  await expect(page.getByRole('button', { name: 'Изменить статус', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })).toBeHidden();
  expect(writes).toEqual([]);
});

test('Enter opens the matrix editor and a new duty keeps the Akorda passport post ID and selected day', async ({ page }) => {
  const { writes } = await editableCalendar(page);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В строю/ }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
  await page.getByRole('option', { name: 'На дежурстве', exact: true }).click();
  await dialog.getByRole('combobox', { name: /Тип дежурства/ }).click();
  await page.getByRole('option', { name: 'Постовое', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Объект/ }).click();
  await page.getByRole('option', { name: /Аккорда/ }).click();
  await dialog.getByRole('combobox', { name: /^Пост/ }).click();
  await page.getByRole('option', { name: /Пост № ?1 — центральный вход/ }).click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([{ method: 'POST', path: '/api/statuses/statuses/', body: {
    employee: 401, status_type: 'on_duty', start_date: '2026-10-20', end_date: '2026-10-20', related_division: 11,
    duty_assignment: { kind: 'POST', object_id: '6', post_id: '9' },
  } }]);
});

test('a planned status can become indefinite in-service without retaining the old end date', async ({ page }) => {
  const { writes } = await editableCalendar(page, true);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В отпуске/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
  await page.getByRole('option', { name: 'В строю', exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes[0].method).toBe('PATCH');
  expect(writes[0].body).toMatchObject({ status_type: 'in_service', start_date: '2026-10-20', end_date: null });
});

test('a calendar day read failure blocks saving until retry; the mobile editor stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, writes } = await editableCalendar(page);
  state.planFailure = true;
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В строю/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog).toContainText('Не удалось проверить статусы выбранного дня.');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  state.planFailure = false;
  await dialog.getByRole('button', { name: 'Повторить загрузку дня', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
  expect(writes).toEqual([]);
});

test('a transient background month failure retains the editor draft; an explicit denial removes it', async ({ page }) => {
  const { calendar, writes } = await editableCalendar(page);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В строю/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('Черновик сохраняется при сбое');
  calendar.failure = 503;
  await page.clock.install(); await page.clock.fastForward(61_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByText('Не удалось загрузить шахматку статусов.', { exact: true })).toBeAttached();
  await expect(dialog.getByRole('textbox', { name: /Комментарий/ })).toHaveValue('Черновик сохраняется при сбое');
  calendar.failure = 403;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
});

test('saving a stale planned cell blocks overwriting a period changed in another session', async ({ page }) => {
  const { state, writes } = await editableCalendar(page, true);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В отпуске/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await dialog.getByRole('textbox', { name: /Комментарий/ }).fill('Мой черновик');
  state.planChanged = true;
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByText(/Запланированный статус уже изменён/).first()).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /Комментарий/ })).toHaveValue('Мой черновик');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
});

test('revoking editing rights during the preflight read prevents any delayed PATCH', async ({ page }) => {
  const { state, writes } = await editableCalendar(page, true);
  await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В отпуске/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  let release!: () => void;
  state.holdPlan = new Promise<void>(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.heldPlanReads).toBe(1);
  state.manage = false;
  await page.clock.install(); await page.clock.fastForward(61_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(dialog).toBeHidden();
  const completed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/planned/'));
  release(); await completed;
  await expect(page.getByLabel('Выбранная ячейка', { exact: true })).toContainText('Только просмотр');
  expect(writes).toEqual([]);
});

test.describe('exact personnel duty exits', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('new duty saves two exact exits atomically and focuses a missing end without inventing hours', async ({ page, businessWrites }) => {
    const { writes } = await editableCalendar(page);
    await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*В строю/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
    await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
    await page.getByRole('option', { name: 'На дежурстве', exact: true }).click();
    await expect(dialog.getByRole('note')).toContainText('Период статуса не означает круглосуточное нахождение');
    await dialog.getByRole('combobox', { name: /Тип дежурства/ }).click();
    await page.getByRole('option', { name: 'Постовое', exact: true }).click();
    await dialog.getByRole('combobox', { name: /^Объект/ }).click();
    await page.getByRole('option', { name: /Аккорда/ }).click();
    await dialog.getByRole('combobox', { name: /^Пост/ }).click();
    await page.getByRole('option', { name: /Пост № ?1 — центральный вход/ }).click();
    await dialog.getByRole('button', { name: 'Добавить выход', exact: true }).click();
    await expect(dialog.getByLabel(/^Начало выхода/)).toHaveValue('');
    await expect(dialog.getByLabel(/^Окончание выхода/)).toHaveValue('');
    await dialog.getByLabel(/^Начало выхода/).fill('2026-10-20T08:30');
    await dialog.getByLabel(/^Окончание выхода/).fill('2026-10-20T12:00');
    await dialog.getByRole('button', { name: 'Добавить выход', exact: true }).click();
    await dialog.getByLabel(/^Начало выхода/).nth(1).fill('2026-10-20T22:00');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByLabel(/^Окончание выхода/).nth(1)).toBeFocused();
    await expect(dialog).toContainText('Укажите дату и время окончания выхода.');
    expect(writes).toEqual([]);
    await dialog.getByLabel(/^Окончание выхода/).nth(1).fill('2026-10-21T00:00');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'POST', body: { employee: 401, start_date: '2026-10-20', end_date: '2026-10-20', duty_assignment: {
      kind: 'POST', object_id: '6', post_id: '9', time_zone: 'Asia/Almaty', intervals: [
        { start_at: '2026-10-20T08:30:00+05:00', end_at: '2026-10-20T12:00:00+05:00' },
        { start_at: '2026-10-20T22:00:00+05:00', end_at: '2026-10-21T00:00:00+05:00' },
      ],
    } } });
    expect(businessWrites).toEqual([]);
  });

  test('planned duty hydrates the full overnight schedule and a failed PATCH preserves edited clocks', async ({ page, businessWrites }) => {
    const { state, writes } = await editableCalendar(page, 'duty');
    await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*На дежурстве/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
    await expect(dialog.getByLabel(/^Начало выхода/).nth(0)).toHaveValue(/^2026-10-20T08:30(?::00)?$/);
    await expect(dialog.getByLabel(/^Окончание выхода/).nth(1)).toHaveValue(/^2026-10-23T04:00(?::00)?$/);
    await dialog.getByLabel(/^Окончание выхода/).nth(0).fill('2026-10-20T12:30');
    state.writeFailure = true;
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toContainText('Период пересекается с другим назначением');
    await expect(dialog.getByLabel(/^Окончание выхода/).nth(0)).toHaveValue(/^2026-10-20T12:30(?::00)?$/);
    state.writeFailure = false;
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ method: 'PATCH', path: '/api/statuses/statuses/501/', body: {
      start_date: '2026-10-20', end_date: '2026-10-23', duty_assignment: { time_zone: 'Asia/Almaty', intervals: [
        { start_at: '2026-10-20T08:30:00+05:00', end_at: '2026-10-20T12:30:00+05:00' },
        { start_at: '2026-10-22T22:00:00+05:00', end_at: '2026-10-23T04:00:00+05:00' },
      ] },
    } });
    expect(businessWrites).toEqual([]);
  });

  test('a concurrent change to only an exit clock blocks a planned PATCH and preserves the draft', async ({ page, businessWrites }) => {
    const { state, writes } = await editableCalendar(page, 'duty');
    await page.getByRole('table', { name: /Статусы сотрудников по дням/ }).getByRole('button', { name: /Календарный Аслан.*20 октября.*На дежурстве/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
    await dialog.getByLabel(/^Окончание выхода/).nth(0).fill('2026-10-20T12:30');
    state.timeChanged = true;
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByText(/Запланированный статус уже изменён/).first()).toBeVisible();
    await expect(dialog.getByLabel(/^Окончание выхода/).nth(0)).toHaveValue(/^2026-10-20T12:30(?::00)?$/);
    expect(writes).toEqual([]);
    expect(businessWrites).toEqual([]);
  });
});
