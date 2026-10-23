import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

function unit(id: number, divisionId = 7, occupied = true) {
  return { id, division: { id: divisionId, name: `Отдел ${divisionId}`, code: `D${divisionId}` },
    directorate_id: 7, directorate_name: 'Проверочное управление', department_name: 'Проверочный департамент',
    position: { id: 1, name: 'Сотрудник', name_kz: 'Қызметкер' },
    employee: occupied ? { id, first_name: `№${id}`, last_name: 'Сотрудник', middle_name: '', current_status: null } : null };
}

async function prepare(page: Page, restricted = false, holdSecondPage = false) {
  const rows = restricted ? [unit(1), unit(2, 9), unit(3, 7, false)] : Array.from({ length: 100 }, (_, index) => unit(index + 1));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const state = { reads: [] as number[], release };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: restricted ? ['status.view'] : ['status.view', 'status.workspace', 'status.manage'],
    status_manage_division_ids: restricted ? [7] : null,
  } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', async route => {
    const params = new URL(route.request().url()).searchParams;
    const pageNumber = Number(params.get('page') || 1);
    state.reads.push(pageNumber);
    if (pageNumber === 2 && holdSecondPage) await pending;
    const pageSize = Number(params.get('page_size') || rows.length);
    const matched = params.get('search') ? [] : rows;
    const start = (pageNumber - 1) * pageSize;
    await route.fulfill({ json: { division: null, staff_units: matched.slice(start, start + pageSize), total_count: Math.min(pageSize, Math.max(0, matched.length - start)),
      matched_count: matched.length, page: pageNumber, page_size: pageSize, has_next: start + pageSize < matched.length,
      summary: { employees: rows.filter(row => row.employee).length, without_status: 0, overdue: 0, scheduled: 0 } } });
  });
  await signIn(page);
  await page.goto('/statuses/');
  await expect(page.getByText('Сотрудник №1', { exact: true })).toBeVisible();
  return state;
}

test('selecting a status page preserves the selection from other pages and reports the actual current-page state', async ({ page, businessWrites }) => {
  await prepare(page);
  const all = page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true });
  await all.check();
  await expect(page.getByText(/Выбрано: 50\b/)).toBeVisible();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByText('Сотрудник №51', { exact: true })).toBeVisible();
  await expect(all).not.toBeChecked();
  await all.check();
  await expect(page.getByText(/Выбрано: 100\b/)).toBeVisible();
  await all.uncheck();
  await expect(page.getByText(/Выбрано: 50\b/)).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByText('Сотрудник №1', { exact: true })).toBeVisible();
  await expect(all).toBeChecked();
  await page.getByRole('button', { name: 'Снять весь выбор', exact: true }).click();
  await expect(page.getByText(/Выбрано: 0\b/)).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('status selection excludes vacancies and employees outside the editing scope', async ({ page, businessWrites }) => {
  await prepare(page, true);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  await expect(page.locator('tr[data-employee-id="2"]').getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Выбор вакансии недоступен', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('status search with no results offers a reset that restores the employees without changing selection', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await page.getByRole('textbox', { name: 'Поиск сотрудников в таблице статусов', exact: true }).fill('нет такого сотрудника');
  await expect(page.getByText('Сотрудники не найдены', { exact: true })).toBeVisible();
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  await expect(page.getByText(/Выбрано: 1 из 0/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
  await expect(page.getByText('Сотрудник №1', { exact: true })).toBeVisible();
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('status selection is unavailable while a different page is still loading', async ({ page, businessWrites }) => {
  const state = await prepare(page, false, true);
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect.poll(() => state.reads.includes(2)).toBe(true);
  try { await expect(page.getByRole('checkbox').first()).toBeDisabled(); }
  finally { state.release(); }
  await expect(page.getByText('Сотрудник №51', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox').first()).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('both status tabs fit mobile navigation and the calendar remains reachable with the keyboard', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ops/status-calendar/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/divisions/')) return route.fulfill({ json: { results: [{ id: '7', name: 'Отдел 7', parent_id: null }] } });
    if (url.pathname.endsWith('/day/')) return route.fulfill({ json: {
      date: url.searchParams.get('date'), total: 1, in_service: 1,
      groups: { on_duty: { count: 0, has_more: false, employees: [] }, on_event: { count: 0, has_more: false, employees: [] }, absent: { count: 0, has_more: false, employees: [] } },
    } });
    const month = url.searchParams.get('month')!;
    const length = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const days = Array.from({ length }, (_, index) => month + '-' + String(index + 1).padStart(2, '0'));
    return route.fulfill({ json: {
      month, days, count: 1, page: 1, page_size: 100,
      catalog: [{ code: 'IN_SERVICE', name: 'В строю' }],
      summary: days.map(date => ({ date, on_duty: 0, on_event: 0, absent: 0, in_service: 1 })),
      results: [{ id: '1', name: 'Сотрудник №1', rank: '', division: { id: '7', name: 'Отдел 7' }, days: days.map(() => 'IN_SERVICE') }],
    } });
  });
  await prepare(page);
  const tabs = page.getByRole('tablist').first();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  const sizes = await tabs.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll, 'The tab labels must fit without a clipped horizontal strip').toBeLessThanOrEqual(sizes.width);
  const table = tabs.getByRole('tab', { name: 'Таблица сотрудников', exact: true });
  await table.focus();
  await table.press('End');
  await expect(tabs.getByRole('tab', { name: 'Календарь статусов', exact: true })).toBeFocused();
  await expect(page.getByRole('table', { name: /Статусы сотрудников по дням/ })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(table).toBeFocused();
  await expect(page.getByText('Сотрудник №1', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});
