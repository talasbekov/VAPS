import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

function unit(id: number, divisionId = 7, occupied = true) {
  return { id, division: { id: divisionId, name: `Отдел ${divisionId}`, code: `D${divisionId}` },
    directorate_id: 7, directorate_name: 'Проверочное управление', department_name: 'Проверочный департамент',
    position: { id: 1, name: 'Сотрудник', name_kz: 'Қызметкер' },
    employee: occupied ? { id, first_name: `№${id}`, last_name: 'Сотрудник', middle_name: '', current_status: null } : null };
}

async function prepare(page: Page, restricted = false, holdSecondPage = false, total = 100) {
  const rows = restricted ? [unit(1), unit(2, 9), unit(3, 7, false)] : Array.from({ length: total }, (_, index) => unit(index + 1));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const state = { reads: [] as number[], metadata: [] as number[][], failMetadata: false, release };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage'], global_permissions: restricted ? ['status.view'] : ['status.view', 'status.workspace', 'status.manage'],
    status_manage_division_ids: restricted ? [7] : null,
  } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', async route => {
    const params = new URL(route.request().url()).searchParams;
    const pageNumber = Number(params.get('page') || 1);
    state.reads.push(pageNumber);
    const wanted = params.get('employee_ids')?.split(',').map(Number);
    if (wanted) {
      state.metadata.push(wanted);
      if (wanted.length > 200) return route.fulfill({ status: 422, json: { employee_ids: 'Не больше 200 за раз' } });
      if (state.failMetadata && wanted.includes(201)) return route.fulfill({ status: 503, json: { detail: 'Вторая пачка временно недоступна' } });
    }
    if (pageNumber === 2 && holdSecondPage) await pending;
    const pageSize = Number(params.get('page_size') || rows.length);
    const matched = params.get('search') ? [] : wanted ? rows.filter(row => row.employee && wanted.includes(row.employee.id)) : rows;
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

