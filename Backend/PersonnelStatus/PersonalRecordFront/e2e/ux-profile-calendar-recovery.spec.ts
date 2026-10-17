import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const employee = { id: 5164, first_name: 'Сотрудник', last_name: 'Календарный', middle_name: '', full_name: 'Календарный Сотрудник', is_active: true, rank_code: null, position_code: null, division: null, personnel_number: null, hire_date: null };
const paths = { assignments: '/api/ops/security-events/my-assignments/', statuses: '/api/operations/statuses/', shifts: '/api/ops/duty-shifts/mine/' };
const labels = { assignments: 'назначения', statuses: 'статусы', shifts: 'смены дежурств' };
const markers = { assignments: 'UX-CALENDAR-OM', statuses: 'UX-CALENDAR-STATUS', shifts: 'Объект календарной смены' };
type Source = keyof typeof paths;
const assignment = { assignmentId: 'ux-calendar-assignment', eventId: 'ux-calendar-event', eventCode: markers.assignments, eventTitle: 'Календарное назначение', eventStage: 'CONDUCT', businessDate: '2026-10-14', businessDateEnd: null, objectName: 'Объект календаря', visitObjectId: null, visitObjectName: null, postId: 'ux-post', postFound: true, sector: 'Сектор', post: 'Пост календаря', task: '', requirements: '', uniform: '', weapon: '', roleCode: null, sectionCode: null, employeeHasAccount: true, acknowledgedAt: null, acknowledgedVia: '', acknowledgedBy: '', declinedAt: null, declineReason: null, declinedVia: '', declinedBy: '' };
const status = { id: 9988, employee_id: employee.id, status_type_code: markers.statuses, date_start: '2026-10-14', date_end: '2026-10-15', state: 'PLANNED', source: 'USER', comment: '', document_basis: '', cancelled_at: null, cancelled_reason: '', participations: [] };
const shift = { id: 'ux-calendar-shift', businessDate: '2026-10-14', dutyTypeCode: 'UX', target: { targetType: 'OWN_OBJECT', objectId: 'ux', safeLabel: markers.shifts }, employeeName: employee.full_name, employeeId: String(employee.id), stateCode: 'PLANNED', acknowledgedAt: null, actualStart: null, actualEnd: null, updatedAt: '2026-10-13T10:00:00+05:00', passportBinding: null, note: null, cancellation: null, overrideReason: null };

async function prepare(page: Page, options: { failed?: Source; heldAssignments?: boolean; statusDenied?: boolean; reason?: string; foreign?: boolean; openCalendar?: boolean } = {}) {
  const state = { failure: { assignments: 0, statuses: 0, shifts: 0 }, reads: { assignments: 0, statuses: 0, shifts: 0 }, permissionFailure: 0, permissionReads: 0, holdPermissions: false, releasePermissions: () => {}, release: () => {}, reason: options.reason ?? null };
  if (options.failed) state.failure[options.failed] = 503;
  const waiting = new Promise<void>(resolve => { state.release = resolve; });
  const permissionsWaiting = new Promise<void>(resolve => { state.releasePermissions = resolve; });
  await page.route('**/api/operations/my-permissions/**', async route => {
    state.permissionReads++;
    if (state.holdPermissions) await permissionsWaiting;
    const permissions = options.statusDenied ? [] : ['status.view'];
    return route.fulfill(state.permissionFailure ? { status: state.permissionFailure, json: { detail: 'Права временно недоступны' } } : { json: { permissions, global_permissions: permissions, roles: [] } });
  });
  await page.route(url => url.pathname === '/api/operations/my-employee/', route => route.fulfill({ json: { employee, unlinked_reason: null } }));
  await page.route(url => url.pathname === '/api/core/employees/' + employee.id + '/', route => route.fulfill({ json: employee }));
  for (const source of Object.keys(paths) as Source[]) await page.route(url => url.pathname === paths[source], async route => {
    state.reads[source]++;
    if (source === 'assignments' && options.heldAssignments) await waiting;
    if (state.failure[source]) return route.fulfill({ status: state.failure[source], json: { detail: 'Источник временно недоступен' } });
    const results = state.reason ? [] : source === 'assignments' ? [assignment] : source === 'statuses' ? [status] : [shift];
    return route.fulfill({ json: { results, count: results.length, next: null, previous: null, employeeId: String(employee.id), unlinkedReason: source === 'statuses' ? null : state.reason } });
  });
  await page.clock.install({ time: new Date('2026-10-13T05:00:00Z') });
  await signIn(page); await page.goto(options.foreign ? '/security-ops/profile/' + employee.id + '/' : '/security-ops/profile/');
  if (options.openCalendar !== false) await page.getByRole('button', { name: 'Календарь', exact: true }).click();
  return state;
}
async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}
const failureBox = (page: Page, source: Source) => page.getByRole('alert').filter({ hasText: 'Не удалось загрузить ' + labels[source] + '.' });
const calendarMarker = (page: Page, source: Source) => page.locator('[data-slot="upcoming-30"], [data-slot="day-list"]').getByText(markers[source], { exact: source === 'shifts' });
async function selectDay(page: Page) { await page.getByRole('button', { name: /^14 октября 2026/ }).click(); }

