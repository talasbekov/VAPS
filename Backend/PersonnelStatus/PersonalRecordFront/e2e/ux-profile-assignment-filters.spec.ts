import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const staff = { id: 6161, first_name: 'Назначения', last_name: 'Проверка', middle_name: '', full_name: 'Проверка Назначения', is_active: true, rank_code: null, position_code: null, division: null, personnel_number: 'APP9', hire_date: null };
const assignment = (id: string, from: string, to: string | null, stage = 'CONDUCT') => ({ assignmentId: id, eventId: id, eventCode: 'UX-APP9-' + id, eventTitle: 'Назначение ' + id, eventStage: stage, businessDate: from, businessDateEnd: to, objectName: 'Объект ' + id, visitObjectId: null, visitObjectName: null, postId: 'post-' + id, postFound: true, sector: 'Сектор', post: 'Пост', task: '', requirements: '', uniform: '', weapon: '', roleCode: null, sectionCode: null, employeeHasAccount: true, acknowledgedAt: null, acknowledgedVia: '', acknowledgedBy: '', declinedAt: null, declineReason: null, declinedVia: '', declinedBy: '' });
const shift = (id: string, date: string, stateCode = 'PLANNED') => ({ id, businessDate: date, dutyTypeCode: 'UX', target: { targetType: 'OWN_OBJECT', objectId: id, safeLabel: 'Дежурство ' + id }, employeeName: staff.full_name, employeeId: String(staff.id), stateCode, acknowledgedAt: null, actualStart: stateCode === 'ACTIVE' ? '2026-10-12T20:00:00+05:00' : null, actualEnd: null, updatedAt: '2026-10-13T10:00:00+05:00', passportBinding: null, note: null, cancellation: null, overrideReason: null });
const paths = { assignments: '/api/ops/security-events/my-assignments/', shifts: '/api/ops/duty-shifts/mine/' };
async function setup(page: Page, options: { foreign?: boolean; failShifts?: boolean } = {}) {
  const state = { employeeId: staff.id, employeeReads: 0, failure: { assignments: 0, shifts: options.failShifts ? 503 : 0 }, reads: { assignments: 0, shifts: 0 } };
  await page.clock.install({ time: new Date('2026-10-13T05:00:00Z') });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['status.view'], global_permissions: ['status.view'], roles: [] } }));
  await page.route(url => url.pathname === '/api/operations/my-employee/', route => {
    state.employeeReads++;
    return route.fulfill({ json: { employee: { ...staff, id: state.employeeId, full_name: staff.full_name + ' ' + state.employeeId }, unlinked_reason: null } });
  });
  await page.route(url => url.pathname === '/api/core/employees/' + staff.id + '/', route => route.fulfill({ json: staff }));
  await page.route(url => url.pathname === '/api/operations/statuses/', route => route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }));
  for (const source of Object.keys(paths) as (keyof typeof paths)[]) await page.route(url => url.pathname === paths[source], route => {
    state.reads[source]++;
    if (state.failure[source]) return route.fulfill({ status: state.failure[source], json: { detail: 'Источник временно недоступен' } });
    const results = source === 'assignments' ? [assignment('CURRENT', '2026-10-12', '2026-10-14'), assignment('FUTURE', '2026-10-15', null), assignment('PAST', '2026-10-11', null), assignment('CLOSED', '2026-10-16', null, 'CLOSED')] : [shift('сегодня', '2026-10-13', 'ACKNOWLEDGED'), shift('завтра', '2026-10-14'), shift('продолжается', '2026-10-12', 'ACTIVE'), shift('завершено', '2026-10-13', 'COMPLETED'), shift('отменено', '2026-10-15', 'CANCELLED')];
    return route.fulfill({ json: { count: results.length, results, next: null, previous: null, employeeId: String(staff.id), unlinkedReason: null } });
  });
  await signIn(page); await page.goto(options.foreign ? '/security-ops/profile/' + staff.id + '/' : '/security-ops/profile/');
  await expect(page.getByRole('button', { name: options.foreign ? 'Назначения' : 'Мои назначения', exact: true })).toBeVisible();
  await expect(page.getByText('UX-APP9-CURRENT', { exact: false }).first()).toBeVisible();
  return state;
}
const marker = (page: Page, value: string) => page.locator('[data-slot="profile-assignments"]').getByText(value, { exact: false }).first();
const failure = (page: Page) => page.getByRole('alert').filter({ hasText: 'Не удалось загрузить смены дежурств.' });

