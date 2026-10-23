import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const catalog = [
  { code: 'IN_SERVICE', name: 'В строю' },
  { code: 'DUTY', name: 'На дежурстве' },
  { code: 'REST_AFTER_DUTY', name: 'Отдых после дежурства' },
  { code: 'IN_EVENT', name: 'Участие в ОМ' },
  { code: 'VACATION', name: 'В отпуске' },
  { code: 'SICK_LEAVE', name: 'На больничном' },
  { code: 'COMMAND', name: 'В командировке' },
];
const divisions = [
  { id: '7301', name: 'Учебное управление А', parent_id: null },
  { id: '7302', name: 'Учебный отдел Б', parent_id: '7301' },
];
const people = Array.from({ length: 62 }, (_, index) => ({
  id: String(8601 + index),
  name: index === 2 ? 'Учебная-Длиннаяфамилия Аружан Сериковна' : `Учебный сотрудник ${String(index + 1).padStart(2, '0')}`,
  rank: 'Сержант',
  division: divisions[index % 2],
}));

// The real board and matrix render synthetic HTTP responses. Business writes
// remain blocked by ux-fixture, including if a layout change triggers an action.
async function prepare(page: Page) {
  const reads: URL[] = [];
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+05:00'));
  await page.addInitScript(() => {
    localStorage.setItem('sidebarOpen', 'true');
    localStorage.setItem('sidebarWidth', '256');
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace'], global_permissions: ['status.view'], status_manage_division_ids: [], roles: [],
  } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, staff_units: [], total_count: 62, matched_count: 0, page: 1, page_size: 50, has_next: false,
    summary: { employees: 62, without_status: 0, overdue: 0, scheduled: 0 },
  } }));
  await page.route('**/api/ops/status-calendar/**', route => {
    const url = new URL(route.request().url());
    reads.push(url);
    if (url.pathname.endsWith('/divisions/')) return route.fulfill({ json: { results: divisions } });
    const query = (url.searchParams.get('search') ?? '').toLowerCase();
    const division = url.searchParams.get('division_id');
    const matches = people.filter(row => row.name.toLowerCase().includes(query) &&
      (!division || row.division.id === division || row.division.parent_id === division));
    if (url.pathname.endsWith('/day/')) return route.fulfill({ json: {
      date: url.searchParams.get('date'), total: matches.length, in_service: matches.length,
      groups: { on_duty: { count: 0, has_more: false, employees: [] }, on_event: { count: 0, has_more: false, employees: [] },
        absent: { count: 0, has_more: false, employees: [] } },
    } });
    const month = url.searchParams.get('month') ?? '2026-10';
    const length = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const days = Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
    const currentPage = Number(url.searchParams.get('page') ?? 1);
    const rows = matches.slice((currentPage - 1) * 24, currentPage * 24);
    return route.fulfill({ json: {
      month, days, catalog, count: matches.length, page: currentPage, page_size: 24,
      summary: days.map(date => ({ date, on_duty: 0, on_event: 0, absent: 0, in_service: matches.length })),
      results: rows.map(row => ({ ...row, days: days.map((_, column) => catalog[(column + people.indexOf(row)) % 7].code) })),
    } });
  });
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('tab', { name: 'Календарь статусов', exact: true }).click();
  const table = page.getByRole('table', { name: 'Статусы сотрудников по дням, Октябрь 2026', exact: true });
  await expect(table.getByRole('rowheader')).toHaveCount(24);
  return { table, reads };
}