test('bulk status selection excludes vacancies and employees outside the editing scope', async ({ page, businessWrites }) => {
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

async function selectFivePages(page: Page) {
  for (let current = 1; current <= 5; current++) {
    await expect(page.getByText(`Сотрудник №${(current - 1) * 50 + 1}`, { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
    if (current < 5) await page.getByRole('button', { name: 'Далее', exact: true }).click();
  }
  await expect(page.getByText(/Выбрано: 250\b/)).toBeVisible();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
}

test('250 selected employees are checked in bounded requests before enabling the bulk status form', async ({ page, businessWrites }) => {
  const state = await prepare(page, false, false, 250);
  await selectFivePages(page);
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  expect(state.metadata.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...state.metadata.map(ids => ids.length))).toBeLessThanOrEqual(200);
  expect(new Set(state.metadata.flat()).size).toBe(250);
  expect(businessWrites).toEqual([]);
});

test('a failed metadata batch blocks bulk editing and a retry checks the complete selection', async ({ page, businessWrites }) => {
  const state = await prepare(page, false, false, 250);
  state.failMetadata = true;
  await selectFivePages(page);
  await expect(page.getByText('Не удалось проверить выбранных сотрудников. Повторите загрузку перед изменением статусов.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
  state.failMetadata = false;
  await page.getByRole('button', { name: 'Повторить проверку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  expect(Math.max(...state.metadata.map(ids => ids.length))).toBeLessThanOrEqual(200);
  expect(businessWrites).toEqual([]);
});

test('clearing the bulk form resets its fields and validation while retaining the selected people', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Черновик массового изменения');
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect(page.getByText('Выберите статус.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить форму', exact: true }).click();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('');
  await expect(page.getByText('Выберите статус.', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Таблица сотрудников', exact: true }).click();
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a known partial bulk update retains its draft and retries only the failed employee', async ({ page, businessWrites }) => {
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  await prepare(page, false, false, 3);
  const submitted: Record<string, unknown>[] = [];
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    submitted.push(body);
    return route.fulfill({ json: submitted.length === 1
      ? { success: true, updated: { statuses: 2 }, errors: [{ status: 'Вторая строка временно недоступна', section: 'employee_statuses', index: 1 }], rolled_back: false }
      : { success: true, updated: { statuses: 1 }, rolled_back: false } });
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Исходный массовый черновик');
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Исходный массовый черновик');
  await expect(page.getByText('Вторая строка временно недоступна', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Новый статус/ })).toHaveText(/На службе/);
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect((submitted[0].employee_statuses as { employee: number }[]).map(item => item.employee)).toEqual([1, 2, 3]);
  expect((submitted[1].employee_statuses as { employee: number }[]).map(item => item.employee)).toEqual([2]);
  expect(businessWrites).toEqual([]);
});

test('an ambiguous partial response preserves the draft and blocks replay until it is explicitly cleared', async ({ page, businessWrites }) => {
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  await prepare(page, false, false, 3);
  let requests = 0;
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    return route.fulfill({ json: { success: true, updated: { statuses: 2 }, errors: ['Одна строка не обновлена'] } });
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Черновик с неясным результатом');
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Черновик с неясным результатом');
  await expect(page.getByText('Результат не подтверждён. Проверьте статусы выбранных сотрудников в таблице перед новым изменением.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Очистить форму', exact: true }).click();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('a late partial response preserves a selection changed while the request was pending', async ({ page, businessWrites }) => {
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  const state = await prepare(page, false, false, 3);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/staff_unit/staff-units/directorate/**', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    started = true;
    await held;
    return route.fulfill({ json: { success: true, updated: { statuses: 2 }, errors: [{ status: 'Ошибка второй строки', section: 'employee_statuses', index: 1 }] } });
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  const response = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/staff_unit/staff-units/directorate/');
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  let readsBeforeRelease = 0;
  try {
    await expect.poll(() => started).toBe(true);
    await page.getByRole('tab', { name: 'Таблица сотрудников', exact: true }).click();
    await page.getByRole('button', { name: 'Снять весь выбор', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №3', exact: true }).check();
    readsBeforeRelease = state.reads.length;
  } finally { release(); }
  await response;
  await expect.poll(() => state.reads.length).toBeGreaterThan(readsBeforeRelease);
  await expect(page.getByText('Ошибка второй строки', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №3', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №2', exact: true })).not.toBeChecked();
  expect(businessWrites).toEqual([]);
});

test('a refused bulk request preserves the draft and permits a corrected retry', async ({ page, businessWrites }) => {
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  await prepare(page, false, false, 1);
  let requests = 0;
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    return requests === 1
      ? route.fulfill({ status: 400, json: { detail: 'Исправьте данные перед повтором' } })
      : route.fulfill({ json: { success: true, updated: { statuses: 1 }, errors: [] } });
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Черновик после отказа');
  const apply = page.getByRole('button', { name: 'Применить изменения', exact: true });
  await apply.click();
  await expect(page.getByText('Исправьте данные перед повтором', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Черновик после отказа');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('');
  expect(businessWrites).toEqual([]);
});

test('an unknown transport outcome preserves the draft and prevents an immediate replay', async ({ page, businessWrites }) => {
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  await prepare(page, false, false, 1);
  let requests = 0;
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    return route.abort('failed');
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудников на этой странице', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Черновик после обрыва');
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect(page.getByText('Результат не подтверждён. Проверьте статусы выбранных сотрудников в таблице перед новым изменением.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Черновик после обрыва');
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
  expect(requests).toBe(1);
  expect(businessWrites).toEqual([]);
});

test('bulk status catalogue failure can be retried without losing the selected people or comment', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route('**/api/statuses/types/**', route => fail
    ? route.fulfill({ status: 503, json: { detail: 'Каталог временно недоступен' } })
    : route.fulfill({ json: [{ code: 'in_service', label: 'На службе', color: '' }] }));
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Массовый черновик');
  const retry = page.getByRole('button', { name: 'Повторить загрузку типов статусов', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
  fail = false;
  await retry.click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await expect(page.getByLabel('Комментарий', { exact: true })).toHaveValue('Массовый черновик');
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Таблица сотрудников', exact: true }).click();
  await expect(page.getByText(/Выбрано: 1\b/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('the bulk form previews the actual indefinite in-service period after a reversed temporary draft', async ({ page, businessWrites }) => {
  await page.clock.install({ time: new Date('2026-10-12T14:00:00Z') });
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-13' } }));
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  const status = page.getByRole('combobox', { name: /^Новый статус/ });
  await status.click();
  await page.getByRole('option', { name: 'В командировке', exact: true }).click();
  await page.getByRole('button', { name: /^Дата начала/ }).click();
  await page.locator('[data-slot=calendar]').getByRole('button', { name: /20 октября 2026/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot=calendar]')).toHaveCount(0);
  await page.getByRole('button', { name: /^Дата окончания/ }).click();
  await page.locator('[data-slot=calendar]').getByRole('button', { name: /10 октября 2026/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot=calendar]')).toHaveCount(0);
  await status.click();
  await page.getByRole('option', { name: 'В строю', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Дата начала|^Дата окончания/ })).toHaveCount(0);
  await expect(page.getByText('С 12.10.2026 · без даты окончания', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('bulk readiness names missing dates for a temporary status before submitting', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'В командировке', exact: true }).click();
  await expect(page.getByText('Укажите даты начала и окончания', { exact: true })).toBeVisible();
  await expect(page.getByText('Период указан', { exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('all three status tabs fit their mobile navigation and remain reachable with the keyboard', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  const sizes = await tabs.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll, 'The tab labels must fit without a clipped horizontal strip').toBeLessThanOrEqual(sizes.width);
  const table = tabs.getByRole('tab', { name: 'Таблица сотрудников', exact: true });
  await table.focus();
  await table.press('End');
  await expect(tabs.getByRole('tab', { name: 'Массовое обновление', exact: true })).toBeFocused();
  await expect(page.getByText('Массовое обновление статусов', { exact: true })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(table).toBeFocused();
  await expect(page.getByText('Сотрудник №1', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a renamed in-service catalog entry saves an indefinite status using the server day', async ({ page, businessWrites }) => {
  await page.clock.install({ time: new Date('2026-10-12T12:00:00Z') });
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'in_service', label: 'На службе', color: '' },
    { code: 'business_trip', label: 'В командировке', color: '' },
  ] }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-14' } }));
  await prepare(page);
  let submitted: unknown = null;
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, updated: { staff_units: 0, employees: 0, statuses: 1 }, errors: [] } });
  });
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await page.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'На службе', exact: true }).click();
  await expect(page.getByText('С 13.10.2026 · без даты окончания', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Применить изменения', exact: true }).click();
  await expect.poll(() => submitted).toEqual({ employee_statuses: [{ employee: 1, status_type: 'in_service', start_date: '2026-10-13' }] });
  expect(businessWrites).toEqual([]);
});

test('bulk saving waits for a delayed server date and becomes available after it arrives', async ({ page, businessWrites }) => {
  let release!: () => void;
  let started = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operations/tomorrow-block/**', async route => {
    started++;
    await held;
    return route.fulfill({ json: { business_date: '2026-10-14' } });
  });
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
    await expect.poll(() => started).toBeGreaterThan(0);
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('bulk server-date failure has a working retry before applying a status', async ({ page, businessWrites }) => {
  let recovered = false;
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill(recovered
    ? { json: { business_date: '2026-10-14' } }
    : { status: 503, json: { detail: 'Date temporarily unavailable' } }));
  await prepare(page);
  await page.getByRole('checkbox', { name: 'Выбрать сотрудника: Сотрудник №1', exact: true }).check();
  await page.getByRole('tab', { name: 'Массовое обновление', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить загрузку даты', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeDisabled();
  recovered = true;
  await page.getByRole('button', { name: 'Повторить загрузку даты', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Применить изменения', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});
