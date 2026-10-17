import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const context = 'view=forces&search=Профиль&department=7&page=2&businessDate=2026-10-13';

async function prepare(page: Page) {
  const row = { id: 61, division: { id: 7, name: 'Отдел проверки' }, position: { id: 1, name: 'Сотрудник' },
    employee: { id: 61, first_name: 'Проверка', last_name: 'Профиль', current_status: { status_type: 'vacation', start_date: '2026-10-01', end_date: '2026-10-31' } } };
  const state = { fail: false, missing: false, errorStatus: 400, returnedId: null as number | null, profileReads: [] as string[] };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: '2026-10-13', rows: [], totals: {} } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', route => {
    const params = new URL(route.request().url()).searchParams;
    const isProfile = params.has('employee_ids');
    if (isProfile) state.profileReads.push(params.toString());
    if (isProfile && state.fail) return route.fulfill({ status: state.errorStatus, json: { detail: 'Не удалось прочитать карточку' } });
    const selectedId = state.returnedId ?? Number(params.get('employee_ids') || 61);
    const selected = { ...row, employee: { ...row.employee, id: selectedId, first_name: selectedId === 61 ? 'Проверка' : 'Другой' } };
    return route.fulfill({ json: { division: null, staff_units: isProfile && state.missing ? [] : [isProfile ? selected : row],
      total_count: 1, matched_count: isProfile ? 1 : 61, page: isProfile ? 1 : 2, page_size: isProfile ? 1 : 50, has_next: false } });
  });
  await signIn(page);
  return state;
}

test('opening a name goes directly to its profile and closing restores the list context', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?' + context + '&tab=table');
  await page.locator('tr[data-employee-id="61"]').getByText('Профиль Проверка', { exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('employee')).toBe('61');
  await expect(page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Экспорт CSV', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(panel.locator('tr[data-employee-id="61"]')).toBeVisible();
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of new URLSearchParams(context)) expect(params.get(key)).toBe(value);
  expect(params.has('employee')).toBe(false);
  expect(params.has('returnTab')).toBe(false);
  expect(businessWrites).toEqual([]);
});

test('an employee profile URL survives reload and uses a bounded scoped read', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await prepare(page);
  await page.goto('/employees/?' + context + '&tab=cards&employee=61');
  const heading = page.getByRole('heading', { name: 'Профиль Проверка', exact: true });
  await expect(heading).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
  expect(state.profileReads.length).toBeGreaterThanOrEqual(2);
  for (const query of state.profileReads) {
    const params = new URLSearchParams(query);
    expect(params.get('employee_ids')).toBe('61');
    expect(params.get('page')).toBe('1');
    expect(params.get('page_size')).toBe('1');
    expect(params.has('search')).toBe(false);
  }
  await page.getByRole('tabpanel').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Карточки', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('opening a profile cancels a pending search commit without replacing the profile address', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?' + context + '&tab=table');
  const row = page.locator('tr[data-employee-id="61"]');
  await expect(row).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('Не применять этот отбор');
  await row.getByRole('button', { name: 'Профиль Проверка', exact: true }).click();
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  expect(new URL(page.url()).searchParams.get('employee')).toBe('61');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Профиль');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(businessWrites).toEqual([]);
});

test('a name is keyboard accessible and browser back restores the selected list', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?' + context + '&tab=table');
  const name = page.locator('tr[data-employee-id="61"]').getByRole('button', { name: 'Профиль Проверка', exact: true });
  await name.focus();
  await name.press('Enter');
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(name).toBeFocused();
  await name.press('Enter');
  await page.goBack();
  await expect(page.getByRole('tabpanel').locator('tr[data-employee-id="61"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(businessWrites).toEqual([]);
});

for (const id of ['', 'bad', '9007199254740992']) {
  test(`a profile link with invalid employee ${id || '(missing)'} explains the problem without requesting another employee`, async ({ page, businessWrites }) => {
    const state = await prepare(page);
    await page.goto('/employees/?view=forces&tab=profile&employee=' + id);
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('В ссылке не указан корректный сотрудник.', { exact: true })).toBeVisible();
    expect(state.profileReads).toEqual([]);
    await panel.getByRole('button', { name: 'Вернуться к списку', exact: true }).click();
    await expect(panel.locator('tr[data-employee-id="61"]')).toBeVisible();
    await expect(panel).toBeFocused();
    expect(businessWrites).toEqual([]);
  });
}

