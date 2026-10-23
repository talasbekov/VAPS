import type { Page } from '@playwright/test';
import { test, expect, signIn } from './ux-fixture';

const path = '/security-ops/duty-register/';
const api = '/api/ops/duty-register/roster/';
const day = '2026-10-16';
const roster = {
  business_date: day, generated_at: day + 'T10:00:00+05:00', time_zone: 'Asia/Qyzylorda',
  departments: [{ id: 4, name: 'Первый департамент', employees: [
    { employee_id: 7, full_name: 'Наряд Из Статуса', position_name: 'Инспектор', status_label: 'На дежурстве', date_start: day, date_end: null, destination: '', placements: [{ source: 'STATUS', source_id: '9007199254740993', label: 'Объект Восток · Пост 2', start_at: null, end_at: null, record_id: null }] },
    { employee_id: 8, full_name: 'Выделенный Сотрудник', position_name: 'Инспектор', status_label: 'На дежурстве', date_start: day, date_end: day, destination: '', placements: [] },
    { employee_id: 9, full_name: 'Почасовой Сотрудник', position_name: 'Инспектор', status_label: 'На дежурстве', date_start: day, date_end: day, destination: '', placements: [{ source: 'DISPATCH', source_id: 19, label: 'Объект Запад · Пост 1', start_at: day + 'T08:00:00+05:00', end_at: day + 'T20:00:00+05:00', record_id: 'DISPATCH:19' }] },
  ] }],
  combat_groups: [{ shift_id: 31, group_name: 'Боевая группа 1', route_label: 'Маршрут 1', division_name: 'Первое управление', department_id: 4, department_name: 'Первый департамент', leader_name: 'Старший Группы', member_names: ['Состав Группы'], reserve_names: [], stage_label: 'Согласовано', actual_member_names: null, actual_start: null, actual_end: null }],
};
async function boot(page: Page, permissions = ['duty.view', 'status.view', 'status.workspace', 'status.manage', 'duty.dispatch', 'object.view']) {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions, roles: [] } }));
  await page.route('**/api/ops/duty-register/roster/**', route => route.fulfill({ json: { ...roster, business_date: new URL(route.request().url()).searchParams.get('business_date') ?? day } }));
}

test('single journal entry shows status placement and existing combat groups without repeat assignment', async ({ page }) => {
  await boot(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Боевое дежурство по Службе', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Расстановка дежурств', exact: true })).toHaveCount(0);
  const composition = page.getByRole('region', { name: 'Состав наряда' });
  await expect(composition.getByText('Наряд Из Статуса', { exact: true })).toBeVisible();
  await expect(composition.getByText('Объект Восток · Пост 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Боевая группа 1', { exact: true })).toBeVisible();
  await expect(composition.getByRole('button', { name: 'Назначить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Статусы на 16.10.2026', exact: true })).toHaveAttribute('href', `/statuses/?view=calendar&statusDate=${day}`);
  await page.getByLabel('Поиск в составе', { exact: true }).fill('пост 2');
  await expect(composition.getByText('Наряд Из Статуса', { exact: true })).toBeVisible();
  await expect(composition.getByText('Почасовой Сотрудник', { exact: true })).toHaveCount(0);
});

test('status roster shows only exits intersecting its date and distinguishes unknown hours from no exits', async ({ page, businessWrites }) => {
  await boot(page, ['duty.view']);
  const intervals = [
    { start_at: day + 'T08:30:00+05:00', end_at: day + 'T12:00:00+05:00' },
    { start_at: day + 'T22:00:00+05:00', end_at: '2026-10-17T04:00:00+05:00' },
    { start_at: '2026-10-18T09:00:00+05:00', end_at: '2026-10-18T11:00:00+05:00' },
  ];
  let schedule: typeof intervals | undefined = intervals;
  await page.route('**' + api + '**', route => route.fulfill({ json: { ...roster,
    departments: [{ ...roster.departments[0], employees: [{ ...roster.departments[0].employees[0], placements: [{
      ...roster.departments[0].employees[0].placements[0], ...(schedule === undefined ? {} : { intervals: schedule, time_zone: 'Asia/Almaty' }),
    }] }] }],
  } }));
  await page.goto(path + '?date=' + day);
  const composition = page.getByRole('region', { name: 'Состав наряда' });
  await expect(composition).toContainText('16.10.2026 08:30 — 16.10.2026 12:00');
  await expect(composition).toContainText('16.10.2026 22:00 — 17.10.2026 04:00');
  await expect(composition).not.toContainText('18.10.2026 09:00');
  schedule = [];
  await page.getByRole('button', { name: 'Обновить состав', exact: true }).click();
  await expect(composition).toContainText('Выходов на выбранную дату нет.');
  schedule = undefined;
  await page.getByRole('button', { name: 'Обновить состав', exact: true }).click();
  await expect(composition).toContainText('Время выходов не указано. Круглосуточное нахождение на посту не подтверждено.');
  expect(businessWrites).toEqual([]);
});

