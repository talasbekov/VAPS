import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { MyAssignmentRow } from '@/hooks/use-my-assignments';
import type { PersonalDutyRow } from '@/widgets/my-profile/model/profile-next-shift';

// Use a separate reviewed config without global hooks. Every non-auth API read,
// including the old profile tabs and notification feeds, is mocked below.
test.use({ serviceWorkers: 'block' });

const ownId = '7171', foreignId = '7172';
const serverInstant = '2026-10-20T07:00:00Z'; // 12:00 in Astana.
const employee = (id = ownId) => ({ id: Number(id), first_name: 'Сотрудник', last_name: 'Профильный', middle_name: '',
  full_name: id === ownId ? 'Профильный Сотрудник' : 'Чужой Проверочный Сотрудник', is_active: true,
  rank_code: null, position_code: null, division: null, personnel_number: null, hire_date: null,
  rank_label: null, position_label: null, division_label: null });
const duty = (id: string, changes: Partial<PersonalDutyRow> = {}): PersonalDutyRow => ({
  id, source: 'STATUS', source_id: 9191, source_state: 'PLANNED', business_date: '2026-10-20',
  date_start: '2026-10-20', date_end: '2026-10-20', planned_start: '2026-10-20T13:00:00+05:00',
  planned_end: '2026-10-20T15:00:00+05:00', actual_start: null, actual_end: null, acknowledged_at: null,
  object_label: 'Объект ближайшего выхода', post_label: 'Пост 2', senior: null, instruction: null, readOnly: true,
  canAcknowledge: false, acknowledgementToken: null, ...changes,
});
const om = (changes: Partial<MyAssignmentRow> = {}): MyAssignmentRow => ({
  assignmentId: 'profile-next-om', eventId: '9192', eventCode: 'UX-NEXT-OM', eventTitle: 'Личное назначение ОМ',
  eventStage: 'CONDUCT', businessDate: '2026-10-20', businessDateEnd: null, objectName: 'Личная площадка ОМ',
  visitObjectId: null, visitObjectName: null, postId: 'profile-next-post', postFound: true,
  sector: 'Сектор А', post: 'Пост ОМ', task: 'Проверить пропуска на входе', requirements: '', uniform: '', weapon: '',
  roleCode: null, sectionCode: null, employeeHasAccount: true, canConfirmWithoutAccount: false,
  acknowledgedAt: null, acknowledgedVia: '', acknowledgedBy: '', declinedAt: null, declineReason: null,
  declinedVia: '', declinedBy: '', ...changes,
});
const emptyPage = { count: 0, next: null, previous: null, results: [] };
const card = (page: Page) => page.locator('[data-slot="my-next-shift"]');
const field = (page: Page, name: string) => card(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: name }) });
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release: () => release() };
};