test('an unavailable employee shows a safe return and a failed read can be retried', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.missing = true;
  await page.goto('/employees/?view=forces&tab=profile&employee=61');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Сотрудник не найден или недоступен в вашей области.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Вернуться к списку', exact: true })).toBeVisible();
  state.missing = false;
  state.fail = true;
  await page.reload();
  await expect(panel.getByText('Не удалось прочитать карточку', { exact: true })).toBeVisible();
  state.fail = false;
  await panel.getByRole('button', { name: 'Повторить загрузку профиля', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('a profile read waits for permissions and stays closed for forces without status rights', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/api/operations/my-permissions/**', async route => {
    requested = true;
    await waiting;
    return route.fulfill({ json: { permissions: ['forces.allocate'], global_permissions: ['forces.allocate'], roles: [] } });
  });
  await page.goto('/employees/?view=forces&tab=profile&employee=61');
  try {
    await expect.poll(() => requested).toBe(true);
    await page.waitForTimeout(500);
    expect(state.profileReads).toEqual([]);
  } finally { release(); }
  await expect(page.getByText('Списки сотрудников и показатели расхода доступны с правом «Статусы: просмотр».', { exact: true })).toBeVisible();
  expect(state.profileReads).toEqual([]);
  expect(businessWrites).toEqual([]);
});

for (const status of [400, 403]) {
  test(`a late list ${status} cannot replace an independently loaded profile`, async ({ page, businessWrites }) => {
    await prepare(page);
    await page.goto('/employees/?' + context + '&tab=table');
    await expect(page.locator('tr[data-employee-id="61"]')).toBeVisible();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', async route => {
      if (new URL(route.request().url()).searchParams.has('employee_ids')) return route.fallback();
      requested = true;
      await waiting;
      return route.fulfill({ status, json: { detail: 'Отказ фонового списка' } });
    });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    try {
      await page.locator('tr[data-employee-id="61"]').getByRole('button', { name: 'Профиль Проверка', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
    } finally { release(); }
    await page.waitForTimeout(600);
    await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Закрыть', exact: true })).toBeVisible();
    expect(businessWrites).toEqual([]);
  });
}

test('history Forward cancels a list search that has not yet been committed', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?' + context + '&tab=table');
  await page.locator('tr[data-employee-id="61"]').getByRole('button', { name: 'Профиль Проверка', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('tr[data-employee-id="61"]')).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск по сотрудникам', exact: true }).fill('Не применять после Forward');
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  const params = new URL(page.url()).searchParams;
  expect(params.get('employee')).toBe('61');
  expect(params.get('search')).toBe('Профиль');
  expect(params.get('page')).toBe('2');
  expect(businessWrites).toEqual([]);
});

test('a changed permission scope requires a fresh profile read and removes the previously available employee', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  let scope = 7;
  let permissionReads = 0;
  await page.route('**/api/operations/my-permissions/**', route => {
    permissionReads++;
    return route.fulfill({ json: { permissions: ['forces.allocate', 'status.view'], global_permissions: [],
      roles: [{ code: 'UX_SCOPED', name: 'Проверка области', scope_division_id: scope, scope_division_name: 'Область проверки' }] } });
  });
  await page.goto('/employees/?view=forces&tab=table&employee=61');
  const heading = page.getByRole('heading', { name: 'Профиль Проверка', exact: true });
  await expect(heading).toBeVisible();
  const initialReads = state.profileReads.length;
  const initialPermissions = permissionReads;
  scope = 8;
  state.missing = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => permissionReads).toBeGreaterThan(initialPermissions);
  await expect(page.getByText('Сотрудник не найден или недоступен в вашей области.', { exact: true })).toBeVisible();
  expect(state.profileReads.length).toBeGreaterThan(initialReads);
  await expect(heading).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

for (const status of [403, 503]) {
  test(`profile HTTP ${status} shows a cause and retries without changing the return context`, async ({ page, businessWrites }) => {
    const state = await prepare(page);
    state.fail = true;
    state.errorStatus = status;
    await page.goto('/employees/?' + context + '&tab=table&employee=61');
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('Не удалось прочитать карточку', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Вернуться к списку', exact: true })).toBeVisible();
    state.fail = false;
    await panel.getByRole('button', { name: 'Повторить загрузку профиля', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('page')).toBe('2');
    expect(businessWrites).toEqual([]);
  });
}

test('a mismatched employee response cannot show another person in the requested profile', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.returnedId = 62;
  await page.goto('/employees/?view=forces&tab=table&employee=61');
  await expect(page.getByText('Сотрудник не найден или недоступен в вашей области.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Профиль Другой', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('an employee ID cannot bypass the list visibility of a forces selector', async ({ page, businessWrites }) => {
  await prepare(page);
  // The authenticated seeded user is in division 19; the returned fixture is in 7.
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['forces.select', 'status.view'], global_permissions: [], roles: [] } }));
  await page.goto('/employees/?view=forces&tab=table&employee=61');
  await expect(page.getByText('Сотрудник не найден или недоступен в вашей области.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('switching profile IDs never shows the previous employee while the next read is pending', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/employees/?view=forces&tab=table&employee=61');
  await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', async route => {
    if (new URL(route.request().url()).searchParams.get('employee_ids') !== '62') return route.fallback();
    requested = true;
    await waiting;
    return route.fallback();
  });
  // Next's client history integration keeps this document and its query cache.
  await page.evaluate(() => window.history.pushState(null, '', '/employees/?view=forces&tab=table&employee=62'));
  try {
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByText('Загрузка профиля сотрудника…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Профиль Другой', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const tab of ['assigned', 'in-service', 'cards'] as const) {
  test(`a restored ${tab} profile retains its status source and returns to that list`, async ({ page, businessWrites }) => {
    await prepare(page);
    if (tab === 'in-service') {
      await page.route(url => url.pathname === '/api/staff_unit/staff-units/directorate/', async route => {
        if (!new URL(route.request().url()).searchParams.has('page')) await new Promise(resolve => setTimeout(resolve, 600));
        return route.fallback();
      });
    }
    await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: '2026-10-13',
      rows: [{ division_id: 7, name: 'Отдел проверки', staff_total: 1, list_total: 1, columns: { IN_SERVICE: 1 } }],
      totals: { staff_total: 1, list_total: 1, columns: { IN_SERVICE: 1 } } } }));
    await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [
      { code: 'IN_EVENT', name: 'Участие в ОМ', report_column_code: 'IN_SERVICE' },
      { code: 'IN_SERVICE', name: 'В строю', report_column_code: 'IN_SERVICE' } ] } }));
    await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 1, next: null, results: [
      { id: 11, employee_id: 61, status_type_code: tab === 'assigned' ? 'IN_EVENT' : 'IN_SERVICE', date_start: '2026-10-13', date_end: '2026-10-14', state: 'ACTIVE' } ] } }));
    await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [{ id: '61', full_name: 'Профиль Проверка', rank_code: '', division_id: 7 }] } }));
    await page.goto('/employees/?view=forces&tab=' + tab + '&employee=61&businessDate=2026-10-13');
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { name: 'Профиль Проверка', exact: true })).toBeVisible();
    const start = tab === 'cards' ? '1 октября 2026' : '13 октября 2026';
    const end = tab === 'cards' ? '31 октября 2026' : '13 октября 2026';
    await expect(panel.getByText('Статус с', { exact: true }).locator('..')).toHaveText(new RegExp(start));
    await expect(panel.getByText('Статус по', { exact: true }).locator('..')).toHaveText(new RegExp(end));
    await page.reload();
    await expect(panel.getByText('Статус по', { exact: true }).locator('..')).toHaveText(new RegExp(end));
    await panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('tab', { name: tab === 'cards' ? 'Карточки' : tab === 'assigned' ? 'Участие в ОМ (1)' : 'В строю (1)', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('button', { name: 'Профиль Проверка', exact: true })).toBeFocused();
    expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-13');
    expect(businessWrites).toEqual([]);
  });
}