test('composition filters unplaced people and stays usable on narrow screens', async ({ page }) => {
  await boot(page, ['duty.view']);
  await page.goto(path + '?date=' + day);
  await page.getByRole('combobox', { name: 'Размещение наряда', exact: true }).selectOption('unassigned');
  const composition = page.getByRole('region', { name: 'Состав наряда' });
  await expect(composition.getByText('Выделенный Сотрудник', { exact: true })).toBeVisible();
  await expect(composition.getByText('Наряд Из Статуса', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Статусы на / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Почасовые смены', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('body').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

test('status read and write rights do not offer a journal link to an unavailable status workspace', async ({ page, businessWrites }) => {
  await boot(page, ['duty.view', 'status.view', 'status.manage']);
  await page.goto(path + '?date=' + day);
  await expect(page.getByRole('region', { name: 'Состав наряда' }).getByText('Наряд Из Статуса', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Статусы на / })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('legacy combat and dispatch URLs preserve dates inside the unified journal', async ({ page }) => {
  await boot(page);
  await page.route('**/api/ops/duty-dispatch/**', route => route.fulfill({ json: { business_date: day, receiver: null, can_configure: false, can_assign: true, can_cancel: true, people: [], assignments: [] } }));
  await page.goto('/security-ops/combat-duty/?date=' + day);
  await expect(page).toHaveURL(new RegExp('/duty-register/\\?.*section=roster'));
  await expect(page.getByLabel('Дата состава', { exact: true })).toHaveValue(day);
  await page.goto('/security-ops/duty-dispatch/?date=' + day);
  await expect(page).toHaveURL(new RegExp('/duty-register/\\?.*section=shifts'));
  await expect(page.getByLabel('Дата дежурства', { exact: true })).toHaveValue(day);
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toHaveCount(1);
});

test('status placements do not appear in the hourly waiting queue', async ({ page }) => {
  await boot(page);
  await page.route('**/api/ops/duty-dispatch/**', route => route.fulfill({ json: { business_date: day, receiver: { id: 4, name: 'Первый департамент' }, can_configure: false, can_assign: true, can_cancel: true, people: [
    { employee_id: 7, status_id: 17, full_name: 'Наряд Из Статуса', status_label: 'На дежурстве', date_start: day, date_end: day, department_name: 'Первый департамент', legacy_assignment: { kind: 'POST', object_name: 'Объект Восток' }, unavailable_reason: 'У сотрудника уже есть наряд в кадровом статусе.' },
    { employee_id: 8, status_id: 18, full_name: 'Выделенный Сотрудник', status_label: 'На дежурстве', date_start: day, date_end: day, department_name: 'Первый департамент', unavailable_reason: null },
  ], assignments: [] } }));
  await page.goto(path + '?section=shifts&date=' + day);
  await expect(page.getByRole('tab', { name: /Ожидают расстановки · 1/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Наряд Из Статуса' })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: 'Выделенный Сотрудник' })).toBeVisible();
});

test('a denied composition stays hidden after a later temporary failure', async ({ page }) => {
  await boot(page, ['duty.view']);
  await page.goto(path + '?date=' + day);
  await expect(page.getByText('Наряд Из Статуса', { exact: true })).toBeVisible();
  for (const status of [403, 503]) {
    await page.route('**' + api + '**', route => route.fulfill({ status, json: { detail: 'Unavailable' } }));
    await page.getByRole('button', { name: 'Обновить состав', exact: true }).click();
    await expect(page.getByText('Наряд Из Статуса', { exact: true })).toHaveCount(0);
  }
});

test('admin roles alone opens hourly configuration without reading personnel or journal records', async ({ page }) => {
  await boot(page, ['admin.roles']);
  const reads: string[] = [];
  await page.route('**/api/ops/duty-register/**', route => { reads.push(route.request().url()); return route.fulfill({ status: 403, json: {} }); });
  await page.route('**/api/ops/duty-dispatch/**', route => route.fulfill({ json: { business_date: day, receiver: null, can_configure: true, receiver_options: [{ id: 4, name: 'Первый департамент' }], can_assign: false, can_cancel: false, people: [], assignments: [] } }));
  await page.goto(path);
  await expect(page.getByRole('combobox', { name: 'Департамент-получатель', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Состав на дату', exact: true })).toHaveCount(0);
  expect(reads).toEqual([]);
});

test('composition search and filters survive reload and switching to control', async ({ page, businessWrites }) => {
  await boot(page, ['duty.view']);
  await page.goto(path + '?date=' + day);
  const search = page.getByLabel('Поиск в составе', { exact: true });
  await search.pressSequentially('пост 2', { delay: 15 });
  await expect(search).toHaveValue('пост 2');
  await expect.poll(() => new URL(page.url()).searchParams.get('roster_search')).toBe('пост 2');
  await page.getByRole('combobox', { name: 'Подразделение', exact: true }).selectOption('4');
  await page.reload();
  await expect(search).toHaveValue('пост 2');
  await expect(page.getByRole('combobox', { name: 'Подразделение', exact: true })).toHaveValue('4');
  await page.getByRole('link', { name: 'Журнал и контроль', exact: true }).click();
  await page.getByRole('link', { name: 'Состав на дату', exact: true }).click();
  await expect(search).toHaveValue('пост 2');
  await expect(page.getByRole('region', { name: 'Состав наряда' }).getByText('Почасовой Сотрудник', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('roster_search')).toBe(false);
  expect(businessWrites).toEqual([]);
});

test('composition shortcuts follow server today and keep a linked control day in sync', async ({ page }) => {
  await boot(page, ['duty.view']);
  await page.goto(path + '?section=roster&date=' + day + '&from=' + day + '&to=' + day);
  await page.getByRole('button', { name: 'Следующий день', exact: true }).click();
  await expect(page.getByLabel('Дата состава', { exact: true })).toHaveValue('2026-10-17');
  await page.getByRole('link', { name: 'Журнал и контроль', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe('2026-10-17');
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe('2026-10-17');
  await page.getByRole('link', { name: 'Состав на дату', exact: true }).click();
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.getByLabel('Дата состава', { exact: true })).toHaveValue(day);
  await page.getByRole('button', { name: 'Показать без поста или группы', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Размещение наряда', exact: true })).toHaveValue('unassigned');
  await expect(page.getByText('Выделенный Сотрудник', { exact: true })).toBeVisible();
});

test('composition page is shareable and restored after a reload', async ({ page }) => {
  await boot(page, ['duty.view']);
  const employees = Array.from({ length: 31 }, (_, index) => ({ ...roster.departments[0].employees[1], employee_id: index + 100, full_name: 'Сотрудник ' + String(index + 1).padStart(2, '0') }));
  await page.route('**/api/ops/duty-register/roster/**', route => route.fulfill({ json: { ...roster, departments: [{ ...roster.departments[0], employees }], combat_groups: [] } }));
  await page.goto(path + '?date=' + day);
  await page.getByRole('navigation', { name: 'Страницы состава', exact: true }).getByRole('button', { name: 'Далее', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('roster_page')).toBe('2');
  await page.reload();
  await expect(page.getByText('Сотрудник 26', { exact: true })).toBeVisible();
  await expect(page.getByText('Сотрудник 01', { exact: true })).toHaveCount(0);
});

test('people outside a department keep their own composition filter after reload', async ({ page }) => {
  await boot(page, ['duty.view']);
  await page.route('**/api/ops/duty-register/roster/**', route => route.fulfill({ json: { ...roster, departments: [
    roster.departments[0], { id: 0, name: 'Без департамента', employees: [{ ...roster.departments[0].employees[1], employee_id: 99, full_name: 'Без Штатной Привязки' }] },
  ] } }));
  await page.goto(path + '?date=' + day);
  const division = page.getByRole('combobox', { name: 'Подразделение', exact: true });
  await division.selectOption('0');
  await expect(division).toHaveValue('0');
  await page.reload();
  await expect(division).toHaveValue('0');
  await expect(page.getByText('Без Штатной Привязки', { exact: true })).toBeVisible();
  await expect(page.getByText('Наряд Из Статуса', { exact: true })).toHaveCount(0);
});
