import { test, expect, signIn } from './ux-fixture';
import type { Page, Route } from '@playwright/test';
import type { Division, StaffUnitStatistics } from '../lib/api';

const counts = { staff_units_count: 12, employees_count: 9, vacancies_count: 3 };
const branch = (id: number, name: string, type: string, parent: number | null, children: Division[] = []): Division => ({
  id, name, division_type: type, parent, children, code: `TEST-${id}`, is_active: true, order: 0,
});
const organizationTree = () => branch(0, 'Доступные подразделения', 'organization', null, [
  branch(1, 'Служба', 'organization', null, [branch(10, 'Департамент', 'department', 1)]),
  branch(2, 'Госпиталь', 'organization', null, [branch(21, '1 управление', 'directorate', 2, [
    branch(22, '2 отдел', 'division', 21),
  ])]),
  branch(3, 'Воинская часть', 'organization', null, [branch(31, 'Подразделение части', 'division', 3)]),
  branch(999, 'Неиспользуемая ветвь', 'organization', null),
]);
const statistics = (): StaffUnitStatistics => ({
  scope_division: null,
  summary: { departments_count: 1, directorates_count: 1, divisions_count: 2, ...counts },
  departments: [{ department_id: 10, department_name: 'Департамент', ancestors: [], directorates_count: 0, divisions_count: 0, ...counts }],
  directorates: [{ directorate_id: 21, directorate_name: '1 управление', ancestors: [], divisions_count: 1, ...counts }],
  divisions: [
    { division_id: 22, division_name: '2 отдел', ancestors: ['1 управление'], ...counts },
    { division_id: 31, division_name: 'Подразделение части', ancestors: [], ...counts },
  ],
});

function readJson(route: Route, json: unknown) {
  if (route.request().method() !== 'GET') return route.fallback();
  return route.fulfill({ json });
}

async function mockStructure(page: Page, stats = statistics(), tree = organizationTree()) {
  await page.route('**/api/operations/my-permissions/**', route => readJson(route, {
    permissions: ['orgstructure.view'], global_permissions: ['orgstructure.view'], roles: [],
  }));
  await page.route(url => url.pathname === '/api/staff_unit/statistics/', route => readJson(route, stats));
  await page.route(url => url.pathname === '/api/staff_unit/staff-units/', route => readJson(route, {
    count: 0, next: null, previous: null, results: [],
  }));
  await page.route(url => url.pathname === '/api/divisions/divisions_tree/', route => readJson(route, tree));
  await page.route(url => url.pathname === '/api/statuses/statuses/absence_statistics/', route => readJson(route, {
    period: { start_date: '2026-10-15', end_date: '2026-10-15' }, division_id: 1,
    staff_count: 9, total_absences: 0, by_type: {},
  }));
}

test('overview retains separate organizations, hospital ancestry and unknown organization totals', async ({ page, businessWrites }, testInfo) => {
  const errors: string[] = [], peopleReads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/core/service-employees/')) peopleReads.push(request.url()); });
  await mockStructure(page);
  await signIn(page);
  await page.goto('/dashboard/');
  const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
  const list = scene.getByRole('group', { name: 'Выбор подразделения' });
  await expect(list.getByRole('button').filter({ has: page.getByText('Госпиталь', { exact: true }) })).toBeVisible();
  const canvas = scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' });
  await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
  const positions = JSON.parse((await canvas.getAttribute('data-positions'))!) as Array<{ id: number; parentId: number | null; position: number[] }>;
  expect(positions.filter(node => node.parentId === null).map(node => node.id).sort()).toEqual([1, 2, 3]);
  expect(positions.find(node => node.id === 21)?.parentId).toBe(2);
  expect(positions.find(node => node.id === 10)?.parentId).toBe(1);
  expect(positions.find(node => node.id === 31)?.parentId).toBe(3);
  await expect(list).not.toContainText('Неиспользуемая ветвь');
  await list.getByRole('button').filter({ has: page.getByText('2 отдел', { exact: true }) }).click();
  await expect(scene.getByText('Госпиталь › 1 управление', { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-edges', /21:22/);
  await expect(canvas).toHaveAttribute('data-edges', /2:21/);
  await scene.getByPlaceholder('Найти название или ID…').fill('Госпиталь');
  await expect(list.getByRole('button')).toHaveCount(3);
  await list.getByRole('button').filter({ has: page.getByText('Госпиталь', { exact: true }) }).click();
  await expect(scene.getByText('Организация · #2', { exact: true })).toHaveCount(2);
  await expect(scene.locator('dd')).toHaveText(['нет данных', 'нет данных', 'нет данных']);
  expect(peopleReads).toEqual([]);
  expect(errors).toEqual([]);
  expect(businessWrites).toEqual([]);
  await scene.screenshot({ path: testInfo.outputPath('overview-organizations.png') });
});

test('hospital section remains searchable and selected on a narrow overview', async ({ page, businessWrites }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStructure(page);
  await signIn(page);
  await page.goto('/dashboard/');
  const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
  await scene.getByPlaceholder('Найти название или ID…').fill('Госпиталь');
  const list = scene.getByRole('group', { name: 'Выбор подразделения' });
  await expect(list.getByRole('button')).toHaveCount(3);
  await list.getByRole('button').filter({ has: page.getByText('2 отдел', { exact: true }) }).click();
  await expect(scene.getByRole('heading', { name: '2 отдел', exact: true })).toBeVisible();
  await expect(scene.getByText('Госпиталь › 1 управление', { exact: true })).toBeVisible();
  const canvas = scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' });
  await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
  const caption = scene.getByText('Выберите подразделение, чтобы приблизить его ветвь', { exact: true });
  if (await caption.isVisible()) {
    const box = (await canvas.boundingBox())!;
    const plaques = JSON.parse((await canvas.getAttribute('data-bounds'))!) as Array<{ id: number; top: number }>;
    const rootTop = Math.min(...plaques.filter(node => [1, 2, 3].includes(node.id)).map(node => box.y + (1 - node.top) * box.height / 2));
    const captionBox = (await caption.boundingBox())!;
    expect(captionBox.y + captionBox.height, 'Mobile caption must not cover the organization plaques').toBeLessThanOrEqual(rootTop);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  expect(businessWrites).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('overview-hospital-mobile.png'), fullPage: true });
});

test('a scoped overview does not recreate hidden organization ancestors from stale statistics names', async ({ page, businessWrites }) => {
  const stats = statistics();
  stats.departments = [];
  stats.directorates = [];
  stats.divisions = [{ division_id: 22, division_name: '2 отдел', ancestors: ['Скрытый госпиталь', 'Скрытое управление'], ...counts }];
  await mockStructure(page, stats, branch(22, '2 отдел', 'division', null));
  await signIn(page);
  await page.goto('/dashboard/');
  const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
  const list = scene.getByRole('group', { name: 'Выбор подразделения' });
  await expect(list.getByRole('button')).toHaveCount(1);
  await list.getByRole('button').click();
  await expect(scene.getByRole('heading', { name: '2 отдел', exact: true })).toBeVisible();
  await expect(scene).not.toContainText('Скрытый госпиталь');
  await scene.getByPlaceholder('Найти название или ID…').fill('Скрытый госпиталь');
  await expect(list.getByRole('button')).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});
