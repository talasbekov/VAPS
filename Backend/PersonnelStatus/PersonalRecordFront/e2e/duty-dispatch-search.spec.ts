import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3346';
const person = (index: number) => ({ employee_id: index, full_name: `Очередь ${String(index).padStart(3, '0')}`, position_name: 'Инспектор', department_name: 'Первый департамент', directorate_name: 'Первое управление', status_id: 500 + index, status_label: 'Суточное дежурство', date_start: '2026-10-10', date_end: '2026-10-13' });
const assignment = (index: number, cancelled = false) => ({
  id: (cancelled ? 3000 : 1000) + index, employee_id: 2000 + index,
  full_name: `${cancelled ? 'Архив' : 'Назначен'} ${String(index).padStart(3, '0')}`,
  department_name: cancelled ? 'Архивный департамент' : 'Второй департамент',
  directorate_name: cancelled ? 'Архивное управление' : 'Второе управление',
  source_status_id: 2500 + index,
  placement: { kind: 'POST', object_id: '12', object_name: index === 1 ? 'Объект Восток' : 'Объект Запад', post_id: '8', post_name: index === 1 ? 'Восточные ворота' : 'Западный пост', sector_name: 'Сектор' },
  start_at: '2026-10-10T03:00:00Z', end_at: '2026-10-10T15:00:00Z', created_at: '2026-10-09T03:00:00Z', created_by: 'Дежурный',
  valid: !cancelled, cancelled_at: cancelled ? '2026-10-10T04:00:00Z' : null, cancelled_reason: cancelled ? 'Учебная отмена' : '', invalid_reason: cancelled ? 'Назначение отменено.' : null,
});

async function setup(page: Page, { people = 63, assigned = 63, history = 27 } = {}) {
  const state = { people: Array.from({ length: people }, (_, i) => person(i + 1)), assignments: [...Array.from({ length: assigned }, (_, i) => assignment(i + 1)), ...Array.from({ length: history }, (_, i) => assignment(i + 1, true))], writes: 0, fail: false, requests: 0 };
  await page.route('**/api/**', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/')) { state.writes++; return route.abort(); }
    return route.fallback();
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['duty.dispatch', 'object.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/duty-dispatch/**', route => {
    expect(route.request().method()).toBe('GET');state.requests++;
    return state.fail ? route.fulfill({ status: 503, json: { detail: 'Temporary failure' } }) : route.fulfill({ json: { business_date: new URL(route.request().url()).searchParams.get('business_date') ?? '2026-10-10', receiver: { id: 18, name: 'Второй департамент' }, can_assign: true, can_cancel: true, can_configure: false, people: state.people, assignments: state.assignments } });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/security-ops/duty-dispatch/?date=2026-10-10`);
  await expect(page.getByRole('heading', { name: 'Почасовые смены', exact: true })).toBeVisible();
  return state;
}

test.describe('duty lists: finding allocated people', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend; every business write is blocked');

  test('shared search stays visible and selected in waiting, assigned and history', async ({ page }) => {
    const state = await setup(page);
    const search = page.getByLabel('Поиск сотрудника', { exact: true });
    await search.fill('001');
    await expect(page.getByRole('article')).toHaveCount(1);
    for (const [tab, name] of [['Расставлены', 'Назначен 001'], ['История', 'Архив 001'], ['Ожидают расстановки', 'Очередь 001']]) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await expect(search).toBeVisible();await expect(search).toHaveValue('001');
      await expect(page.getByRole('article')).toHaveCount(1);
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    expect(state.writes).toBe(0);
  });

  test('assigned and historical people can be found by their placement and department', async ({ page }) => {
    await setup(page);
    await page.getByRole('tab', { name: /^Расставлены/ }).click();
    await page.getByLabel('Поиск сотрудника', { exact: true }).fill('восточные ворота');
    await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('Назначен 001');
    await page.getByRole('tab', { name: /^История/ }).click();
    await page.getByLabel('Департамент отправителя').selectOption({ label: 'Архивный департамент' });
    await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('Архив 001');
    await page.getByLabel('Поиск сотрудника', { exact: true }).fill('Архивное управление');
    await expect(page.getByRole('article')).toHaveCount(25);
    await expect(page.getByText('Показано 1–25 из 27', { exact: true })).toBeVisible();
  });

  test('long lists render bounded pages and reset when switching the tab or day', async ({ page }) => {
    const state = await setup(page);
    await expect(page.getByRole('article')).toHaveCount(25);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('Показано 26–50 из 63', { exact: true })).toBeVisible();
    await expect(page.getByRole('article').first()).toContainText('Очередь 026');
    await expect(page.getByRole('article').first()).toBeInViewport();
    await page.getByRole('tab', { name: /^Расставлены/ }).click();
    await expect(page.getByText('Показано 1–25 из 63', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await page.getByLabel('Дата дежурства', { exact: true }).fill('2026-10-11');
    await expect(page).toHaveURL(/date=2026-10-11/);
    await expect(page.getByText('Показано 1–25 из 63', { exact: true })).toBeVisible();
    expect(state.writes).toBe(0);
  });

  test('filtering on the last page resets the range and clearing restores the full list', async ({ page }) => {
    await setup(page);await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('Показано 51–63 из 63', { exact: true })).toBeVisible();
    await page.getByLabel('Поиск сотрудника', { exact: true }).fill('несуществующий сотрудник');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('По этим условиям сотрудников нет.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(page.getByText('Показано 1–25 из 63', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Ожидают расстановки/ })).toContainText('63');
  });

  test('a shorter refreshed list cannot strand the selected page on an empty result', async ({ page }) => {
    const state = await setup(page);await page.getByRole('tab', { name: /^История/ }).click();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('Показано 26–27 из 27', { exact: true })).toBeVisible();
    state.assignments = state.assignments.filter(row => !row.cancelled_at || row.id === 3001);
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByText('Показано 1–1 из 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('Архив 001');
  });

  test('failed reload hides stale placements and recovers to the active filters', async ({ page }) => {
    const state = await setup(page);await page.getByRole('tab', { name: /^Расставлены/ }).click();
    await page.getByLabel('Поиск сотрудника', { exact: true }).fill('001');await expect(page.getByRole('article')).toHaveCount(1);
    state.fail = true;await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByRole('button', { name: 'Снять назначение', exact: true })).toHaveCount(0);
    state.fail = false;await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByLabel('Поиск сотрудника', { exact: true })).toHaveValue('001');await expect(page.getByRole('article')).toHaveCount(1);
    expect(state.writes).toBe(0);
  });

  test('filters and paging remain reachable on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });await setup(page);await page.getByRole('tab', { name: /^Расставлены/ }).click();
    const search = page.getByLabel('Поиск сотрудника', { exact: true });await expect(search).toBeVisible();
    const box = await search.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('Показано 26–50 из 63', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
