import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { ForceCollectionWithObjects } from '@/hooks/use-force-collections';
import type { ForceRosterMember } from '@/entities/security-event';

const EVENT = 'ux-multi-object-forces';
const TITLE = 'Государственный визит делегации Кореи';
const CODE = 'ОМ-UX-MULTI';
const LIST = '/employees/?view=forces&tab=collections&businessDate=2026-10-16';
const CARD = `${LIST}&collection=${EVENT}`;
const BASE = `/api/ops/security-events/${EVENT}/force-collection/`;

type Visit = { visitObjectId: string; objectId: string | null; objectName: string; stage: string };
type CollectionFixture = ForceCollectionWithObjects & { visitObjects?: Visit[] };
type Assignment = { rows: { employeeId: string; visitObjectId: string | null }[] };

const visits: Visit[] = [
  { visitObjectId: 'visit-a', objectId: 'passport-a', objectName: 'Резиденция', stage: 'PLACEMENT' },
  { visitObjectId: 'visit-b', objectId: 'passport-b', objectName: 'Аэропорт', stage: 'PLACEMENT' },
];

function member(employeeId: string, name: string, visitObjectId: string | null = null): ForceRosterMember {
  return { employeeId, name, visitObjectId, divisionId: 'directorate', divisionName: 'Управление проверки',
    departmentId: 'department', departmentName: 'Департамент проверки', acceptedAt: '2026-10-15T06:00:00Z',
    statusCode: 'OM_PARTICIPATION', statusLabel: 'Участие в ОМ' };
}

function collection(): CollectionFixture {
  return {
    eventId: EVENT, code: CODE, title: TITLE, businessDate: '2026-10-16', eventTime: '09:00',
    location: 'Резиденция', stage: 'PLACEMENT', canCollect: true, need: 5, allocated: 0, gathered: 0, remaining: 5,
    collectionStatus: 'NEW', boardStatus: { code: 'NEW', label: 'Новая', answered: 0, total: 0 }, urgent: false,
    visitObjects: visits.map(visit => ({ ...visit })),
    needByObject: [
      { visitObjectId: 'visit-a', objectName: 'Резиденция', need: 3, statusLabel: 'Рекогносцировка завершена', chiefName: 'Старший А' },
      { visitObjectId: 'visit-b', objectName: 'Аэропорт', need: 2, statusLabel: 'Рекогносцировка завершена', chiefName: 'Старший Б' },
    ],
    totals: { need: 5, requested: 0, allocating: 0, sent: 0, shortage: 5 }, allocations: [], demandRows: [],
    roster: [], objects: [
      { visitObjectId: 'visit-a', objectName: 'Резиденция', need: 3, assigned: 0 },
      { visitObjectId: 'visit-b', objectName: 'Аэропорт', need: 2, assigned: 0 },
    ], handover: {},
  };
}

async function prepare(page: Page, detail = collection(), permissions = ['forces.command']) {
  const state = { detail, assignments: [] as Assignment[], handovers: [] as { comment: string }[], eventReads: [] as string[] };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/auth/')) return route.fallback();
    if (path === `${BASE}objects/` && request.method() === 'POST') {
      const body = request.postDataJSON() as Assignment;
      state.assignments.push(body);
      state.detail.roster = state.detail.roster.map(person => {
        const change = body.rows.find(row => row.employeeId === person.employeeId);
        return change ? { ...person, visitObjectId: change.visitObjectId } : person;
      });
      state.detail.objects = state.detail.objects.map(object => ({ ...object,
        assigned: state.detail.roster.filter(person => person.visitObjectId === object.visitObjectId).length }));
      return route.fulfill({ json: state.detail });
    }
    if (path === `${BASE}hand-over/` && request.method() === 'POST') {
      const body = request.postDataJSON() as { comment: string };
      state.handovers.push(body);
      state.detail.handover = { at: '2026-10-16T05:30:00Z', by: 'ux-hq', comment: body.comment, shortfall: [] };
      return route.fulfill({ json: state.detail });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/operations/my-permissions/') return route.fulfill({ json: {
      permissions, global_permissions: [], roles: [{ code: 'OPS_STAFF', name: 'Штаб', scope_division_id: null, scope_division_name: null }],
    } });
    if (path === BASE) return route.fulfill({ json: state.detail });
    if (path === '/api/ops/security-events/forces/collections/') return route.fulfill({ json: { results: [{
      ...state.detail, requested: state.detail.totals.requested, allocating: state.detail.totals.allocating,
      sent: state.detail.totals.sent, shortage: state.detail.totals.shortage, departments: 0, isNew: true, overdueCount: 0,
    }] } });
    if (path === '/api/ops/security-events/' || path === `/api/ops/security-events/${EVENT}/`) {
      state.eventReads.push(path);
      return route.fulfill({ status: 403, json: { detail: 'Event reads are outside the forces fixture' } });
    }
    // The shell's optional catalogs are empty; every business write still goes through ux-fixture's guard.
    return route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } });
  });
  await signIn(page);
  return state;
}

