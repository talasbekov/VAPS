import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';
import type { ServiceEmployeePage, ServiceEmployeeDetail, ServiceAssignment } from '../entities/service-employee';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106';
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100';
const LIVE = process.env.SMOKE_LIVE === '1';

async function login(page: Page, username: string, password: string) {
  const request = page.context().request;
  const csrf = await (await request.get(`${APP}/api/auth/csrf/`)).json();
  const response = await request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  });
  expect(response.ok()).toBeTruthy();
  const tokenResponse = await request.post(`${API}/api/token/`, { data: { username, password } });
  expect(tokenResponse.ok()).toBeTruthy();
  const token = (await tokenResponse.json()).access as string;
  return { Authorization: `Bearer ${token}` };
}

test.describe('№1043 сотрудники Службы', () => {
  test.skip(!LIVE, 'Нужен SMOKE_LIVE=1 и живой стек');

  test('список, поиск, пагинация, карточка и возврат с фильтром', async ({ page }, testInfo) => {
    const headers = await login(page, STAND_USERNAME, STAND_PASSWORD);
    const response = await page.request.get(`${API}/api/core/service-employees/?page_size=1`, { headers });
    expect(response.status()).toBe(200);
    const first = await response.json() as ServiceEmployeePage;
    expect(first.count).toBeGreaterThan(1);
    const employee = first.results[0];
    expect(Object.keys(employee)).not.toEqual(expect.arrayContaining(['iin']));
    const foreignId = first.results[0].id;
    const personalPassword = process.env.ACCESS_MATRIX_PASSWORD;
    if (personalPassword) {
      const ownToken = await page.request.post(`${API}/api/token/`, { data: { username: 'acc_employee', password: personalPassword } });
      expect(ownToken.status()).toBe(200);
      const ownHeaders = { Authorization: `Bearer ${(await ownToken.json()).access}` };
      const ownList = await (await page.request.get(`${API}/api/core/service-employees/`, { headers: ownHeaders })).json() as ServiceEmployeePage;
      const otherId = foreignId === ownList.results[0]?.id
        ? (await (await page.request.get(`${API}/api/core/service-employees/?page_size=1&page=2`, { headers })).json()).results[0].id
        : foreignId;
      expect((await page.request.get(`${API}/api/core/service-employees/${otherId}/`, { headers: ownHeaders })).status()).toBe(404);
    }
    await page.goto(`${APP}/service-employees?page_size=1`);
    await expect(page.getByRole('heading', { name: 'Сотрудники Службы', exact: true })).toBeVisible();
    await expect(page.getByTestId('service-employee-row')).toHaveCount(1);
    await expect(page.getByRole('link', { name: employee.full_name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('service-employee-row')).toHaveCount(1);
    await expect(page.getByRole('link', { name: employee.full_name, exact: true })).toHaveCount(0);
    await page.getByLabel('Поиск по ФИО, табельному номеру или позывному').fill(employee.personnel_number);
    await page.getByRole('button', { name: 'Применить фильтры' }).click();
    await expect(page).not.toHaveURL(/page=2/);
    await expect(page.getByTestId('service-employee-row')).toHaveCount(1);
    const filtersUrl = page.url();
    await page.getByRole('link', { name: employee.full_name, exact: true }).click();
    await expect(page).toHaveURL(/directory=1/);
    await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeVisible();
    await expect(page.getByText('История закрытых ОМ', { exact: true })).toBeVisible();
    const cardResponse = await page.request.get(`${API}/api/core/service-employees/${employee.id}/`, { headers });
    const card = await cardResponse.json();
    if (card.rating === null) await expect(page.getByTestId('service-profile-rating')).toHaveCount(0);
    else await expect(page.getByTestId('service-profile-rating')).toContainText(`${card.rating.toFixed(1).replace('.', ',')} / 10`);
    for (const field of ['iin', 'notes', 'personal_phone', 'personal_email', 'birth_date']) {
      expect(card).not.toHaveProperty(field);
    }
    await expect(page.getByText('ИИН', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Личный телефон', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ознакомлен, заступлю', exact: true })).toHaveCount(0);
    const output = path.resolve('smoke-results');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, '1043-card.png'), fullPage: true });
    await testInfo.attach('Карточка сотрудника', { path: path.join(output, '1043-card.png'), contentType: 'image/png' });
    await page.getByRole('link', { name: '← Сотрудники Службы' }).click();
    await expect(page).toHaveURL(filtersUrl);
    await expect(page.getByLabel('Поиск по ФИО, табельному номеру или позывному')).toHaveValue(employee.personnel_number);
    await page.getByLabel('Поиск по ФИО, табельному номеру или позывному').fill('nonexistent-s1043');
    await page.getByRole('button', { name: 'Применить фильтры' }).click();
    await expect(page.getByText('Сотрудники не найдены', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(page.getByTestId('service-employee-row').first()).toBeVisible();
    await page.screenshot({ path: path.join(output, '1043-list.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, '1043-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test('сотрудник читает себя, чужая карточка возвращает 404', async ({ page }) => {
    const password = process.env.ACCESS_MATRIX_PASSWORD;
    test.skip(!password, 'Нет пароля матрицы доступа');
    const headers = await login(page, 'acc_employee', password!);
    const response = await page.request.get(`${API}/api/core/service-employees/`, { headers });
    expect(response.status()).toBe(200);
    const body = await response.json() as ServiceEmployeePage;
    expect(body.count).toBe(1);
    await page.goto(`${APP}/service-employees`);
    await expect(page.getByTestId('service-employee-row')).toHaveCount(1);
    await expect(page.getByRole('link', { name: body.results[0].full_name, exact: true })).toBeVisible();
    const denied = await page.request.get(`${API}/api/core/service-employees/2147483647/`, { headers });
    expect(denied.status()).toBe(404);
    await page.goto(`${APP}/security-ops/profile/2147483647?directory=1`);
    await expect(page.getByText('Сотрудник не найден в вашей области доступа.', { exact: true })).toBeVisible();
  });

  test('ссылка из подразделения сохраняет область в адресе списка', async ({ page }) => {
    await login(page, STAND_USERNAME, STAND_PASSWORD);
    await page.goto(`${APP}/organization`);
    const link = page.getByRole('link', { name: 'Сотрудники подразделения →' }).first();
    await expect(link).toBeVisible({ timeout: 30000 });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/service-employees\/?\?division_id=\d+$/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`division_id=${new URL(href!, APP).searchParams.get('division_id')}`));
    await expect(page.getByRole('heading', { name: 'Сотрудники Службы', exact: true })).toBeVisible();
    await expect(page.getByLabel('Подразделение и подчинённые')).toHaveValue(new URL(href!, APP).searchParams.get('division_id')!);
  });
});

test.describe('№1043 контракт отображения карточки', () => {
  test.use({ serviceWorkers: 'block' });
  test.skip(!LIVE, 'Нужен живой вход; подменяется только проекция карточки, БД не меняется');

  test('последний день статуса, таблица истории и раскрытие оценки своего поста', async ({ page }) => {
    const headers = await login(page, STAND_USERNAME, STAND_PASSWORD);
    const first = await (await page.request.get(`${API}/api/core/service-employees/?page_size=1`, { headers })).json() as ServiceEmployeePage;
    const employee = first.results[0];
    const response = await page.request.get(`${API}/api/core/service-employees/${employee.id}/`, { headers });
    expect(response.status()).toBe(200);
    const detail = await response.json() as ServiceEmployeeDetail;
    const assignment: ServiceAssignment = {
      id: 'history-1', event_id: 314159, event_code: 'ТЕСТ-1043', event_title: 'Контрактная фикстура',
      object_name: 'Проверочный объект', post: 'Пост 1', sector: 'Периметр',
      date_start: '2026-09-01', date_end: '2026-09-01', closed: true, active: false, stage: 'CLOSED',
      acknowledged_at: '2026-09-01T03:00:00Z', declined_at: null, address: '', event_time: null,
      task: '', requirements: '', uniform: '', weapon: '', chief_name: '', chief_callsign: null, chief_work_phone: null,
    };
    const fixture: ServiceEmployeeDetail = {
      ...detail, current_status: { code: 'VACATION', name: 'В отпуске', date_end: '2026-10-01' },
      rating: 8, evaluations_count: 1, rated_events_count: 1, rating_state: 'READY',
      assignments: [], active_assignments_count: 0, next_assignment: null,
      history: [assignment, { ...assignment, id: 'history-2', post: 'Пост 2' }],
      evaluations: [{ event_id: 314159, event_code: 'ТЕСТ-1043', score: 8, comment: 'Пост выполнен',
        author: 'Автор проверки', date: '2026-09-02', assignment_id: 'history-1', post: 'Пост 1' }],
    };
    await page.route(`**/api/core/service-employees/${employee.id}/`, route => route.fulfill({ json: fixture }));
    await page.goto(`${APP}/security-ops/profile/${employee.id}?directory=1`);
    await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeVisible();
    await expect(page.getByText('В отпуске до 30.09.2026', { exact: true })).toBeVisible();
    const history = page.getByRole('table', { name: 'История закрытых ОМ', exact: true });
    await expect(history.getByRole('columnheader')).toHaveText(['Дата', 'Мероприятие', 'Объект', 'Пост', 'Ознакомление', 'Балл']);
    const rated = history.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Пост 1', exact: true }) });
    await rated.locator('summary').click();
    await expect(rated.getByText('Пост выполнен', { exact: true })).toBeVisible();
    await expect(rated.getByText('Автор проверки · 02.09.2026', { exact: true })).toBeVisible();
    await expect(history.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Пост 2', exact: true }) }).getByRole('cell').last()).toHaveText('—');
    await page.screenshot({ path: 'smoke-results/1043-contract-history.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'smoke-results/1043-contract-mobile.png' });
  });
});