async function profileFixture(page: Page) {
  const state = {
    duties: [duty('next')], assignments: [] as MyAssignmentRow[], generatedAt: serverInstant,
    dutyStatus: 200, assignmentStatus: 200, dutyReads: 0, dutySuccesses: 0,
    selfAssignmentReads: 0, foreignAssignmentReads: 0, oldShiftReads: 0, myEmployeeReads: 0,
    assignmentHold: null as Promise<void> | null, beforeDutyResponse: null as Promise<void> | null,
    onAssignmentHeld: null as (() => void) | null, heldAssignmentReads: 0, releasedAssignmentResponses: 0,
    unexpectedReads: [] as string[], pageErrors: [] as string[],
    acknowledgementPosts: [] as { key: string; body: unknown }[], acknowledgementHold: null as Promise<void> | null,
  };
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.startsWith('/api/auth/')) return route.fallback();
    const personalAcknowledgement = /^\/api\/ops\/personal-duty\/([^/]+)\/acknowledge\/$/.exec(path);
    if (request.method() === 'POST' && personalAcknowledgement) {
      // Deliberately intercepted before ux-fixture's write guard; this never reaches the API.
      const key = decodeURIComponent(personalAcknowledgement[1]);
      const body = request.postDataJSON() as { token?: unknown };
      state.acknowledgementPosts.push({ key, body });
      if (state.acknowledgementHold) await state.acknowledgementHold;
      const row = state.duties.find(item => item.id === key);
      if (!row || Object.keys(body).join(',') !== 'token' || body.token !== row.acknowledgementToken) return route.fulfill({
        status: 409, json: { error_code: 'PERSONAL_DUTY_CHANGED', message: 'Назначение изменилось. Обновите данные.', details: {} },
      });
      const record = { ...row, acknowledged_at: state.generatedAt, source_state: 'ACKNOWLEDGED', canAcknowledge: false };
      state.duties = state.duties.map(item => item.id === key ? record : item);
      return route.fulfill({ json: { record, generated_at: state.generatedAt, time_zone: 'Asia/Almaty' } });
    }
    // Delegate forbidden writes to ux-fixture so they are recorded as test failures.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.fallback();
    if (path === '/api/operations/my-permissions/') return route.fulfill({ json: {
      permissions: ['status.view'], global_permissions: [],
      roles: [{ code: 'EMPLOYEE', name: 'Сотрудник', scope_division_id: null, scope_division_name: null }],
    } });
    if (path === '/api/operations/my-employee/') {
      state.myEmployeeReads++;
      return route.fulfill({ json: { employee: employee(), unlinked_reason: null } });
    }
    if (path === `/api/core/employees/${foreignId}/`) return route.fulfill({ json: employee(foreignId) });
    if (['/api/core/ranks/', '/api/core/positions/', '/api/core/divisions/', '/api/operations/statuses/',
      '/api/operations/status-types/', '/api/operations/notifications/'].includes(path)) return route.fulfill({ json: emptyPage });
    if (path === '/api/ops/rating-notifications/') return route.fulfill({ json: { results: [], unavailableViews: [] } });
    if (path === '/api/notifications/notifications/unread/') return route.fulfill({ json: [] });
    if (path === '/api/ops/duty-shifts/mine/') {
      state.oldShiftReads++;
      return route.fulfill({ json: { results: [], unlinkedReason: null } });
    }
    if (path === '/api/ops/personal-duty/') {
      state.dutyReads++;
      const status = state.dutyStatus;
      if (state.beforeDutyResponse) await state.beforeDutyResponse;
      if (status !== 200) return route.fulfill({ status, json: { error_code: 'FIXTURE_READ_DENIED', message: 'Личные смены недоступны', details: {} } });
      state.dutySuccesses++;
      return route.fulfill({ json: { employeeId: ownId, unlinkedReason: null,
        time_zone: 'Asia/Almaty', generated_at: state.generatedAt, results: state.duties } });
    }
    if (path === '/api/ops/security-events/my-assignments/') {
      const foreign = url.searchParams.get('employee') === foreignId;
      if (foreign) state.foreignAssignmentReads++; else state.selfAssignmentReads++;
      const status = state.assignmentStatus;
      const response = { employeeId: foreign ? foreignId : ownId, unlinkedReason: null,
        results: foreign ? [om({ assignmentId: 'foreign-assignment', objectName: 'Объект чужого сотрудника' })] : structuredClone(state.assignments) };
      const hold = foreign ? null : state.assignmentHold;
      if (hold) {
        state.heldAssignmentReads++;
        state.onAssignmentHeld?.();
        await hold;
      }
      await route.fulfill(status === 200 ? { json: response }
        : { status, json: { error_code: 'FIXTURE_READ_DENIED', message: 'Назначения недоступны', details: {} } });
      if (hold) state.releasedAssignmentResponses++;
      return;
    }
    // Never let an unlisted GET reach an API that could mark a business record viewed.
    state.unexpectedReads.push(path + url.search);
    return route.fulfill({ status: 404, json: { detail: 'Unmocked API read blocked by profile UX fixture' } });
  });
  return state;
}

async function openProfile(page: Page, options: { foreign?: boolean; clientTime?: string } = {}) {
  await signIn(page);
  if (options.clientTime) {
    const time = new Date(options.clientTime);
    await page.clock.install({ time });
    // A running fake clock can move performance.now() backwards while it drains
    // timer callbacks. Keep this boundary scenario paused and advance it explicitly.
    await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  }
  await page.goto(options.foreign ? `/security-ops/profile/${foreignId}/` : '/security-ops/profile/');
  const heading = page.getByRole('heading', { name: employee(options.foreign ? foreignId : ownId).full_name, exact: true });
  if (options.clientTime) await expect.poll(async () => {
    await page.clock.runFor(100);
    return await heading.isVisible() && await card(page).locator('dl').count() > 0 &&
      await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).isEnabled();
  }, { message: 'The paused boundary fixture must finish its initial profile reads' }).toBe(true);
  await expect(heading).toBeVisible();
  if (!options.foreign) await expect(card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true })).toBeEnabled();
}
function assertIsolated(state: Awaited<ReturnType<typeof profileFixture>>, businessWrites: string[]) {
  expect(state.unexpectedReads, 'All business API reads must remain inside browser fixtures').toEqual([]);
  expect(state.pageErrors).toEqual([]);
  expect(businessWrites).toEqual([]);
}

