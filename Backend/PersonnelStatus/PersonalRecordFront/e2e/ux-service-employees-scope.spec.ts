import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepareEditor(page: Page, url = '/service-employees/?search=Сотрудник') {
  const state = { scope: 3, grants: ['personnel.view', 'orgstructure.manage', 'admin.roles'], permissionReads: 0,
    directoryReads: [] as number[], staffingReads: [] as number[], writes: [] as object[], holdSave: false, releaseSave: () => {} };
  const saving = new Promise<void>(resolve => { state.releaseSave = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => {
    state.permissionReads++;
    return route.fulfill({ json: { permissions: state.grants, global_permissions: [], roles: [
      { code: 'EDITOR', name: 'Кадровик', scope_division_id: state.scope, scope_division_name: `Отдел ${state.scope}` },
    ] } });
  });
  await page.route('**/api/core/service-employees/**', route => {
    state.directoryReads.push(state.scope);
    const division = { id: state.scope, name: `Отдел ${state.scope}`, parent_id: null, level: 0 };
    const employee = { id: 1, full_name: `Сотрудник области ${state.scope}`, personnel_number: '1', callsign: '', rank: null,
      position: null, photo_url: null, division, current_status: { code: 'ON_DUTY', name: 'На службе', date_end: null },
      rating: null, rating_state: 'UNAVAILABLE', evaluations_count: 0, rated_events_count: 0, active_assignments_count: 0, next_assignment: null };
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/options/')
      ? { divisions: [division], statuses: [] } : new URL(route.request().url()).pathname.endsWith('/1/')
        ? { ...employee, hire_date: '2020-01-01', work_phone: `Телефон области ${state.scope}`, work_email: null, assignments: [], history: [], evaluations: [] }
        : { count: 1, next: null, previous: null, results: [employee] } });
  });
  for (const kind of ['ranks', 'positions']) await page.route(`**/api/dictionaries/${kind}/**`, route => route.fulfill({ json: { results: [{ id: 7, name: 'Назначенное значение', is_active: true }] } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', async route => {
    const snapshot = state.scope;
    if (route.request().method() !== 'GET') {
      state.writes.push(route.request().postDataJSON());
      if (state.holdSave) await saving;
    } else state.staffingReads.push(snapshot);
    return route.fulfill({ json: { staff_units: [{ id: snapshot, employee: { id: 1, first_name: 'Сотрудник', last_name: `Фамилия ${snapshot}` },
      division: { id: snapshot, name: `Отдел ${snapshot}` }, position: { id: 7, name: 'Назначенное значение' },
      management: { staff_unit_id: snapshot, middle_name: '', callsign: '', rank_id: 7, user: null, is_active: true } }] } });
  });
  await signIn(page); await page.goto(url);
  await expect(page.getByTestId('service-employee-row')).toContainText('Сотрудник области 3');
  return state;
}

async function changeScope(page: Page, state: { scope: number; permissionReads: number }, next: number) {
  const before = state.permissionReads; state.scope = next;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
  await expect(page.getByTestId('service-employee-row')).toContainText(`Сотрудник области ${next}`);
}

test('a changed division scope hides the old directory and reloads rows and filter options', async ({ page, businessWrites }) => {
  let scope = 3;
  let permissionReads = 0;
  const reads: number[] = [];
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => {
    permissionReads++;
    return route.fulfill({ json: { permissions: ['personnel.view'], global_permissions: [], roles: [
      { code: 'READER', name: 'Читатель', scope_division_id: scope, scope_division_name: `Отдел ${scope}` },
    ] } });
  });
  await page.route('**/api/core/service-employees/**', async route => {
    const snapshot = scope;
    reads.push(snapshot);
    if (snapshot === 4) await pending;
    const division = { id: snapshot, name: `Отдел ${snapshot}`, parent_id: null, level: 0 };
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/options/')
      ? { divisions: [division], statuses: [] }
      : { count: 1, next: null, previous: null, results: [{ id: snapshot, full_name: `Сотрудник области ${snapshot}`,
        personnel_number: String(snapshot), callsign: '', rank: null, position: null, photo_url: null, division,
        current_status: { code: 'ON_DUTY', name: 'На службе', date_end: null }, rating: null, rating_state: 'UNAVAILABLE',
        evaluations_count: 0, rated_events_count: 0, active_assignments_count: 0, next_assignment: null }] } });
  });
  await signIn(page);
  await page.goto('/service-employees/?search=Сотрудник');
  await expect(page.getByRole('link', { name: 'Сотрудник области 3', exact: true })).toBeVisible();
  await expect(page.getByLabel('Подразделение и подчинённые')).toContainText('Отдел 3');
  const before = permissionReads;
  scope = 4;
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => permissionReads).toBeGreaterThan(before);
    await expect(page.getByRole('link', { name: 'Сотрудник области 3', exact: true })).toHaveCount(0);
    await expect.poll(() => reads.filter(value => value === 4).length).toBe(2);
    await expect(page.getByLabel('Подразделение и подчинённые')).not.toContainText('Отдел 3');
  } finally { release(); }
  await expect(page.getByRole('link', { name: 'Сотрудник области 4', exact: true })).toBeVisible();
  await expect(page.getByLabel('Подразделение и подчинённые')).toContainText('Отдел 4');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Сотрудник');
  expect(businessWrites).toEqual([]);
});

