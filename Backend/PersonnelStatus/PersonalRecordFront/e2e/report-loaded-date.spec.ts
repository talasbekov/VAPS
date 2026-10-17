import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';

test('changing the date filter keeps row export tied to the loaded report until reloaded', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated portal; report and download are browser-only fixtures');
  const loadedDates: string[] = [];
  const exportedDates: string[] = [];
  await page.route('**/api/operations/strength-report/?*', route => {
    const businessDate = new URL(route.request().url()).searchParams.get('business_date')!;
    loadedDates.push(businessDate);
    return route.fulfill({ json: {
      business_date: businessDate, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' }, warnings: [],
      rows: [{ division_id: 9001, name: 'Тестовое управление', staff_total: 10, list_total: 9, vacancies: 1,
        columns: { IN_SERVICE: 9 }, event: { total: 0, group: 0, squad: 0 } }],
      totals: { staff_total: 10, list_total: 9, vacancies: 1, columns: { IN_SERVICE: 9 }, event: { total: 0, group: 0, squad: 0 } },
    } });
  });
  await page.route('**/api/operations/strength-report/export/?*', route => {
    const query = new URL(route.request().url()).searchParams;
    exportedDates.push(query.get('business_date')!);
    expect(query.get('division_id')).toBe('9001');
    expect(query.get('file_format')).toBe('xlsx');
    return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: 'browser-only download fixture' });
  });
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const login = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(login.ok()).toBeTruthy();
  await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
  await page.goto(APP + '/reports/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Показать расход', exact: true }).click();
  const exportA = page.getByRole('button', { name: 'Скачать снимок сдачи «Тестовое управление» на 2026-10-08, XLSX', exact: true });
  await expect(exportA).toBeVisible();
  expect(loadedDates).toEqual(['2026-10-08']);

  await page.getByRole('button', { name: '8 октября 2026', exact: true }).click();
  await page.locator('button[data-day]').filter({ hasText: /^9$/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '9 октября 2026', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Текущий расход на 2026-10-08' })).toContainText('Дата в фильтре изменена');
  await expect(exportA).toBeVisible();
  const downloadA = page.waitForEvent('download');
  await exportA.click();
  expect((await downloadA).suggestedFilename()).toBe('расход_Тестовое управление_2026-10-08.xlsx');
  expect(exportedDates).toEqual(['2026-10-08']);
  expect(loadedDates).toEqual(['2026-10-08']);

  await page.getByRole('button', { name: 'Показать расход', exact: true }).click();
  const exportB = page.getByRole('button', { name: 'Скачать снимок сдачи «Тестовое управление» на 2026-10-09, XLSX', exact: true });
  await expect(exportB).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Текущий расход на 2026-10-09' })).not.toContainText('Дата в фильтре изменена');
  const downloadB = page.waitForEvent('download');
  await exportB.click();
  expect((await downloadB).suggestedFilename()).toBe('расход_Тестовое управление_2026-10-09.xlsx');
  expect(exportedDates).toEqual(['2026-10-08', '2026-10-09']);
  expect(loadedDates).toEqual(['2026-10-08', '2026-10-09']);
});