test('exact exits advance across a gap using server time while the workstation is on another year', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  state.generatedAt = '2026-10-20T06:59:40Z';
  state.duties = [
    duty('past', { object_label: 'Уже прошедший выход', planned_start: '2026-10-20T08:00:00+05:00', planned_end: '2026-10-20T09:00:00+05:00' }),
    duty('current-window', { object_label: 'Текущий плановый выход', planned_start: '2026-10-20T11:00:00+05:00', planned_end: '2026-10-20T12:00:00+05:00' }),
    duty('next'), duty('late', { object_label: 'Поздний выход', planned_start: '2026-10-20T17:00:00+05:00', planned_end: '2026-10-20T19:00:00+05:00' }),
  ];
  await openProfile(page, { clientTime: '2031-01-01T12:00:00Z' });
  await expect(card(page)).toContainText('Текущий плановый выход');
  await expect(field(page, 'Заступление')).toContainText('Не отмечено');
  const reads = state.dutyReads;
  await page.clock.runFor(31_000);
  await expect(card(page)).toContainText('Объект ближайшего выхода');
  await expect(field(page, 'Начало по плану')).toContainText('20.10.2026, 13:00');
  await expect(field(page, 'Окончание по плану')).toContainText('20.10.2026, 15:00');
  await expect(card(page)).not.toContainText('Текущий плановый выход');
  await expect(card(page)).not.toContainText('Сейчас на смене');
  expect(state.dutyReads).toBe(reads);
  assertIsolated(state, businessWrites);
});

test('multiday personnel source periods do not reorder their exact exits ahead of a nearer day', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  state.duties = [duty('far', { object_label: 'Дальний выход', business_date: '2026-10-22', date_start: '2026-10-20', date_end: '2026-10-22',
    planned_start: '2026-10-22T08:00:00+05:00', planned_end: '2026-10-22T10:00:00+05:00' }),
  duty('near', { object_label: 'Завтрашний выход', business_date: '2026-10-21', date_start: '2026-10-21', date_end: '2026-10-21',
    planned_start: '2026-10-21T08:00:00+05:00', planned_end: '2026-10-21T10:00:00+05:00' })];
  await openProfile(page);
  await expect(card(page)).toContainText('Завтрашний выход');
  await expect(card(page)).not.toContainText('Дальний выход');
  state.assignments = [om()];
  await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
  await expect(card(page)).toContainText('Личная площадка ОМ');
  assertIsolated(state, businessWrites);
});

test('an actual current exit wins and completed cancelled or expired records cannot replace the next exit', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  const active = duty('active', { source: 'LOG', source_state: 'ACTIVE', object_label: 'Текущая фактическая смена',
    business_date: '2026-10-19', date_start: '2026-10-19', date_end: '2026-10-19', planned_start: null, planned_end: null,
    actual_start: '2026-10-19T23:00:00+05:00' });
  state.duties = [duty('next'), active,
    duty('cancelled', { object_label: 'Отменённая смена', source_state: 'CANCELLED', actual_start: '2026-10-20T08:00:00+05:00' }),
    duty('completed', { object_label: 'Завершённая смена', source_state: 'COMPLETED', actual_start: '2026-10-20T08:00:00+05:00', actual_end: '2026-10-20T09:00:00+05:00' }),
    duty('expired', { object_label: 'Истёкший план', planned_start: '2026-10-20T09:00:00+05:00', planned_end: '2026-10-20T11:00:00+05:00' })];
  await openProfile(page);
  await expect(card(page)).toContainText('Текущая фактическая смена');
  await expect(card(page)).toContainText('Сейчас на смене');
  await expect(field(page, 'Заступление')).toContainText('Отмечено');
  await expect(field(page, 'Ознакомление')).toContainText('Не подтверждено');
  active.source_state = 'COMPLETED'; active.actual_end = serverInstant;
  await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
  await expect(card(page)).toContainText('Объект ближайшего выхода');
  await expect(card(page)).not.toContainText('Сейчас на смене');
  for (const label of ['Текущая фактическая смена', 'Отменённая смена', 'Завершённая смена', 'Истёкший план']) await expect(card(page)).not.toContainText(label);
  assertIsolated(state, businessWrites);
});