test('a local editor closes on scope change and its old draft does not return with the former scope', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  await page.getByLabel('Фамилия', { exact: true }).fill('Черновик прежней области');
  await changeScope(page, state, 4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await changeScope(page, state, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  expect(businessWrites).toEqual([]); expect(state.writes).toEqual([]);
});

test('a division filter excluded by the new scope remains explicit until the user clears it', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page, '/service-employees/?search=Сотрудник&division_id=3');
  await expect(page.getByLabel('Подразделение и подчинённые')).toHaveValue('3');
  const before = state.permissionReads;
  state.scope = 4;
  await page.route('**/api/core/service-employees/**', route => {
    const url = new URL(route.request().url());
    if (state.scope === 4 && url.searchParams.get('division_id') === '3') return route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } });
    return route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
  await expect(page.getByText('Сотрудники не найдены', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Подразделение и подчинённые')).toHaveValue('3');
  await expect(page.getByLabel('Подразделение и подчинённые')).toContainText('Недоступное подразделение (№3)');
  await expect(page.getByText('Выбранное подразделение недоступно. Выберите другое или сбросьте фильтры.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('division_id')).toBe('3');
  await changeScope(page, state, 3);
  await expect(page.getByLabel('Подразделение и подчинённые')).toHaveValue('3');
  const warmBefore = state.permissionReads; state.scope = 4;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.permissionReads).toBeGreaterThan(warmBefore);
  await expect(page.getByText('Сотрудники не найдены', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Подразделение и подчинённые')).toHaveValue('3');
  await page.getByLabel('Подразделение и подчинённые').selectOption('');
  await page.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
  await expect(page.getByTestId('service-employee-row')).toContainText('Сотрудник области 4');
  expect(new URL(page.url()).searchParams.get('division_id')).toBeNull();
  expect(new URL(page.url()).searchParams.get('search')).toBe('Сотрудник');
  expect(businessWrites).toEqual([]);
});

test('a URL editor and its staffing data reload for the new scope without carrying the old draft', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page, '/service-employees/?search=Сотрудник&edit=1');
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  await page.getByLabel('Фамилия', { exact: true }).fill('Прежний черновик');
  await changeScope(page, state, 4);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 4');
  await expect(page.getByLabel('Подразделение', { exact: true })).toHaveValue('4');
  expect(state.staffingReads).toEqual([3, 4]);
  expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Сотрудник');
  expect(businessWrites).toEqual([]); expect(state.writes).toEqual([]);
});

test('revoking management closes a local editor while the server can still return an own employee with no aggregate grants', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  const before = state.directoryReads.length;
  state.grants = [];
  await changeScope(page, state, 4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить сотрудника', exact: true })).toHaveCount(0);
  expect(state.directoryReads.length).toBeGreaterThan(before);
  expect(businessWrites).toEqual([]); expect(state.writes).toEqual([]);
});

test('completion of a former scope save does not close or replace the current URL editor', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page, '/service-employees/?search=Сотрудник&edit=1');
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  state.holdSave = true;
  try {
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await changeScope(page, state, 4);
    await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 4');
    await page.getByLabel('Фамилия', { exact: true }).fill('Новый черновик');
  } finally { state.holdSave = false; state.releaseSave(); }
  await expect.poll(() => state.staffingReads.filter(scope => scope === 4).length).toBeGreaterThan(1);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Новый черновик');
  expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
  expect(businessWrites).toEqual([]); expect(state.writes).toHaveLength(1);
});

