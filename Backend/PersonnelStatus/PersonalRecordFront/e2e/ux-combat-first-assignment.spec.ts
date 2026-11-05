import { test, expect, signIn } from './ux-fixture';

for (const failRefresh of [false, true]) test(`first combat setup stays in assignment and survives a choices outage (${failRefresh})`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: failRefresh ? 1440 : 390, height: 1000 });
  const groups: Record<string, unknown>[] = [], types: Record<string, unknown>[] = [], writes: Record<string, unknown>[] = [];
  let outage = false;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['duty.roster', 'duty.catalog.manage'], global_permissions: ['duty.roster', 'duty.catalog.manage'], roles: [],
  } }));
  await page.route('**/api/ops/combat-duty-board/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/choices/')) return outage ? route.fulfill({ status: 503, json: { message: 'Недоступно' } }) : route.fulfill({ json: {
      groups, types, routes: [], places: [], events: [], objectChoices: [], divisions: [{ id: '2', name: 'Подразделение', parentId: null }],
      permissions: { roster: true, manageCatalogs: true, review: false, rosterDivisionIds: ['2'], manageCatalogsDivisionIds: ['2'], reviewDivisionIds: [] },
    } });
    if (path.endsWith('/week/')) return route.fulfill({ json: { results: [] } });
    return route.fulfill({ json: { businessDate: '2026-11-05', shifts: [], summary: { totalGroups: groups.length, formedGroups: 0, people: 0, vehicles: 0, awaitingReview: 0, activeGroups: 0, reserveGroups: 0 } } });
  });
  await page.route('**/api/ops/combat-roster-candidates/**', route => route.fulfill({ json: { results: [
    { employeeId: '1', employeeName: 'Сотрудник группы', divisionId: '2', unitName: 'Подразделение', inService: true },
  ] } }));
  await page.route('**/api/ops/combat-catalogs/', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON(); writes.push(body);
    const row = { ...body, id: body.kind === 'groups' ? '8' : '9', isActive: true };
    (body.kind === 'groups' ? groups : types).push(row);
    if (failRefresh && body.kind === 'groups') outage = true;
    return route.fulfill({ status: 201, json: row });
  });
  await signIn(page);
  await page.goto('/security-ops/duty-register/?section=combat&date=2026-11-05&combat_division=2');
  await page.getByRole('button', { name: 'Назначить людей', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Далее: люди', exact: true })).toHaveCount(0);
  await page.getByLabel('Название первой группы', { exact: true }).fill('Патруль');
  await page.getByRole('button', { name: 'Создать группу', exact: true }).click();
  if (failRefresh) {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const alert = page.getByRole('region', { name: 'Расчёт боевого дежурства на день', exact: true }).getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить расчёт');
    outage = false;
    await alert.getByRole('button', { name: 'Повторить', exact: true }).click();
  }
  await expect(page.getByLabel('Первый вид дежурства', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить вид', exact: true }).click();
  await expect(page.getByLabel('Группа', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('Вид дежурства', { exact: true })).toHaveValue('9');
  await page.getByRole('button', { name: 'Далее: люди', exact: true }).click();
  await expect(page.getByLabel('Добавить: Сотрудник группы', { exact: true })).toBeVisible();
  expect(writes.map(row => row.kind)).toEqual(['groups', 'types']);
  expect(writes.every(row => row.divisionId === '2')).toBeTruthy();
  expect(businessWrites).toEqual([]);
});