test('date-only OM keeps unknown hours and separates acknowledgement from physical attendance', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  state.duties = [];
  state.assignments = [om({ acknowledgedAt: '2026-10-19T10:00:00Z', acknowledgedVia: 'self' })];
  await openProfile(page);
  await expect(card(page)).toContainText('Личная площадка ОМ');
  await expect(field(page, 'Начало по плану')).toContainText('Не указано');
  await expect(field(page, 'Окончание по плану')).toContainText('Не указано');
  await expect(field(page, 'Ознакомление')).toContainText('Подтверждено');
  await expect(field(page, 'Заступление')).toContainText('Не отмечено');
  await expect(field(page, 'Старший')).toContainText('Не указан');
  await expect(field(page, 'Инструкция')).toContainText('Проверить пропуска на входе');
  await expect(card(page)).not.toContainText('00:00');
  await expect(card(page)).not.toContainText('Сейчас на смене');
  await expect(card(page).getByRole('link', { name: 'Открыть инструкцию в ОМ', exact: true })).toHaveCount(0);
  assertIsolated(state, businessWrites);
});

for (const deniedStatus of [401, 403]) test(`a held older OM response cannot revive private data after ${deniedStatus} and a fresh sibling read`, async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  state.duties = []; state.assignments = [om({ objectName: 'Закрытая личная площадка' })];
  await openProfile(page);
  await expect(card(page)).toContainText('Закрытая личная площадка');
  const held = deferred(), started = deferred();
  state.assignmentHold = held.promise;
  state.onAssignmentHeld = started.release;
  state.beforeDutyResponse = started.promise;
  state.dutyStatus = deniedStatus;
  try {
    await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
    await expect.poll(() => state.heldAssignmentReads).toBeGreaterThan(0);
    await expect(card(page)).toContainText('Ближайшую смену определить не удалось');
    await expect(card(page)).not.toContainText('Закрытая личная площадка');
    const successes = state.dutySuccesses;
    state.dutyStatus = 200;
    state.beforeDutyResponse = null;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.dutySuccesses).toBeGreaterThan(successes);
    await expect(card(page)).not.toContainText('серверное время');
    state.assignmentHold = null; state.onAssignmentHeld = null; held.release();
    await expect.poll(() => state.releasedAssignmentResponses).toBeGreaterThan(0);
    await expect(card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true })).toBeEnabled();
    await expect(card(page)).not.toContainText('Закрытая личная площадка');
    state.dutyStatus = 503; state.assignmentStatus = 503;
    await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
    await expect(card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true })).toBeEnabled();
    await expect(card(page)).not.toContainText('Закрытая личная площадка');
    state.dutyStatus = 200; state.assignmentStatus = 200;
    await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
    await expect(card(page)).toContainText('Закрытая личная площадка');
  } finally { held.release(); started.release(); }
  assertIsolated(state, businessWrites);
});

test('foreign read-only profile never fetches or displays the viewers personal sources', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  await openProfile(page, { foreign: true });
  await expect(page.locator('[data-slot="read-only"]')).toBeVisible();
  await expect(page.getByText('Объект чужого сотрудника', { exact: false }).first()).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(state.dutyReads).toBe(0); expect(state.oldShiftReads).toBe(0);
  expect(state.selfAssignmentReads).toBe(0); expect(state.myEmployeeReads).toBe(0);
  expect(state.foreignAssignmentReads).toBeGreaterThan(0);
  assertIsolated(state, businessWrites);
});

test('invalid server time cannot turn workstation dates into a current shift', async ({ page, businessWrites }) => {
  const state = await profileFixture(page);
  state.generatedAt = 'invalid-server-time';
  await openProfile(page);
  await expect(card(page)).toContainText('Не удалось подтвердить серверное время');
  await expect(card(page)).toContainText('Ближайшую смену определить не удалось');
  await expect(card(page)).not.toContainText('Объект ближайшего выхода');
  await expect(card(page)).not.toContainText('Ближайших назначений нет');
  assertIsolated(state, businessWrites);
});

