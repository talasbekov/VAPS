import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3354';
const assignment = {
  dispatch_assignment_id: 901, status_id: null, employee_id: 73, employee_name: 'Отправленный Сотрудник',
  rank_name: '', position_name: 'Инспектор', department_name: 'Управление',
  placement: { kind: 'POST', object_id: 'obj-1', object_name: 'Объект Альфа', post_id: 'post-1', post_name: 'Пост Восток', sector_name: 'Сектор А', group_id: null, group_name: null },
  start_date: '2026-10-11', end_date: '2026-10-11', assigned_at: '2026-10-10T12:00:00Z',
  start_at: '2026-10-11T03:00:00Z', end_at: '2026-10-11T07:00:00Z', time_zone: 'Asia/Almaty',
};

async function setup(page: Page, permissions = ['status.view', 'status.workspace']) {
  const state = { permissions, fail: false, empty: false, reads: [] as URL[], writes: [] as string[] };
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
  } });
  expect((await login.json()).url).not.toContain('error=');
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/auth/')) return route.fallback();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      state.writes.push(url.pathname);
      return route.abort();
    }
    let json: unknown;
    if (url.pathname === '/api/operations/my-permissions/') {
      json = { permissions: state.permissions, global_permissions: [], roles: [{ code: 'directorate_head', name: 'Начальник управления', scope_division_id: 3, scope_division_name: 'Управление' }], status_manage_division_ids: [] };
    } else if (url.pathname === '/api/staff_unit/staff-units/directorate/') {
      const row = { id: 812, division: { id: 3, name: 'Управление' }, directorate_id: 3, directorate_name: 'Управление', position: { id: 1, name: 'Инспектор' }, employee: { id: 73, first_name: 'Сотрудник', last_name: 'Отправленный', current_status: { status_type: 'in_service', start_date: '2026-10-11', end_date: null } } };
      json = { staff_units: [row, { ...row, id: 813, employee: null }], total_count: 2, matched_count: 2, page: 1, page_size: 50, has_next: false };
    } else if (url.pathname === '/api/staff_unit/statistics/') {
      json = { summary: {}, departments: [], directorates: [], divisions: [] };
    } else if (url.pathname === '/api/statuses/types/') {
      json = [{ code: 'in_service', label: 'В строю', color: '' }];
    } else if (url.pathname === '/api/operations/tomorrow-block/') {
      json = { business_date: '2026-10-11', blocked: false, laggards: [] };
    } else if (url.pathname === '/api/statuses/statuses/duty-assignments/') {
      state.reads.push(url);
      if (state.fail) return route.fulfill({ status: 500, json: { detail: 'Unavailable fixture' } });
      json = { results: state.empty ? [] : [assignment, { ...assignment, dispatch_assignment_id: 902,
        placement: { ...assignment.placement, kind: 'GROUP', object_name: 'Объект Бета', post_id: null, post_name: null, group_id: 'group-2', group_name: 'Группа Браво' },
        start_at: '2026-10-11T08:00:00Z', end_at: '2026-10-11T12:00:00Z' }] };
    } else if (url.pathname === '/api/operations/statuses/') {
      json = { count: 0, results: [], next: null, previous: null };
    } else return route.fallback();
    return route.fulfill({ json });
  });
  await page.goto(`${APP}/statuses/`);
  if (permissions.includes('status.view')) await expect(page.locator('[data-employee-id="73"]')).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  return state;
}

async function openPlacement(page: Page) {
  await page.getByRole('button', { name: 'Действия: Отправленный Сотрудник', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Назначения в наряд', exact: true }).click();
  return page.getByRole('dialog', { name: 'Назначения в наряд', exact: true });
}

test.describe('sender duty placement read-only view', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'requires authenticated frontend; API responses are isolated fixtures');

  test('head without object access lazily sees all shifts by personnel ID and can inspect a future date', async ({ page }) => {
    const state = await setup(page);
    expect(state.reads).toEqual([]);
    const dialog = await openPlacement(page);
    await expect(dialog.getByText('Объект Альфа', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Пост Восток', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Объект Бета', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Группа Браво', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('08:00');
    await expect(dialog).toContainText('17:00');
    expect(state.reads[0].searchParams.get('employee_id')).toBe('73');
    expect(state.reads[0].searchParams.has('object_id')).toBe(false);
    state.empty = true;
    await dialog.getByLabel('Дата наряда', { exact: true }).fill('2026-10-12');
    await expect(dialog.getByText('На выбранную дату активных назначений нет.', { exact: true })).toBeVisible();
    expect(state.reads.at(-1)?.searchParams.get('date')).toBe('2026-10-12');
    await expect(dialog).not.toContainText('Ожидает распределения');
    expect(state.writes).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Действия: ВАКАНТ', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Назначения в наряд', exact: true })).toHaveCount(0);
  });

  test('failed reads show retry rather than empty or cached placement', async ({ page }) => {
    const state = await setup(page);
    state.fail = true;
    const dialog = await openPlacement(page);
    await expect(dialog.getByRole('alert')).toContainText('Не удалось загрузить');
    await expect(dialog.getByText('На выбранную дату активных назначений нет.', { exact: true })).toHaveCount(0);
    state.fail = false;
    await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(dialog.getByText('Объект Альфа', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    state.fail = true;
    await openPlacement(page);
    await expect(dialog.getByRole('alert')).toContainText('Не удалось загрузить');
    await expect(dialog.getByText('Объект Альфа', { exact: true })).toHaveCount(0);
  });

  test('revoking status permission hides already loaded placements and the row action', async ({ page }) => {
    const state = await setup(page);
    const dialog = await openPlacement(page);
    await expect(dialog.getByText('Объект Альфа', { exact: true })).toBeVisible();
    state.permissions = ['object.view'];
    const refresh = page.waitForResponse(response => response.url().includes('/api/operations/my-permissions/'));
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await refresh;
    await expect(page.getByText('Объект Альфа', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Действия: Отправленный Сотрудник', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Назначения в наряд', exact: true })).toHaveCount(0);
  });

  test('object reader without status access has no placement action or prefetch', async ({ page }) => {
    const state = await setup(page, ['object.view']);
    await expect(page.getByRole('menuitem', { name: 'Назначения в наряд', exact: true })).toHaveCount(0);
    expect(state.reads).toEqual([]);
  });

  test('sender placement read access does not open the dispatcher queue', async ({ page }) => {
    await setup(page);
    const queueReads: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/ops/duty-dispatch/')) queueReads.push(request.url());
    });
    await page.goto(`${APP}/security-ops/duty-dispatch/`);
    await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
    expect(queueReads).toEqual([]);
  });
});