test('collection rows show every site and the event title opens the collection with the keyboard', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto(LIST);
  const row = page.locator('[data-slot="force-collection-row"]');
  await expect(row).toContainText('Объекты ОМ: 2');
  await expect(row).toContainText('Резиденция');
  await expect(row).toContainText('Аэропорт');
  await expect(row.getByRole('button', { name: `Открыть сбор ${CODE}`, exact: true })).toContainText('Открыть сбор');
  const title = row.getByRole('button', { name: TITLE, exact: true });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('collection')).toBe(EVENT);
  expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-16');
  expect(state.eventReads).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('all site needs and capacities are visible before any employee lists arrive', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto(CARD);
  const plan = page.locator('section[aria-labelledby="collection-need-heading"]');
  await expect(plan).toContainText('Объекты ОМ: 2');
  const residence = page.getByTestId('collection-object-plan-visit-a');
  const airport = page.getByTestId('collection-object-plan-visit-b');
  await expect(residence).toContainText('Потребность 3');
  await expect(residence).toContainText('Назначено 0');
  await expect(residence).toContainText('Недобор 3');
  await expect(airport).toContainText('Потребность 2');
  await expect(airport).toContainText('Назначено 0');
  await expect(airport).toContainText('Недобор 2');
  const roster = page.locator('section[aria-labelledby="roster-objects-heading"]');
  await expect(roster).toContainText('Списки сотрудников ещё не получены');
  await expect(roster.getByRole('button', { name: 'Передать на расстановку', exact: true })).toBeDisabled();
  expect(state.eventReads).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('pending sites and unknown needs remain distinct from zero and from assignable targets', async ({ page, businessWrites }) => {
  const detail = collection();
  detail.stage = 'RECON';
  detail.need = 4;
  detail.gathered = 1;
  detail.roster = [member('employee-one', 'Новый сотрудник')];
  detail.visitObjects!.push({ visitObjectId: 'visit-pending', objectId: null, objectName: 'Гостиница', stage: 'RECON' });
  detail.objects[1].need = null;
  detail.needByObject[1].need = 0;
  detail.needByObject.push({ visitObjectId: '', objectName: 'без объекта посещения', need: 2, statusLabel: '', chiefName: '' });
  await prepare(page, detail);
  await page.goto(CARD);
  await expect(page.locator('section[aria-labelledby="collection-need-heading"]')).toContainText('Объекты ОМ: 3');
  const unknown = page.getByTestId('collection-object-plan-visit-b');
  await expect(unknown).toContainText('Потребность не размечена');
  await expect(unknown).not.toContainText('Потребность 0');
  await expect(unknown).not.toContainText('Недобор 0');
  const pending = page.getByTestId('collection-object-plan-visit-pending');
  await expect(pending).toContainText('Расчёт ещё не передан в сбор');
  await expect(pending).not.toContainText('Назначено 0');
  await expect(page.locator('[data-slot="need-by-object"]').filter({ hasText: 'без объекта посещения' })).toContainText('2');
  await expect(page.locator('[data-slot="need-total"]')).toHaveText('Итого 5');
  await expect(page.locator('[data-slot="need-mismatch"]')).toContainText('Штабу передано 4');
  await expect(page.locator('#roster-target option[value="visit-a"]')).toHaveCount(1);
  await expect(page.locator('#roster-target option[value="visit-b"]')).toHaveCount(1);
  await expect(page.locator('#roster-target option[value="visit-pending"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Передать на расстановку', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('same-name sites keep distinct allocation IDs and only the selected employee is sent', async ({ page, businessWrites }) => {
  const detail = collection();
  detail.visitObjects![1].objectName = 'Резиденция';
  detail.needByObject[1].objectName = 'Резиденция';
  detail.objects[1].objectName = 'Резиденция';
  detail.roster = [member('employee-one', 'Первый сотрудник'), member('employee-two', 'Второй сотрудник')];
  detail.gathered = 2;
  const state = await prepare(page, detail);
  await page.goto(CARD);
  const block = page.locator('section[aria-labelledby="roster-objects-heading"]');
  await block.getByRole('checkbox', { name: 'Отметить Второй сотрудник', exact: true }).check();
  await block.locator('#roster-target').selectOption('visit-b');
  await block.getByRole('button', { name: 'Отдать объекту: 1', exact: true }).click();
  await expect.poll(() => state.assignments).toEqual([{ rows: [{ employeeId: 'employee-two', visitObjectId: 'visit-b' }] }]);
  await expect(page.getByTestId('object-capacity-visit-a')).toContainText('назначено 0');
  await expect(page.getByTestId('object-capacity-visit-b')).toContainText('назначено 1');
  await expect(block.getByTestId('roster-employee-one')).toContainText('не распределён');
  await expect(block.getByTestId('roster-employee-two')).toContainText('Объект 2');
  expect(businessWrites).toEqual([]);
});

test('after handover a late top-up can be assigned while already assigned employees stay locked', async ({ page, businessWrites }) => {
  const detail = collection();
  detail.roster = [member('employee-old', 'Уже переданный', 'visit-a'), member('employee-new', 'Довыделенный')];
  detail.objects[0].assigned = 1;
  detail.gathered = 2;
  detail.handover = { at: '2026-10-16T04:00:00Z', by: 'ux-hq', comment: 'Первичная передача' };
  const state = await prepare(page, detail);
  await page.goto(CARD);
  const block = page.locator('section[aria-labelledby="roster-objects-heading"]');
  await expect(block.getByRole('checkbox', { name: 'Отметить Уже переданный', exact: true })).toBeDisabled();
  const topUp = block.getByRole('checkbox', { name: 'Отметить Довыделенный', exact: true });
  await expect(topUp).toBeEnabled();
  await topUp.check();
  await block.locator('#roster-target').selectOption('visit-b');
  await expect(block.locator('#roster-target option[value="__none__"]')).toHaveCount(0);
  await block.getByRole('button', { name: 'Отдать объекту: 1', exact: true }).click();
  await expect.poll(() => state.assignments).toEqual([{ rows: [{ employeeId: 'employee-new', visitObjectId: 'visit-b' }] }]);
  await expect(topUp).toBeDisabled();
  await expect(block.getByTestId('roster-employee-old')).toContainText('Резиденция');
  await expect(block.getByRole('button', { name: 'Передать на расстановку', exact: true })).toHaveCount(0);
  expect(state.handovers).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('a collection without visit objects hands its roster over without an impossible object assignment', async ({ page, businessWrites }) => {
  const detail = collection();
  detail.visitObjects = [];
  detail.objects = [];
  detail.needByObject = [];
  detail.roster = [member('employee-one', 'Общий состав')];
  detail.gathered = 1;
  const state = await prepare(page, detail);
  await page.goto(CARD);
  const block = page.locator('section[aria-labelledby="roster-objects-heading"]');
  const handover = block.getByRole('button', { name: 'Передать на расстановку', exact: true });
  await expect(handover).toBeEnabled();
  await expect(block.locator('#roster-target')).toHaveCount(0);
  await handover.click();
  await expect.poll(() => state.handovers).toEqual([{ comment: '' }]);
  await expect(block).toContainText('Передано на расстановку');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.assignments).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('site workspace links use visit IDs and require event viewing permission', async ({ page, businessWrites }) => {
  await prepare(page, collection(), ['forces.command', 'event.view']);
  await page.goto(CARD);
  const plan = page.locator('section[aria-labelledby="collection-need-heading"]');
  const residence = page.getByTestId('collection-object-plan-visit-a');
  const airport = page.getByTestId('collection-object-plan-visit-b');
  const first = new URL((await residence.getByRole('link', { name: /Резиденция/ }).getAttribute('href'))!, page.url());
  const second = new URL((await airport.getByRole('link', { name: /Аэропорт/ }).getAttribute('href'))!, page.url());
  expect(first.pathname).toBe(`/security-ops/events/${EVENT}/`);
  expect(first.searchParams.get('visit')).toBe('visit-a');
  expect(second.searchParams.get('visit')).toBe('visit-b');
  await expect(plan.getByRole('link', { name: 'Объекты мероприятия', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('force-only viewers see the full object plan without inaccessible event links or event requests', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto(CARD);
  const plan = page.locator('section[aria-labelledby="collection-need-heading"]');
  await expect(page.getByTestId('collection-object-plan-visit-a')).toBeVisible();
  await expect(page.getByTestId('collection-object-plan-visit-b')).toBeVisible();
  await expect(plan.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Открыть мероприятие', exact: true })).toHaveCount(0);
  expect(state.eventReads).toEqual([]);
  expect(businessWrites).toEqual([]);
});