test('profile filters separate current and upcoming events and duty shifts', async ({ page, businessWrites }) => {
  await setup(page); await page.getByLabel('Период назначений', { exact: true }).selectOption('current');
  await expect(marker(page, 'UX-APP9-CURRENT')).toBeVisible(); await expect(marker(page, 'UX-APP9-FUTURE')).toBeHidden(); await expect(marker(page, 'UX-APP9-PAST')).toBeHidden();
  await expect(marker(page, 'Дежурство сегодня')).toBeVisible(); await expect(marker(page, 'Дежурство продолжается')).toBeVisible(); await expect(marker(page, 'Дежурство завтра')).toBeHidden();
  await page.getByLabel('Тип назначений', { exact: true }).selectOption('shifts');
  await expect(marker(page, 'UX-APP9-CURRENT')).toBeHidden();
  await page.getByLabel('Период назначений', { exact: true }).selectOption('upcoming');
  await expect(marker(page, 'Дежурство завтра')).toBeVisible(); await expect(marker(page, 'Дежурство продолжается')).toBeHidden();
  await page.getByLabel('Тип назначений', { exact: true }).selectOption('events');
  await expect(marker(page, 'UX-APP9-FUTURE')).toBeVisible(); await expect(marker(page, 'Дежурство завтра')).toBeHidden();
  expect(businessWrites).toEqual([]);
});

test('all assignments retain a past unclosed event and exclude closed and cancelled shifts', async ({ page, businessWrites }) => {
  await setup(page); await expect(marker(page, 'UX-APP9-PAST')).toBeVisible();
  await expect(marker(page, 'UX-APP9-CLOSED')).toBeHidden(); await expect(marker(page, 'Дежурство отменено')).toBeHidden(); await expect(marker(page, 'Дежурство завершено')).toBeHidden();
  await expect(page.getByRole('link', { name: /UX-APP9-CURRENT/ })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

for (const width of [1440, 390, 320]) test('assignment filters survive a calendar round trip at ' + width, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 950 }); await setup(page);
  await page.getByLabel('Тип назначений', { exact: true }).selectOption('shifts'); await page.getByLabel('Период назначений', { exact: true }).selectOption('upcoming');
  await expect(marker(page, 'Дежурство завтра')).toBeVisible(); await page.getByRole('button', { name: 'Календарь', exact: true }).click(); await page.getByRole('button', { name: 'Мои назначения', exact: true }).click();
  await expect(page.getByLabel('Тип назначений', { exact: true })).toHaveValue('shifts'); await expect(page.getByLabel('Период назначений', { exact: true })).toHaveValue('upcoming');
  await expect(marker(page, 'Дежурство завтра')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('duty read failure retries in place with both selected filters', async ({ page, businessWrites }) => {
  const state = await setup(page, { failShifts: true }); await page.getByLabel('Тип назначений', { exact: true }).selectOption('shifts'); await page.getByLabel('Период назначений', { exact: true }).selectOption('upcoming');
  await expect(failure(page)).toBeVisible(); await expect(page.getByText('Дежурств по выбранным условиям нет.', { exact: true })).toBeHidden();
  state.failure.shifts = 0; await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(marker(page, 'Дежурство завтра')).toBeVisible(); await expect(page.getByLabel('Тип назначений', { exact: true })).toHaveValue('shifts'); await expect(page.getByLabel('Период назначений', { exact: true })).toHaveValue('upcoming');
  expect(businessWrites).toEqual([]);
});

test('denied duty data remains hidden through a transient retry until a successful read', async ({ page, businessWrites }) => {
  const state = await setup(page); await page.getByLabel('Тип назначений', { exact: true }).selectOption('shifts'); await expect(marker(page, 'Дежурство сегодня')).toBeVisible();
  state.failure.shifts = 403; const reads = state.reads.shifts; await page.clock.fastForward(61000); await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.reads.shifts).toBeGreaterThan(reads); await expect(failure(page)).toBeVisible(); await expect(marker(page, 'Дежурство сегодня')).toBeHidden();
  state.failure.shifts = 503; await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(failure(page).getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled(); await expect(marker(page, 'Дежурство сегодня')).toBeHidden();
  state.failure.shifts = 0; await failure(page).getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(marker(page, 'Дежурство сегодня')).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('foreign profile does not request or present the viewers own duty shifts', async ({ page, businessWrites }) => {
  const state = await setup(page, { foreign: true }); await expect(page.getByLabel('Тип назначений', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Тип назначений', { exact: true }).locator('option[value="shifts"]')).toBeDisabled();
  await expect(page.getByText('Смены дежурств не показаны: смены другого сотрудника здесь не показываются.', { exact: true })).toBeVisible();
  expect(state.reads.shifts).toBe(0); await expect(marker(page, 'Дежурство сегодня')).toBeHidden(); expect(businessWrites).toEqual([]);
});

test('a changed employee resets filters even when returning to the previous employee', async ({ page, businessWrites }) => {
  const state = await setup(page);
  await page.getByLabel('Тип назначений', { exact: true }).selectOption('shifts');
  await page.getByLabel('Период назначений', { exact: true }).selectOption('upcoming');
  for (const employeeId of [6162, staff.id]) {
    state.employeeId = employeeId;
    const before = state.employeeReads;
    await page.clock.fastForward(61000);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.employeeReads).toBeGreaterThan(before);
    await expect(page.getByRole('heading', { name: staff.full_name + ' ' + employeeId, exact: true })).toBeVisible();
    await expect(page.getByLabel('Тип назначений', { exact: true })).toHaveValue('all');
    await expect(page.getByLabel('Период назначений', { exact: true })).toHaveValue('all');
  }
  expect(businessWrites).toEqual([]);
});