test('held assignments never make the calendar claim that a day is free', async ({ page, businessWrites }) => {
  const state = await prepare(page, { heldAssignments: true });
  try {
    await expect.poll(() => state.reads.assignments).toBeGreaterThan(0);
    await expect(page.getByText('В ближайшие 30 дней ни назначений, ни статусов, ни смен нет.', { exact: true })).toBeHidden();
    const day = page.getByRole('button', { name: /^15 октября 2026/ });
    if (await day.count()) await expect(day).not.toHaveAttribute('aria-label', /ничего не назначено/);
    await expect(page.getByText(/Загрузка календаря|Загружаем назначения/)).toBeVisible();
  } finally { state.release(); }
  await expect(calendarMarker(page, 'assignments')).toBeVisible(); expect(businessWrites).toEqual([]);
});

for (const source of Object.keys(paths) as Source[]) {
  test(source + ': initial calendar failure can retry without a false empty day', async ({ page, businessWrites }) => {
    const state = await prepare(page, { failed: source });
    const box = failureBox(page, source); await expect(box).toBeVisible();
    await page.getByRole('button', { name: /^15 октября 2026/ }).click();
    await expect(page.getByRole('button', { name: /^15 октября 2026/ })).toHaveAttribute('aria-label', /календарь неполный/);
    await expect(page.getByText(/Нет записей среди доступных данных/)).toBeVisible();
    state.failure[source] = 0; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(box).toBeHidden();
    await expect(page.getByRole('button', { name: /^15 октября 2026/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^15 октября 2026/ })).toHaveAttribute('aria-label', /ничего не назначено/);
    expect(businessWrites).toEqual([]);
  });

  test(source + ': transient cached failure preserves month, selected day and known periods', async ({ page, businessWrites }) => {
    const state = await prepare(page); await expect(calendarMarker(page, source)).toBeVisible();
    await selectDay(page); state.failure[source] = 503; await reconnect(page);
    const box = failureBox(page, source); await expect(box).toBeVisible(); await expect(box).toContainText('Ранее загруженные');
    await expect(calendarMarker(page, source)).toBeVisible();
    await expect(page.getByRole('button', { name: /^14 октября 2026/ })).toHaveAttribute('aria-pressed', 'true');
    state.failure[source] = 0; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(box).toBeHidden(); await expect(page.getByRole('button', { name: /^14 октября 2026/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Следующий месяц', exact: true }).click();
    await page.getByRole('button', { name: /^7 ноября 2026/ }).click(); state.failure[source] = 503; await reconnect(page);
    await expect(box).toBeVisible(); state.failure[source] = 0; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(box).toBeHidden(); await expect(page.getByRole('button', { name: /^7 ноября 2026/ })).toHaveAttribute('aria-pressed', 'true'); expect(businessWrites).toEqual([]);
  });

  test(source + ': denial and a subsequent transient failure keep old calendar periods hidden', async ({ page, businessWrites }) => {
    const state = await prepare(page); await expect(calendarMarker(page, source)).toBeVisible();
    state.failure[source] = 403; await reconnect(page); const box = failureBox(page, source); await expect(box).toBeVisible();
    await expect(calendarMarker(page, source)).toBeHidden(); state.failure[source] = 503; const readsBeforeRetry = state.reads[source]; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect.poll(() => state.reads[source]).toBeGreaterThanOrEqual(readsBeforeRetry + 2);
    await expect(box.getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled(); await expect(calendarMarker(page, source)).toBeHidden();
    await page.getByRole('button', { name: 'Мои назначения', exact: true }).click(); await page.getByRole('button', { name: 'Календарь', exact: true }).click();
    await expect(box).toBeVisible(); await expect(calendarMarker(page, source)).toBeHidden(); state.failure[source] = 0; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(calendarMarker(page, source)).toBeVisible(); expect(businessWrites).toEqual([]);
  });
}

test('a calendar without status rights keeps self-service assignments and shifts and marks its scope', async ({ page, businessWrites }) => {
  const state = await prepare(page, { statusDenied: true }); await expect(calendarMarker(page, 'assignments')).toBeVisible(); await expect(calendarMarker(page, 'shifts')).toBeVisible();
  expect(state.reads.statuses).toBe(0); await page.getByRole('button', { name: /^15 октября 2026/ }).click();
  await expect(page.getByRole('button', { name: /^15 октября 2026/ })).toHaveAttribute('aria-label', /календарь неполный/);
  await expect(page.getByText(/В календаре показаны назначения и дежурства/)).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('server reasons for unavailable assignments and shifts reach the calendar', async ({ page, businessWrites }) => {
  const reason = 'Сотрудник уволен — личные назначения больше не показываются.';
  await prepare(page, { reason }); await expect(page.getByText(reason, { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: /^15 октября 2026/ }).click(); await expect(page.getByText(/Нет записей среди доступных данных/)).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('a foreign calendar never reads own shifts and does not call its empty scope a free day', async ({ page, businessWrites }) => {
  const state = await prepare(page, { foreign: true }); await expect(calendarMarker(page, 'assignments')).toBeVisible();
  expect(state.reads.shifts).toBe(0); await expect(page.getByText(/Смены дежурств не показаны/)).toBeVisible();
  await page.getByRole('button', { name: /^15 октября 2026/ }).click();
  await expect(page.getByRole('button', { name: /^15 октября 2026/ })).toHaveAttribute('aria-label', /календарь неполный/); expect(businessWrites).toEqual([]);
});

test('a foreign profile remains hidden after its access denial changes to a transient failure', async ({ page, businessWrites }) => {
  const state = await prepare(page, { foreign: true }); const person = page.getByRole('heading', { name: employee.full_name, exact: true });
  await expect(person).toBeVisible(); state.failure.assignments = 403; await reconnect(page);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible(); await expect(person).toBeHidden();
  state.failure.assignments = 503; const reads = state.reads.assignments; await reconnect(page); await expect.poll(() => state.reads.assignments).toBeGreaterThanOrEqual(reads + 2);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(person).toBeHidden(); await expect(page.getByRole('button', { name: 'Повторить проверку профиля', exact: true })).toBeEnabled();
  state.failure.assignments = 0; await page.getByRole('button', { name: 'Повторить проверку профиля', exact: true }).click(); await expect(person).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('a held permission retry locks its own button and preserves the selected month and day', async ({ page, businessWrites }) => {
  const state = await prepare(page); await expect(calendarMarker(page, 'assignments')).toBeVisible();
  await page.getByRole('button', { name: 'Следующий месяц', exact: true }).click(); await page.getByRole('button', { name: /^7 ноября 2026/ }).click();
  state.permissionFailure = 403; await reconnect(page); const box = failureBox(page, 'statuses'); await expect(box).toBeVisible();
  state.permissionFailure = 0; state.holdPermissions = true; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
  try { await expect(box.getByRole('button', { name: 'Повторяем…', exact: true })).toBeDisabled(); } finally { state.releasePermissions(); }
  await expect(box).toBeHidden(); await expect(page.getByRole('button', { name: /^7 ноября 2026/ })).toHaveAttribute('aria-pressed', 'true'); expect(businessWrites).toEqual([]);
});

test('an initial foreign access check waits before showing the employee or reading statuses', async ({ page, businessWrites }) => {
  const state = await prepare(page, { foreign: true, heldAssignments: true, openCalendar: false });
  try {
    await expect.poll(() => state.reads.assignments).toBeGreaterThan(0);
    await expect(page.getByText('Проверяем доступ к профилю сотрудника…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeHidden(); expect(state.reads.statuses).toBe(0);
  } finally { state.release(); }
  await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});

test('an initial foreign access failure can retry while the employee remains hidden', async ({ page, businessWrites }) => {
  const state = await prepare(page, { foreign: true, failed: 'assignments', openCalendar: false });
  const box = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить доступ к профилю сотрудника.' }); await expect(box).toBeVisible();
  await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeHidden(); expect(state.reads.statuses).toBe(0); expect(state.reads.shifts).toBe(0);
  state.failure.assignments = 0; await box.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeVisible(); expect(businessWrites).toEqual([]);
});