test('own non-OM acknowledgement sends the seen token once and records intent separately from attendance', async ({ page, businessWrites }, testInfo) => {
  const state = await profileFixture(page), token = 'a'.repeat(64), key = 'LOG:9191';
  state.duties = [duty(key, { source: 'LOG', canAcknowledge: true, acknowledgementToken: token })];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openProfile(page);
  const acknowledge = card(page).getByRole('button', { name: 'Ознакомлен, заступлю', exact: true });
  await expect(acknowledge).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('profile-next-1440.png'), fullPage: true });
  const hold = deferred(); state.acknowledgementHold = hold.promise;
  const assignmentReads = state.selfAssignmentReads, dutyReads = state.dutyReads;
  try {
    // Two immediate native clicks exercise the synchronous request lock before React rerenders.
    await acknowledge.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await expect.poll(() => state.acknowledgementPosts.length).toBe(1);
    await expect(card(page).getByRole('button', { name: 'Подтверждаем ознакомление…', exact: true })).toBeDisabled();
    await expect(field(page, 'Ознакомление')).toContainText('Не подтверждено');
    await expect(field(page, 'Заступление')).toContainText('Не отмечено');
  } finally { state.acknowledgementHold = null; hold.release(); }
  await expect(field(page, 'Ознакомление')).toContainText('Подтверждено');
  await expect(field(page, 'Заступление')).toContainText('Не отмечено');
  await expect(card(page)).not.toContainText('Сейчас на смене');
  await expect(acknowledge).toHaveCount(0);
  expect(state.acknowledgementPosts).toEqual([{ key, body: { token } }]);
  expect(state.dutyReads).toBeGreaterThan(dutyReads);
  expect(state.selfAssignmentReads).toBe(assignmentReads);
  expect(state.duties[0].actual_start).toBeNull(); expect(state.duties[0].actual_end).toBeNull();
  assertIsolated(state, businessWrites);
});

test('a cached edited LOG token requires refresh before the employee can acknowledge the changed post', async ({ page, businessWrites }) => {
  const state = await profileFixture(page), key = 'LOG:9191', oldToken = 'a'.repeat(64), newToken = 'b'.repeat(64);
  state.duties = [duty(key, { source: 'LOG', canAcknowledge: true, acknowledgementToken: oldToken })];
  await openProfile(page);
  const acknowledge = card(page).getByRole('button', { name: 'Ознакомлен, заступлю', exact: true });
  await expect(acknowledge).toBeEnabled();
  state.duties = [duty(key, { source: 'LOG', post_label: 'Изменённый пост 3', canAcknowledge: true, acknowledgementToken: newToken })];
  await acknowledge.click();
  await expect(card(page).getByRole('alert')).toContainText('Обновите ближайшую смену');
  await expect(acknowledge).toBeDisabled();
  await expect(field(page, 'Ознакомление')).toContainText('Не подтверждено');
  expect(state.duties[0].acknowledged_at).toBeNull();
  await card(page).getByRole('button', { name: 'Обновить ближайшую смену', exact: true }).click();
  await expect(card(page)).toContainText('Изменённый пост 3');
  await expect(acknowledge).toBeEnabled();
  await acknowledge.click();
  await expect(field(page, 'Ознакомление')).toContainText('Подтверждено');
  await expect(field(page, 'Заступление')).toContainText('Не отмечено');
  expect(state.acknowledgementPosts).toEqual([{ key, body: { token: oldToken } }, { key, body: { token: newToken } }]);
  assertIsolated(state, businessWrites);
});

for (const width of [320, 390]) test(`next shift remains readable without horizontal overflow at ${width}px`, async ({ page, businessWrites }, testInfo) => {
  const state = await profileFixture(page);
  state.duties = [duty('long', { object_label: 'Длинное название объекта постоянного пребывания для проверки мобильного профиля',
    post_label: 'Сектор А · пост дополнительного контроля входной группы', senior: 'Проверочный Старший Сотрудник',
    instruction: 'Проверять пропуска на входе и передавать информацию старшему согласно инструкции поста.',
    canAcknowledge: true, acknowledgementToken: 'a'.repeat(64) })];
  await page.setViewportSize({ width, height: 950 });
  await openProfile(page);
  await expect(card(page)).toContainText('пост дополнительного контроля');
  await expect(field(page, 'Начало по плану')).toContainText('13:00');
  await expect(field(page, 'Инструкция')).toContainText('Проверять пропуска');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await card(page).evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await expect(card(page).getByRole('button', { name: 'Ознакомлен, заступлю', exact: true })).toBeEnabled();
  if (width === 320) await page.screenshot({ path: testInfo.outputPath('profile-next-320.png'), fullPage: true });
  assertIsolated(state, businessWrites);
});
