import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

async function prepare(page: Page, settings: { fail?: number; hold?: boolean; id?: number; holdOptions?: boolean } = {}) {
  const state = { fail: settings.fail ?? 0, listFail: 0, hold: settings.hold ?? false, id: settings.id ?? 1, holdOptions: settings.holdOptions ?? false, allowMockSave: false, holdSave: false, saveWrites: [] as object[], detailReads: 0, listReads: 0, editorReads: [] as string[], staffingReads: [] as number[], release: () => {}, releaseOptions: () => {}, releaseSave: () => {} };
  const pending = new Promise<void>(resolve => { state.release = resolve; });
  const pendingOptions = new Promise<void>(resolve => { state.releaseOptions = resolve; });
  const pendingSave = new Promise<void>(resolve => { state.releaseSave = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['orgstructure.manage', 'admin.roles', 'personnel.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/core/service-employees/**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/options/')) {
      if (state.holdOptions) await pendingOptions;
      return route.fulfill({ json: { divisions: [{ id: 3, name: 'Отдел формы', level: 0 }], statuses: [] } });
    }
    const tail = path.slice('/api/core/service-employees/'.length);
    if (tail !== '') state.editorReads.push(tail.replace(/\/$/, ''));
    else {
      state.listReads++;
      if (state.listFail) return route.fulfill({ status: state.listFail, json: { detail: 'Проверка отказа чтения списка' } });
    }
    if (path.endsWith('/1/')) {
      state.detailReads++;
      if (state.hold) await pending;
      if (state.fail) return route.fulfill({ status: state.fail, json: { detail: 'Проверка отказа чтения формы' } });
      return route.fulfill({ json: { id: state.id, full_name: 'Сотрудник формы', callsign: '', division: { id: 3, name: 'Отдел формы' } } });
    }
    return route.fulfill({ json: { count: 0, results: [], next: null, previous: null } });
  });
  for (const kind of ['ranks', 'positions']) await page.route(`**/api/dictionaries/${kind}/**`, route => route.fulfill({ json: { results: [{ id: 7, name: 'Значение формы', is_active: true }] } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', async route => {
    if (state.allowMockSave && route.request().method() === 'PATCH') {
      state.saveWrites.push(route.request().postDataJSON());
      if (state.holdSave) await pendingSave;
      return route.fulfill({ json: { staff_units: [] } });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    state.staffingReads.push(Number(new URL(route.request().url()).searchParams.get('employee_ids')));
    return route.fulfill({ json: { staff_units: [{ id: 1, employee: { id: state.id, first_name: 'Формы', last_name: 'Сотрудник' }, division: { id: 3, name: 'Отдел формы' }, position: { id: 7, name: 'Значение формы' },
      management: { staff_unit_id: 1, middle_name: '', callsign: '', rank_id: 7, user: null, is_active: true } }] } });
  });
  await signIn(page);
  return state;
}

const url = '/service-employees/?search=Сотрудник&page=2&edit=1';
const failure = (page: Page) => page.getByRole('alert').filter({ hasText: /кадровую форму сотрудника/ });

test('a held URL employee read shows explicit editor loading without another person or a business write', async ({ page, businessWrites }) => {
  const state = await prepare(page, { hold: true });
  try {
    await page.goto(url);
    await expect.poll(() => state.detailReads).toBe(1);
    await expect(page.getByText('Загрузка кадровой формы…', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { state.release(); }
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  expect(businessWrites).toEqual([]);
});

test('a held options read keeps the linked editor loading after the employee itself has loaded', async ({ page, businessWrites }) => {
  const state = await prepare(page, { holdOptions: true });
  const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/core/service-employees/1/');
  try {
    await page.goto(url);
    await (await read).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Загрузка кадровой формы…', { exact: true })).toBeVisible();
  } finally { state.holdOptions = false; state.releaseOptions(); }
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  expect(businessWrites).toEqual([]);
});

for (const deniedRead of ['editor', 'directory'] as const) test(`a late save from a denied ${deniedRead} cannot close a reopened draft for the same linked employee`, async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(url);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  state.allowMockSave = true; state.holdSave = true;
  try {
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => state.saveWrites.length).toBe(1);
    const before = deniedRead === 'editor' ? state.detailReads : state.listReads;
    if (deniedRead === 'editor') state.fail = 403;
    else state.listFail = 403;
    await page.clock.fastForward(61000);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => deniedRead === 'editor' ? state.detailReads : state.listReads).toBeGreaterThan(before);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (deniedRead === 'editor') {
      state.fail = 0;
      await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click();
    } else {
      state.listFail = 0;
      const deniedBefore = state.listReads;
      await page.clock.fastForward(61000);
      await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
      await expect.poll(() => state.listReads).toBeGreaterThan(deniedBefore);
    }
    await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
    await page.getByLabel('Фамилия', { exact: true }).fill('Новый черновик после проверки доступа');
    const staffingBeforeSave = state.staffingReads.length;
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/staff_unit/staff-units/directorate/');
    state.holdSave = false; state.releaseSave();
    await (await saved).finished();
    await expect.poll(() => state.staffingReads.length).toBeGreaterThan(staffingBeforeSave);
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Новый черновик после проверки доступа');
    expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
    expect(state.saveWrites).toHaveLength(1);
    expect(businessWrites).toEqual([]);
  } finally { state.holdSave = false; state.releaseSave(); }
});

test('an initial editor read failure can be retried without changing the linked employee or filters', async ({ page, businessWrites }) => {
  const state = await prepare(page, { fail: 503 });
  await page.goto(url);
  await expect(failure(page)).toBeVisible();
  state.fail = 0;
  await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(new URL(page.url()).searchParams.get('search')).toBe('Сотрудник');
  expect(businessWrites).toEqual([]);
});

for (const status of [403, 404]) test(`a confirmed cached editor HTTP ${status} removes the former editable fields`, async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(url);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  const before = state.detailReads;
  state.fail = status;
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.detailReads).toBeGreaterThan(before);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(failure(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
  expect(businessWrites).toEqual([]);
});

test('a temporary editor refresh failure keeps the draft and exposes its retry inside the dialog', async ({ page, businessWrites }) => {
  await page.clock.install();
  const state = await prepare(page);
  await page.goto(url);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  await page.getByLabel('Фамилия', { exact: true }).fill('Сохранённый черновик');
  const before = state.detailReads; state.fail = 503;
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.detailReads).toBeGreaterThan(before);
  await expect(failure(page)).toBeVisible();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сохранённый черновик');
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  state.fail = 0; state.hold = true;
  try {
    await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(failure(page).getByRole('button', { name: 'Повторяем…', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сохранённый черновик');
  } finally { state.hold = false; state.release(); }
  await expect(failure(page)).toHaveCount(0);
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сохранённый черновик');
  expect(new URL(page.url()).searchParams.get('edit')).toBe('1');
  expect(businessWrites).toEqual([]);
});

for (const id of ['', 'bad', '9007199254740992']) test(`invalid editor ID ${id || '(empty)'} does not request a person and offers a return to the filtered list`, async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto('/service-employees/?search=Сотрудник&page=2&edit=' + encodeURIComponent(id));
  await expect.poll(() => state.listReads).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  expect(state.editorReads).toEqual([]); expect(state.staffingReads).toEqual([]);
  await expect(page.getByText('Некорректная ссылка на кадровую форму. Вернитесь к списку и выберите сотрудника.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть кадровую форму', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('edit')).toBe(false);
  expect(new URL(page.url()).searchParams.get('search')).toBe('Сотрудник');
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(businessWrites).toEqual([]);
});

test('a mismatched employee response cannot open staffing for another person and can be retried', async ({ page, businessWrites }) => {
  const state = await prepare(page, { id: 2 });
  const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/core/service-employees/1/');
  await page.goto(url);
  await (await read).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(failure(page)).toContainText('Ответ сервера не соответствует выбранному сотруднику. Повторите загрузку.');
  expect(state.staffingReads).toEqual([]);
  state.id = 1;
  await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  expect(state.staffingReads).toEqual([1]); expect(businessWrites).toEqual([]);
});

test('a local new editor cannot substitute for a different employee requested by a pending URL', async ({ page, businessWrites }) => {
  const state = await prepare(page, { hold: true });
  await page.goto('/service-employees/?search=Сотрудник&page=2');
  await page.getByRole('button', { name: 'Добавить сотрудника', exact: true }).click();
  await expect(page.getByLabel('Фамилия', { exact: true })).toBeVisible();
  await page.getByLabel('Фамилия', { exact: true }).fill('Черновик новой карточки');
  try {
    await page.evaluate(next => history.pushState(null, '', next), url);
    await expect.poll(() => state.detailReads).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Загрузка кадровой формы…', { exact: true })).toBeVisible();
  } finally { state.release(); }
  await expect(page.getByRole('heading', { name: 'Изменить сотрудника', exact: true })).toBeVisible();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue('Сотрудник');
  expect(businessWrites).toEqual([]);
});