test('desktop matrix fits all 31 days with the sidebar open and does not reserve an empty selection panel above the rows', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { table } = await prepare(page);
  await expect(page.getByRole('separator', { name: 'Ширина бокового меню', exact: true })).toBeInViewport();
  const frame = table.locator('..');
  const sizes = await frame.evaluate(element => ({ content: element.scrollWidth, frame: element.clientWidth }));
  expect.soft(sizes.content, 'All 31 days must fit the normal desktop workspace').toBeLessThanOrEqual(sizes.frame + 1);
  await expect(table.getByRole('columnheader')).toHaveCount(32);
  const row = await table.locator('tbody tr').first().boundingBox();
  expect.soft(row!.height, 'Desktop rows should leave room for the roster').toBeLessThanOrEqual(40);
  const hint = page.getByText('Выберите ячейку: здесь появятся статус, итоги месяца и действия.', { exact: true });
  const hintBox = await hint.boundingBox(), tableBox = await frame.boundingBox();
  expect.soft(hintBox!.y, 'Selection help belongs below the matrix').toBeGreaterThanOrEqual(tableBox!.y + tableBox!.height - 1);
  expect.soft((await hint.locator('..').boundingBox())!.height, 'An empty selection must stay compact').toBeLessThanOrEqual(56);
  const legend = page.getByRole('list', { name: 'Обозначения статусов', exact: true });
  for (const name of ['В строю', 'На дежурстве', 'Участие в ОМ', 'В отпуске', 'На больничном', 'В командировке']) {
    await expect(legend).toContainText(name);
  }
  await expect(table.locator('thead [aria-current="date"]')).toHaveAccessibleName('19 октября 2026 г.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('matrix keyboard navigation keeps complete employee/date/status labels and selection details', async ({ page, businessWrites }) => {
  const { table } = await prepare(page);
  const cells = table.getByRole('button');
  await table.getByRole('button', { name: 'Учебный сотрудник 01, 19 октября 2026 г., В отпуске', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(table.getByRole('button', { name: 'Учебный сотрудник 01, 20 октября 2026 г., На больничном', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(table.getByRole('button', { name: 'Учебный сотрудник 02, 20 октября 2026 г., В командировке', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cells.nth(31)).toBeFocused();
  await page.keyboard.press('End');
  await expect(table.getByRole('button', { name: 'Учебный сотрудник 02, 31 октября 2026 г., Участие в ОМ', exact: true })).toBeFocused();
  await page.keyboard.press('Control+Home');
  await expect(cells.first()).toBeFocused();
  await page.keyboard.press('Control+End');
  const last = table.getByRole('button', { name: 'Учебный сотрудник 24, 31 октября 2026 г., В отпуске', exact: true });
  await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  const context = page.getByRole('region', { name: 'Выбранная ячейка', exact: true });
  await expect(context).toContainText('Учебный сотрудник 24');
  await expect(context).toContainText('31 октября 2026');
  await expect(context).toContainText('В отпуске');
  await expect(context.getByRole('link', { name: 'Открыть профиль', exact: true })).toHaveAttribute('href', '/security-ops/profile/8624/');
  await expect(context.getByLabel('Дней по статусам за месяц', { exact: true })).toContainText('В отпуске 5');
  await expect(context).toContainText('Только просмотр');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Учебная-Длиннаяфамилия Аружан Сериковна, 1 октября 2026 г., Отдых после дежурства', exact: true })).toHaveCount(1);
  expect(businessWrites).toEqual([]);
});

for (const width of [320, 390]) test(`${width}px matrix keeps touch targets and pinned employee/day headers inside its scrolling frame`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 844 });
  const { table } = await prepare(page);
  const frame = table.locator('..');
  await frame.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await frame.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const first = table.getByRole('button').first();
  const target = await first.boundingBox();
  expect.soft(target!.width, 'Day cells must remain usable by touch').toBeGreaterThanOrEqual(44);
  expect.soft(target!.height, 'Day cells must remain usable by touch').toBeGreaterThanOrEqual(44);
  const name = table.getByRole('rowheader').first();
  const beforeName = await name.boundingBox();
  await frame.evaluate(element => { element.scrollLeft = 700; });
  const afterName = await name.boundingBox();
  expect(Math.abs(afterName!.x - beforeName!.x)).toBeLessThanOrEqual(1);
  await expect(name).toBeInViewport();
  const date = table.getByRole('columnheader').nth(17);
  const beforeDate = await date.boundingBox();
  await frame.evaluate(element => { element.scrollTop = 180; });
  const afterDate = await date.boundingBox();
  expect(Math.abs(afterDate!.y - beforeDate!.y)).toBeLessThanOrEqual(1);
  await expect(date).toBeInViewport();
  await first.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  const focused = await first.boundingBox(), label = await name.boundingBox();
  expect(focused!.x, 'Keyboard focus must not disappear behind the pinned employee column').toBeGreaterThanOrEqual(label!.x + label!.width - 1);
  await first.click();
  await expect(page.getByRole('region', { name: 'Выбранная ячейка', exact: true })).toContainText('Учебный сотрудник 01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('compact calendar filters keep server paging and reset it for a search', async ({ page, businessWrites }) => {
  const { table, reads } = await prepare(page);
  await page.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await expect(table.getByRole('rowheader').first()).toContainText('Учебный сотрудник 25');
  await page.getByRole('searchbox', { name: 'Поиск сотрудника в календаре', exact: true }).fill('сотрудник 01');
  await expect(table.getByRole('rowheader')).toHaveCount(1);
  expect(reads.filter(url => url.pathname.endsWith('/month/')).at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByLabel('Подразделение календаря', { exact: true }).selectOption('7302');
  await expect(page.getByText('Сотрудники не найдены. Измените поиск или подразделение.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(table.getByRole('rowheader')).toHaveCount(24);
  await expect(page.getByLabel('Подразделение календаря', { exact: true })).toHaveValue('');
  await expect(page.getByRole('searchbox', { name: 'Поиск сотрудника в календаре', exact: true })).toHaveValue('');
  expect(businessWrites).toEqual([]);
});
