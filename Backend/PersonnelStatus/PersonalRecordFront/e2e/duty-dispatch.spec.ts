import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3346';
const person = { employee_id: 101, full_name: 'Сотрудник другого департамента', position_name: 'Инспектор', department_name: 'Первый департамент', directorate_name: 'Первое управление', status_id: 501, status_label: 'Суточное дежурство', date_start: '2026-10-10', date_end: '2026-10-13' };
const object = { id: '12', name: 'Объект проверки', code: 'TEST', objectState: 'ACTIVE', sectors: [{ id: '4', name: 'Сектор', posts: [{ id: '8', name: 'Главный пост' }] }] };
const placement = { kind: 'POST', object_id: '12', object_name: object.name, post_id: '8', post_name: 'Главный пост', sector_name: 'Сектор' };
const assignment = { id: 1, employee_id: 101, full_name: person.full_name, source_status_id: 501, placement, start_at: '2026-10-10T03:00:00Z', end_at: '2026-10-10T15:00:00Z', valid: true, cancelled_at: null as string | null, invalid_reason: '' };

async function setup(page: Page, options: { permitted?: boolean; canAssign?: boolean; canCancel?: boolean; retained?: boolean; failSave?: boolean } = {}) {
  const state = { assignments: (options.retained ? [{ ...assignment, valid: false, invalid_reason: 'Принимающий департамент недоступен' }] : []) as typeof assignment[], posts: [] as Record<string, unknown>[], fail: options.failSave ?? false, canAssign: options.canAssign ?? true };
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: options.permitted === false ? ['duty.view'] : ['duty.dispatch', 'object.view', 'status.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/objects/**', route => route.fulfill({ json: { results: [object] } }));
  await page.route('**/api/ops/duty-dispatch/**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { business_date: '2026-10-10', receiver: { id: 18, name: 'Второй департамент' }, can_configure: false, can_assign: state.canAssign, can_cancel: options.canCancel ?? state.canAssign, access_reason: state.canAssign ? '' : 'Расстановка доступна дежурному принимающего департамента.', people: state.canAssign ? [person] : [], assignments: state.assignments } });
    state.posts.push(route.request().postDataJSON());
    if (state.fail) return route.fulfill({ status: 409, json: { error_code: 'ALLOCATION_CHANGED', message: 'Выделение сотрудника изменилось. Обновите список.', details: {}, request_id: null, timestamp: '' } });
    if (route.request().url().includes('/cancel/')) state.assignments = [{ ...assignment, valid: false, cancelled_at: '2026-10-10T04:00:00Z' } as typeof assignment];
    else state.assignments = [{ ...assignment }];
    return route.fulfill({ status: 200, json: state.assignments[0] });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/security-ops/duty-dispatch/?date=2026-10-10`);
  return state;
}
async function fillAssignment(page: Page) {
  await page.getByRole('button', { name: 'Назначить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить дежурство', exact: true });
  await dialog.getByRole('combobox', { name: /^Тип дежурства/ }).click();
  await page.getByRole('option', { name: 'Постовое', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Объект/ }).click();
  await page.getByRole('option', { name: `${object.name} (TEST)`, exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Пост/ }).click();
  await page.getByRole('option', { name: 'Главный пост (Сектор)', exact: true }).click();
  await dialog.getByLabel('Начало смены').fill('08:00');
  await dialog.getByLabel('Конец смены').fill('20:00');
  return dialog;
}
test.describe('duty dispatcher workspace', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend; all business writes intercepted');
  test('incoming allocation can be placed, reloaded and cancelled with retained history', async ({ page }) => {
    const state = await setup(page);
    await expect(page.getByRole('heading', { name: 'Почасовые смены', exact: true })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: person.full_name })).toContainText(person.department_name);
    const dialog = await fillAssignment(page);
    await dialog.getByRole('button', { name: 'Сохранить назначение', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.posts[0]).toMatchObject({ employee_id: 101, status_id: 501, business_date: '2026-10-10', start_time: '08:00', end_time: '20:00', placement: { kind: 'POST', object_id: '12', post_id: '8' } });
    await page.reload();
    await page.getByRole('tab', { name: /^Расставлены/ }).click();
    await expect(page.getByText('Главный пост', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть объект', exact: true })).toHaveAttribute('href', '/security-ops/objects/12/?dutyDate=2026-10-10');
    await page.getByRole('button', { name: 'Добавить смену', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Назначить дежурство', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Снять назначение', exact: true }).click();
    const cancel = page.getByRole('dialog', { name: 'Снять назначение', exact: true });
    await cancel.getByLabel('Причина').fill('Замена смены');
    await cancel.getByRole('button', { name: 'Подтвердить снятие' }).click();
    await expect(cancel).toHaveCount(0);
    await page.getByRole('tab', { name: /^История/ }).click();
    await expect(page.getByRole('tabpanel').getByText('Назначение снято', { exact: true })).toBeVisible();
  });
  test('failed save preserves placement and times without displaying success', async ({ page }) => {
    await setup(page, { failSave: true });
    const dialog = await fillAssignment(page);
    await dialog.getByLabel('Начало смены').fill('09:30');
    await dialog.getByRole('button', { name: 'Сохранить назначение', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Выделение сотрудника изменилось' })).toBeVisible();
    await expect(dialog.getByLabel('Начало смены')).toHaveValue('09:30');
    await expect(dialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Главный пост');
    await expect(page.getByText('Назначение сохранено', { exact: true })).toHaveCount(0);
  });
  test('receiving scope denial never offers another departments people or placement', async ({ page }) => {
    await setup(page, { canAssign: false });
    await expect(page.getByText('Расстановка доступна дежурному принимающего департамента.', { exact: true })).toBeVisible();
    await expect(page.getByText(person.full_name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toHaveCount(0);
  });
  test('pending save cannot be dismissed or submitted twice', async ({ page }) => {
    await setup(page);
    const dialog = await fillAssignment(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let writes = 0;
    await page.route('**/api/ops/duty-dispatch/', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      writes++; await gate;
      return route.fulfill({ status: 503, json: { detail: 'Temporary failure' } });
    });
    try {
      await dialog.getByRole('button', { name: 'Сохранить назначение', exact: true }).click();
      await expect.poll(() => writes).toBe(1);
      await expect(dialog.getByRole('button', { name: 'Сохранение…', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
      await expect(dialog.getByLabel('Начало смены')).toBeDisabled();
      expect(writes).toBe(1);
    } finally { release(); }
    await expect(dialog.getByRole('alert').filter({ hasText: 'Сервис временно недоступен' })).toBeVisible();
  });
  test('source or receiving authority revoked after failed save disables retry', async ({ page }) => {
    const state = await setup(page, { failSave: true });
    const dialog = await fillAssignment(page);
    state.canAssign = false;
    await dialog.getByRole('button', { name: 'Сохранить назначение', exact: true }).click();
    await expect(dialog.getByText('Состав или права изменились. Назначение сейчас недоступно.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Сохранить назначение', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Начало смены')).toHaveValue('08:00');
    expect(state.posts).toHaveLength(1);
  });
  test('inactive receiver retains cancellation without allowing new assignments', async ({ page }) => {
    await setup(page, { canAssign: false, canCancel: true, retained: true });
    await expect(page.getByRole('tab', { name: /^Расставлены/ })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('article').getByRole('alert')).toContainText('Принимающий департамент недоступен');
    await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Снять назначение', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Снять назначение', exact: true });
    await dialog.getByLabel('Причина').fill('Департамент закрыт');
    await dialog.getByRole('button', { name: 'Подтвердить снятие', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('tab', { name: /^История/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Назначение снято');
  });
});
