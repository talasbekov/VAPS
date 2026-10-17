import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { clickRowMenuItem } from './row-menu';
import { requireIsolatedForcesClone } from './owned-forces-fixture';

const APP = process.env.SMOKE_APP ?? '';
const API = process.env.SMOKE_API ?? '';
test.skip(process.env.SMOKE_LIVE !== '1' || process.env.DUTY_PLACEMENT_MUTATION !== '1',
  'Requires explicit duty placement mutation authorization on an approved disposable clone');

async function signIn(page: Page) {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`);
  expect(csrf.status()).toBe(200);
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: (await csrf.json()).csrfToken, username: process.env.SMOKE_USERNAME ?? 'admin', password: process.env.SMOKE_PASSWORD!, json: 'true',
  } });
  expect(response.ok()).toBe(true);
  expect(new URL((await response.json()).url).searchParams.has('error')).toBe(false);
}

async function openEmployee(page: Page, employeeId: number, marker: string) {
  await page.goto(`${APP}/statuses/`);
  await page.getByPlaceholder('Поиск по ФИО, подразделению, должности...').fill(marker);
  const row = page.locator(`tr[data-employee-id="${employeeId}"]`);
  await expect(row).toBeVisible();
  await clickRowMenuItem(page, row, 'Изменить статус');
  return page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
}

test('owned duty placement survives independent sessions and follows future/current status lifecycle', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  // Every target must match before authentication or creation of owned fixtures.
  requireIsolatedForcesClone();
  expect(testInfo.project.use.baseURL).toBe(APP);
  expect(Boolean(process.env.SMOKE_PASSWORD)).toBe(true);
  await signIn(page);
  const tokenResponse = await page.request.post(`${API}/api/token/`, { data: { username: process.env.SMOKE_USERNAME ?? 'admin', password: process.env.SMOKE_PASSWORD } });
  expect(tokenResponse.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await tokenResponse.json()).access}` };
  const tomorrowResponse = await page.request.get(`${API}/api/operations/tomorrow-block/`, { headers });
  expect(tomorrowResponse.status()).toBe(200);
  const tomorrow = (await tomorrowResponse.json()).business_date as string;
  const day = new Date(`${tomorrow}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  const today = day.toISOString().slice(0, 10);
  const marker = `PLACEMENT-${randomUUID()}`;

  const staffResponse = await page.request.get(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=1`, { headers });
  expect(staffResponse.status()).toBe(200);
  const division = (await staffResponse.json()).staff_units[0].division.id;
  const positionsResponse = await page.request.get(`${API}/api/dictionaries/positions/?page_size=200&is_active=true`, { headers });
  expect(positionsResponse.status()).toBe(200);
  const position = (await positionsResponse.json()).results.find((row: { is_active?: boolean }) => row.is_active !== false);
  expect(position).toBeTruthy();
  const employeeResponse = await page.request.post(`${API}/api/staff_unit/staff-units/directorate/`, { headers, data: {
    atomic: true, employees: [{ last_name: marker, first_name: 'Наряд', iin: null, rank: null }], staff_units: [{ division, position: position.id }],
  } });
  expect(employeeResponse.status()).toBe(201);
  const employeeFixture = await employeeResponse.json();
  expect(employeeFixture.success).toBe(true);
  const employeeId = employeeFixture.created.employees[0].id as number;
  testInfo.annotations.push({ type: 'owned-clone-fixture', description: `employee=${employeeId}; marker=${marker}` });

  const objectResponse = await page.request.post(`${API}/api/ops/objects/`, { headers, data: {
    name: marker, objectType: 'Проверка', region: 'Проверка', address: 'Изолированная проверка', ownership: 'OWN',
  } });
  expect(objectResponse.status()).toBe(201);
  const object = await objectResponse.json();
  expect(String(object.id)).toMatch(/^\d+$/);
  testInfo.annotations.push({ type: 'owned-clone-fixture', description: `object=${object.id}; marker=${marker}` });
  const passportResponse = await page.request.patch(`${API}/api/ops/objects/${object.id}/passport/`, { headers, data: {
    sectors: [{ name: 'Сектор проверки', posts: [{ name: 'Пост проверки', task: 'Проверка', requirements: '' }] }],
  } });
  expect(passportResponse.status()).toBe(200);
  const post = (await passportResponse.json()).sectors[0].posts[0];
  expect(String(post.id)).toMatch(/^\d+$/);

  // All browser writes outside authentication and this employee's status are blocked.
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || url.pathname.startsWith('/api/auth/')) return route.continue();
    if (url.pathname === '/api/statuses/statuses/' && request.method() === 'POST' && request.postDataJSON()?.employee === employeeId) return route.continue();
    return route.abort();
  });
  const dialog = await openEmployee(page, employeeId, marker);
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click();
  await page.getByRole('option', { name: 'На дежурстве', exact: true }).click();
  await dialog.getByRole('combobox', { name: /Тип дежурства/ }).click();
  await page.getByRole('option', { name: 'Постовое', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Объект/ }).click();
  await page.getByRole('option', { name: `${marker} (${object.code})`, exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Пост/ }).click();
  await page.getByRole('option', { name: 'Пост проверки (Сектор проверки)', exact: true }).click();
  await dialog.getByRole('button', { name: /^Дата окончания/ }).click();
  const calendarDay = await page.evaluate(iso => new Date(`${iso}T12:00:00`).toLocaleDateString(), today);
  await page.locator(`[data-slot="calendar"] button[data-day="${calendarDay}"]`).click();
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/statuses/statuses/' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const status = await saved.json();
  expect(status).toMatchObject({ employee: employeeId, status_type: 'on_duty', start_date: today, end_date: today,
    duty_assignment: { kind: 'POST', object_id: String(object.id), post_id: String(post.id), object_name: marker, post_name: 'Пост проверки' } });
  await expect(dialog).toHaveCount(0);

  const freshContext = await browser.newContext({
    baseURL: APP, serviceWorkers: 'block', viewport: { width: 1366, height: 900 },
    ...(process.env.DUTY_PLACEMENT_VIDEO === '1' ? { recordVideo: { dir: testInfo.outputPath('fresh-session'), size: { width: 1366, height: 900 } } } : {}),
  });
  try {
    const freshPage = await freshContext.newPage();
    await signIn(freshPage);
    const freshSessionResponse = await freshPage.request.get(`${APP}/api/auth/session/`);
    expect(freshSessionResponse.status()).toBe(200);
    const freshSession = await freshSessionResponse.json();
    expect(Boolean(freshSession.user?.accessToken), 'Independent session must provide an access token').toBe(true);
    const freshHeaders = { Authorization: `Bearer ${freshSession.user.accessToken}` };
    const freshDialog = await openEmployee(freshPage, employeeId, marker);
    await expect(freshDialog.getByRole('combobox', { name: /^Объект/ })).toContainText(marker);
    await expect(freshDialog.getByRole('combobox', { name: /^Пост/ })).toContainText('Пост проверки');
    await freshPage.keyboard.press('Escape');
    const rosterResponse = freshPage.waitForResponse(response => new URL(response.url()).pathname === '/api/statuses/statuses/duty-assignments/' && new URL(response.url()).searchParams.get('object_id') === String(object.id));
    await freshPage.goto(`${APP}/security-ops/objects/${object.id}/`);
    const roster = await rosterResponse;
    expect(roster.status()).toBe(200);
    expect((await roster.json()).results).toEqual([expect.objectContaining({ status_id: status.id, employee_id: employeeId, placement: expect.objectContaining({ post_id: String(post.id) }) })]);
    await expect(freshPage.getByText(`${marker} Наряд`, { exact: true })).toBeVisible();

    const future = await page.request.post(`${API}/api/statuses/statuses/`, { headers, data: { employee: employeeId, status_type: 'vacation', start_date: tomorrow, end_date: tomorrow, comment: marker } });
    expect(future.status()).toBe(201);
    const readRoster = async () => {
      const response = await freshPage.request.get(`${APP}/api/statuses/statuses/duty-assignments/?object_id=${object.id}&date=${today}`, { headers: freshHeaders });
      expect(response.status()).toBe(200);
      return (await response.json()).results;
    };
    expect(await readRoster()).toEqual([expect.objectContaining({ status_id: status.id, employee_id: employeeId })]);
    await freshPage.reload();
    await expect(freshPage.getByText(`${marker} Наряд`, { exact: true })).toBeVisible();
    const replacement = await page.request.post(`${API}/api/statuses/statuses/`, { headers, data: { employee: employeeId, status_type: 'vacation', start_date: today, end_date: today, comment: marker } });
    expect(replacement.status()).toBe(201);
    expect(await readRoster()).toEqual([]);
    await freshPage.reload();
    await expect(freshPage.getByText('На объекте нет заступивших сотрудников', { exact: true })).toBeVisible();
    await expect(freshPage.getByText(`${marker} Наряд`, { exact: true })).toHaveCount(0);
  } finally { await freshContext.close(); }
  // Fixtures intentionally remain confined to the explicitly identified disposable clone.
});
