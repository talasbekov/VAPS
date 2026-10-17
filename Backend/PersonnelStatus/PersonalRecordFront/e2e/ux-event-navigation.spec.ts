import type { Locator, Page } from '@playwright/test';
import type { SecurityEvent, VisitObject } from '@/entities/security-event';
import { test, expect, signIn } from './ux-fixture';

const ID = '9007199254740993';
const CODE = 'ОМ-UX-КОРЕЯ';
const TITLE = 'Государственный визит делегации Кореи';
const DAY = '2026-10-16';
const counts = { posts: 0, need: 0, assigned: 0, replacements: 0, declines: 0, incidents: 0 };
function visit(id: string, objectId: string, objectName: string, position: number): VisitObject {
  return { id, objectId, objectName, position, photoUrl: null, passportBinding: null,
    protectedPersonId: null, protectedPersonName: '', visitDay: null, note: '', description: '',
    chiefEmployeeId: null, chiefName: '', reconChecklist: [], reconForceRequest: 0,
    canManageRecon: false, canManagePlacement: false, placementNeed: 0, placementAssigned: 0,
    deputies: [], closingComment: '', closureSummary: counts, statusLabel: 'Бюллетень',
    stage: 'BULLETIN', closedAt: null, approvalStatus: 'PENDING', approvalComment: '',
    approvalRoute: [], approvalRemarks: [], approvalStale: false, documentVersion: 0,
    documentStatus: 'DRAFT', documentVersions: [] };
}
function sample(): SecurityEvent {
  return { id: ID, code: CODE, title: TITLE, objectId: '1001', objectName: 'Резиденция',
    passportBinding: null, vehicles: [], visitObjects: [visit('9007199254740995', '1001', 'Резиденция', 0), visit('9007199254740997', '1002', 'Аэропорт', 1), visit('9007199254740999', '1005', 'Конгресс-центр', 2)],
    businessDate: DAY, businessDateEnd: DAY, kind: 'INTERNAL', eventTime: null,
    protectedPersonId: null, protectedPersonName: '', protectedPersons: [], location: 'Астана',
    countryId: null, countryName: '', cityId: null, cityName: '', address: '', chiefEmployeeId: null,
    chiefName: '', canEditBulletin: true, canManageVisitObjects: true, stage: 'BULLETIN',
    readinessPercent: 0, forceNeed: 0, conflictsCount: 0, ownerName: 'Учебный оператор',
    reconChecklist: [], reconSectorPosts: [], reconForceRequest: 0, reconForceRequestedAt: null,
    demandRows: [], demandApproved: false, forceRequests: [], forceAllocation: [], forceRoster: [],
    forceDemandTotal: 0, placementAssignments: [], approvalStatus: 'PENDING', approvalComment: '',
    approvalRoute: [], approvalRemarks: [], approvalStale: false, journalEntries: [],
    closureDirectionSummaries: [], closingComment: '', closureSummary: counts,
    acknowledgementDeadline: null, closedAt: null, createdAt: DAY + 'T08:00:00+05:00', updatedAt: DAY + 'T08:00:00+05:00' };
}
async function prepare(page: Page, permissions = ['event.view', 'event.manage', 'object.view']) {
  const state = { event: sample(), added: [] as string[] };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions, roles: [] } }));
  await page.route(url => url.pathname === '/api/ops/security-events/', route => route.fulfill({ json: { results: [state.event], count: 1, next: null, previous: null, owners: [] } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${ID}/`, route => route.fulfill({ json: state.event }));
  await page.route('**/api/ops/security-objects/**', route => route.fulfill({ status: 404, json: { detail: 'Каталог в этой проверке не используется' } }));
  const candidates = [{ id: '1003', code: 'UX-C', name: 'Гостиница', publishedVersionCount: 0 }, { id: '1004', code: 'UX-D', name: 'Дворец', publishedVersionCount: 1 }];
  await page.route(url => url.pathname === '/api/ops/security-events/bindable-objects/', route => route.fulfill({ json: { results: candidates } }));
  await page.route(url => url.pathname === `/api/ops/security-events/${ID}/visit-objects/`, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const objectId = route.request().postDataJSON().objectId;
    const found = candidates.find(item => item.id === objectId);
    if (!found) return route.fallback();
    state.added.push(objectId);
    state.event = { ...state.event, visitObjects: [...state.event.visitObjects, visit('visit-' + objectId, objectId, found.name, state.event.visitObjects.length)] };
    return route.fulfill({ json: state.event });
  });
  await signIn(page);
  return state;
}

async function expectInsidePageContent(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const content = await page.locator('main').evaluate(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: box.left + parseFloat(style.paddingLeft), right: Math.min(innerWidth, box.right - parseFloat(style.paddingRight)) };
  });
  const box = (await target.boundingBox())!;
  expect(box.x, 'the left edge must remain inside the page content without horizontal scrolling').toBeGreaterThanOrEqual(content.left - 1);
  expect(box.x + box.width, 'the right edge must remain inside the page content without horizontal scrolling').toBeLessThanOrEqual(content.right + 1);
}

async function expectRegistryWithoutHorizontalScroll(page: Page) {
  const container = page.locator('[data-slot="table-container"]').first();
  const dimensions = await container.evaluate(element => ({ left: element.scrollLeft, overflow: element.scrollWidth - element.clientWidth }));
  expect(dimensions.left, 'opening controls must not pan the event registry horizontally').toBe(0);
  expect(dimensions.overflow, 'all registry columns and site details must fit their container').toBeLessThanOrEqual(1);
}

test('the large event title opens its workspace with the keyboard and preserves the registry filter', async ({ page, businessWrites }) => {
  await prepare(page);
  const filter = new URLSearchParams({ search: 'Корея', stage: 'BULLETIN' }).toString();
  await page.goto('/security-ops/events/?' + filter);
  const main = page.getByRole('link', { name: `Открыть мероприятие ${CODE}: ${TITLE}`, exact: true });
  await expect(main).toBeVisible();
  await main.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/security-ops/events/' + ID);
  expect(new URL(page.url()).searchParams.get('back')).toBe(filter);
  await expect(page.locator('[data-slot="breadcrumbs"]').getByRole('link', { name: 'Реестр ОМ', exact: true })).toHaveAttribute('href', '/security-ops/events/?' + filter);
  expect(businessWrites).toEqual([]);
});

test('the collapsed event row summarizes three sites and expanded links select the correct site', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.goto('/security-ops/events/');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: `Открыть мероприятие ${CODE}: ${TITLE}`, exact: true }) });
  await expect(row).toContainText('Астана');
  await expect(row).toContainText('Объекты ОМ: 3');
  for (const name of ['Резиденция', 'Аэропорт', 'Конгресс-центр']) {
    await expect(row.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  expect((await row.boundingBox())!.height, 'site names must not turn the parent event into a tall list').toBeLessThanOrEqual(140);
  await row.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true }).click();
  const airport = page.getByRole('listitem').getByRole('link', { name: 'Аэропорт', exact: true });
  await expect(airport).toHaveAttribute('href', `/security-ops/events/${ID}/?visit=9007199254740997`);
  await airport.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-slot="visit-context"]').getByRole('button', { name: 'Аэропорт', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('visit')).toBe('9007199254740997');
  expect(new URL(page.url()).pathname).not.toContain('/objects/');
  expect(businessWrites).toEqual([]);
});

test('the event header exposes one explicit passport for the selected site instead of the legacy first site', async ({ page }) => {
  await prepare(page);
  await page.goto(`/security-ops/events/${ID}/?visit=9007199254740997`);
  const header = page.locator('[data-slot="event-workspace-header"]');
  await expect(header.getByRole('link', { name: 'Паспорт объекта Аэропорт', exact: true })).toHaveAttribute('href', '/security-ops/objects/1002/');
  await expect(header.locator('a[href="/security-ops/objects/1001/"]')).toHaveCount(0);
  await expect(header.locator('a[href^="/security-ops/objects/"]')).toHaveCount(1);
  await page.locator('[data-slot="visit-context"]').getByRole('button', { name: 'Резиденция', exact: true }).click();
  await expect(header.getByRole('link', { name: 'Паспорт объекта Резиденция', exact: true })).toHaveAttribute('href', '/security-ops/objects/1001/');
});

test('the dedicated large expand control reveals site details without navigating away', async ({ page }) => {
  await prepare(page);
  await page.goto('/security-ops/events/');
  const expand = page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true });
  await expect(expand).toBeVisible();
  const size = await expand.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44); expect(size?.height).toBeGreaterThanOrEqual(44);
  await expand.click();
  await expect(page.getByRole('button', { name: 'Свернуть объекты посещения ' + CODE, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Объекты посещения · 3', { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/security-ops/events/');
});

test('the desktop registry keeps long event titles and row actions inside its content width', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.event = { ...state.event, chiefEmployeeId: 'chief-parent', chiefName: 'ДемоПервыйСогласующий Т.', protectedPersonName: 'Hassan Al-Farsi' };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/security-ops/events/');
  const title = page.getByRole('link', { name: `Открыть мероприятие ${CODE}: ${TITLE}`, exact: true });
  await expect(title).toBeVisible();
  expect((await title.boundingBox())!.width, 'the event title needs a readable share of the available desktop width').toBeGreaterThanOrEqual(200);
  await expectInsidePageContent(page, title);
  await expectInsidePageContent(page, page.getByRole('button', { name: 'Действия ' + CODE, exact: true }));
  await expectRegistryWithoutHorizontalScroll(page);
  await page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true }).click();
  const sites = page.getByRole('listitem').filter({ has: page.locator('a[href*="?visit="]') });
  for (const control of await sites.getByRole('link').all()) await expectInsidePageContent(page, control);
  for (const control of await page.getByRole('button', { name: /^Подробности объекта / }).all()) await expectInsidePageContent(page, control);
  await page.getByRole('button', { name: 'Действия ' + CODE, exact: true }).click();
  await expectInsidePageContent(page, page.locator(`a[aria-label="Открыть этапы мероприятия ${CODE}"]`));
  await page.keyboard.press('Escape');
  await expectRegistryWithoutHorizontalScroll(page);
  expect(businessWrites).toEqual([]);
});

test('expanded sites stay compact and reveal infrequent editing only on request', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.event.visitObjects[0] = { ...state.event.visitObjects[0], placementNeed: 8, placementAssigned: 5,
    chiefEmployeeId: 'chief-1', chiefName: 'Сериков А.', description: 'Приём делегации и встреча с руководством.',
    deputies: [{ id: 'deputy-1', employeeId: 'employee-2', employeeName: 'Ибраев Б.', canEditPlacement: true, assignedBy: 'Учебный оператор', assignedAt: DAY + 'T08:00:00+05:00' }] };
  state.event.visitObjects[1] = { ...state.event.visitObjects[1], placementNeed: null, placementAssigned: null };
  state.event.visitObjects[2] = { ...state.event.visitObjects[2], placementAssigned: null };
  await page.goto('/security-ops/events/');
  await page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true }).click();
  const sites = page.getByRole('listitem').filter({ has: page.locator('a[href*="?visit="]') });
  await expect(sites).toHaveCount(3);
  for (const site of await sites.all()) {
    const height = (await site.boundingBox())!.height;
    expect(height, 'a site should read as one compact row before its details are requested').toBeLessThanOrEqual(90);
    expect(height).toBeGreaterThanOrEqual(60);
  }
  const residence = sites.filter({ has: page.getByRole('link', { name: 'Резиденция', exact: true }) });
  await expect(residence).toContainText('потребность 8, назначено 5');
  await expect(residence).toContainText('Сериков А.');
  await expect(residence.locator('[data-slot="visit-status-chip"]')).toHaveText('Бюллетень');
  const airport = sites.filter({ has: page.getByRole('link', { name: 'Аэропорт', exact: true }) });
  await expect(airport).toContainText('расчёт постов не размечен по объектам');
  await expect(airport).not.toContainText('потребность 0');
  const congress = sites.filter({ hasText: 'Конгресс-центр' });
  await expect(congress).toContainText('посты не рассчитаны');
  await expect(congress).toContainText('потребность 0, назначено неизвестно');
  await expect(residence.getByText(state.event.visitObjects[0].description, { exact: true })).toBeHidden();
  await expect(sites.getByRole('button', { name: /описание объекта|старшего объекта|замещающего|Снять объект/ })).toHaveCount(0);
  const more = residence.getByRole('button', { name: 'Подробности объекта Резиденция', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.focus(); await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(residence.getByText(state.event.visitObjects[0].description, { exact: true })).toBeVisible();
  await expect(residence.getByRole('button', { name: 'Заменить старшего объекта Резиденция', exact: true })).toBeVisible();
  await expect(residence.getByRole('button', { name: 'Добавить замещающего на объект Резиденция', exact: true })).toBeVisible();
  await expect(residence.getByRole('button', { name: 'Снять объект Резиденция с мероприятия', exact: true })).toBeVisible();
  await expect(residence).toContainText('Ибраев Б.');
  await expect(residence).toContainText('правит расстановку');
  await residence.getByRole('button', { name: 'Редактировать описание объекта Резиденция', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Объекты посещения', exact: true });
  await expect(dialog.getByLabel('Описание визита — Резиденция', { exact: true })).toHaveValue(state.event.visitObjects[0].description);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  expect((await residence.boundingBox())!.height).toBeLessThanOrEqual(90);
  expect(businessWrites).toEqual([]);
});

test('closed and read-only site details keep their editing actions unavailable', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.event.visitObjects[1] = { ...state.event.visitObjects[1], stage: 'CLOSED', statusLabel: 'Закрыт' };
  await page.goto('/security-ops/events/');
  await page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true }).click();
  const residence = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Резиденция', exact: true }) });
  const airport = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Аэропорт', exact: true }) });
  await residence.getByRole('button', { name: 'Подробности объекта Резиденция', exact: true }).click();
  await airport.getByRole('button', { name: 'Подробности объекта Аэропорт', exact: true }).click();
  await expect(residence.getByRole('button', { name: 'Назначить старшего объекта Резиденция', exact: true })).toBeVisible();
  await expect(airport.getByRole('button', { name: /описание объекта|старшего объекта|замещающего|Снять объект/ })).toHaveCount(0);
  await expect(airport.getByRole('link', { name: 'Аэропорт', exact: true })).toBeVisible();
  state.event = { ...state.event, canEditBulletin: false, canManageVisitObjects: false };
  await page.reload();
  await page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true }).click();
  await residence.getByRole('button', { name: 'Подробности объекта Резиденция', exact: true }).click();
  await expect(residence.getByRole('button', { name: /описание объекта|старшего объекта|замещающего|Снять объект/ })).toHaveCount(0);
  await expect(residence.getByText('паспорт не привязан', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('the compact registry and requested site details fit a 390px screen with usable controls', async ({ page, businessWrites }) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/security-ops/events/');
  await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth - body.clientWidth)).toBeLessThanOrEqual(1);
  const expand = page.getByRole('button', { name: 'Развернуть объекты посещения ' + CODE, exact: true });
  const expandSize = (await expand.boundingBox())!;
  expect(expandSize.width).toBeGreaterThanOrEqual(44); expect(expandSize.height).toBeGreaterThanOrEqual(44);
  await expand.click();
  const residence = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Резиденция', exact: true }) });
  await expectInsidePageContent(page, page.getByText('Объекты посещения · 3', { exact: true }));
  await expectInsidePageContent(page, residence);
  await expectRegistryWithoutHorizontalScroll(page);
  for (const control of [residence.getByRole('link', { name: 'Резиденция', exact: true }), residence.getByRole('button', { name: 'Подробности объекта Резиденция', exact: true })]) {
    await expect(control).toBeVisible();
    await expectInsidePageContent(page, control);
    const size = (await control.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44);
  }
  await residence.getByRole('button', { name: 'Подробности объекта Резиденция', exact: true }).click();
  await expectInsidePageContent(page, page.getByText('Объекты посещения · 3', { exact: true }));
  await expectInsidePageContent(page, residence);
  await expectRegistryWithoutHorizontalScroll(page);
  for (const control of await residence.getByRole('button').all()) {
    await expectInsidePageContent(page, control);
    const size = (await control.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44);
  }
  await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth - body.clientWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('sites can be added together from the event workspace without leaving the selected site', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  await page.goto(`/security-ops/events/${ID}/?visit=9007199254740997`);
  await page.getByRole('button', { name: 'Добавить объекты', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Гостиница/ }).check();
  await dialog.getByRole('checkbox', { name: /Дворец/ }).check();
  await dialog.getByRole('button', { name: 'Добавить (2)', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-slot="visit-context"]').getByRole('button', { name: 'Гостиница', exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="visit-context"]').getByRole('button', { name: 'Дворец', exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="visit-context"]').getByRole('button', { name: 'Аэропорт', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(state.added).toEqual(['1003', '1004']); expect(businessWrites).toEqual([]);
});

test('bulletin editing alone does not expose object management or passport access', async ({ page }) => {
  const state = await prepare(page, ['event.view']);
  state.event = { ...state.event, canEditBulletin: true, canManageVisitObjects: false };
  await page.goto(`/security-ops/events/${ID}/?visit=9007199254740997`);
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить объекты', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="event-workspace-header"] a[href^="/security-ops/objects/"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('body').evaluate(body => body.scrollWidth - body.clientWidth)).toBeLessThanOrEqual(1);
});