test('a late directory response for the former scope cannot replace the current rows', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page);
  let oldReads = 0;
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/core/service-employees/**', async route => {
    const url = new URL(route.request().url());
    if (state.scope !== 3 || url.searchParams.get('search') !== 'Отложенный') return route.fallback();
    oldReads++;
    await pending;
    return route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } });
  });
  let oldFinished: Promise<unknown> = Promise.resolve();
  await page.getByLabel('Поиск по ФИО, табельному номеру или позывному').fill('Отложенный');
  await page.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
  await expect.poll(() => oldReads).toBe(1);
  try {
    await changeScope(page, state, 4);
    // The new GET is already complete; this waiter observes the held old GET.
    oldFinished = page.waitForResponse(response => new URL(response.url()).searchParams.get('search') === 'Отложенный' && response.status() === 200).then(response => response.finished());
  } finally { release(); }
  await oldFinished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('service-employee-row')).toContainText('Сотрудник области 4');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Отложенный');
  expect(businessWrites).toEqual([]);
});

test('completion of a save after client navigation cannot restore the former directory URL', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page, '/service-employees/?search=Сотрудник&edit=1');
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Фамилия 3');
  state.holdSave = true;
  let finished: Promise<unknown> = Promise.resolve();
  try {
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__uxSameDocument = true; });
    await page.getByTestId('service-employee-row').locator('a').evaluate(anchor => (anchor as HTMLElement).click());
    await expect(page).toHaveURL(/\/security-ops\/profile\/1/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__uxSameDocument)).toBe(true);
    finished = page.waitForResponse(response => response.request().method() === 'PATCH').then(response => response.finished());
  } finally { state.holdSave = false; state.releaseSave(); }
  await finished;
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/security-ops\/profile\/1/);
  expect(businessWrites).toEqual([]); expect(state.writes).toHaveLength(1);
});

test('an open directory profile hides the former scope contacts and reads the new authority', async ({ page, businessWrites }) => {
  const state = await prepareEditor(page);
  await page.getByRole('link', { name: 'Сотрудник области 3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сотрудник области 3', exact: true })).toBeVisible();
  await expect(page.getByText('Служебный телефон: Телефон области 3', { exact: true })).toBeVisible();
  const before = state.permissionReads;
  let newReads = 0;
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/core/service-employees/1/**', async route => {
    if (state.scope === 4) { newReads++; await pending; }
    return route.fallback();
  });
  state.scope = 4;
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
    await expect.poll(() => newReads).toBe(1);
    await expect(page.getByRole('heading', { name: 'Сотрудник области 3', exact: true })).toHaveCount(0);
    await expect(page.getByText('Служебный телефон: Телефон области 3', { exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Сотрудник области 4', exact: true })).toBeVisible();
  await expect(page.getByText('Служебный телефон: Телефон области 3', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Служебный телефон: Телефон области 4', { exact: true })).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).searchParams.get('filters') ?? '').get('search')).toBe('Сотрудник');
  expect(businessWrites).toEqual([]);
});

for (const view of ['directory', 'profile'] as const) test(`failed permission refresh hides a cached own ${view} and allows access verification retry`, async ({ page, businessWrites }) => {
  const state = await prepareEditor(page);
  if (view === 'profile') {
    await page.getByRole('link', { name: 'Сотрудник области 3', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сотрудник области 3', exact: true })).toBeVisible();
  }
  const person = view === 'profile' ? page.getByRole('heading', { name: 'Сотрудник области 3', exact: true }) : page.getByTestId('service-employee-row');
  let fail = false;
  let reads = 0;
  await page.route('**/api/operations/my-permissions/**', route => {
    reads++;
    return route.fulfill({ status: fail ? 403 : 200, json: fail ? { detail: 'Проверка отказа прав' }
      : { permissions: [], global_permissions: [], roles: [] } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect.poll(() => state.directoryReads.length).toBeGreaterThan(2);
  await expect(person).toContainText('Сотрудник области 3');
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  const failure = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить доступ к кадровому разделу.' });
  await expect(failure).toBeVisible();
  await expect(person).toHaveCount(0);
  if (view === 'directory') await expect(page.getByLabel('Подразделение и подчинённые')).not.toContainText('Отдел 3');
  else await expect(page.getByText('Служебный телефон: Телефон области 3', { exact: true })).toHaveCount(0);
  fail = false;
  await failure.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(person).toContainText('Сотрудник области 3');
  await expect(failure).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});
