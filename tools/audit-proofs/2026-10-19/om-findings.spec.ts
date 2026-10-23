import { test, expect, signIn, readEvent } from '../../../PersonnelStatus/PersonalRecordFront/e2e/ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent } from '../../../PersonnelStatus/PersonalRecordFront/entities/security-event';

// Opt-in negative proofs. All writes below are fulfilled in the browser;
// ux-fixture rejects every unhandled business write. No real event is edited.
test.use({ serviceWorkers: 'block' });

const ID = 'audit-om-synthetic';
const A = 'audit-visit-a', B = 'audit-visit-b';
const SECTOR = 'Audit common sector';
const BASE = `/api/ops/security-events/${ID}/`;

async function prepare(page: Page, request: APIRequestContext, stage: 'RECON' | 'PLACEMENT' = 'RECON') {
  // Read-only seed provides the complete current wire shape. Never print it.
  const source = await readEvent(request);
  const binding = (objectId: string, versionId: string) => ({
    objectId, objectName: `Audit object ${objectId}`, versionId, versionNumber: 1,
    effectiveFrom: '2026-01-01', boundAt: '2026-10-01T00:00:00Z',
  });
  const bindingA = binding('991001', '991011');
  const bindingB = binding('991002', '991012');
  const checklist = source.reconChecklist.map(row => ({ ...row, state: 'NORMAL' as const, done: true, result: 'MATCHES' as const, comment: '' }));
  const seedVisit = source.visitObjects[0];
  const visit = (id: string, passportBinding: ReturnType<typeof binding>) => ({
    ...seedVisit, id, objectId: passportBinding.objectId, objectName: passportBinding.objectName,
    stage, chiefEmployeeId: '991099', chiefName: 'Audit chief', deputies: [],
    protectedPersonId: null, protectedPersonName: '', photoUrl: null, note: '', description: '',
    passportBinding, canManageRecon: true, canManagePlacement: true,
    reconChecklist: structuredClone(checklist), approvalRemarks: [], approvalRoute: [],
    approvalComment: '', approvalStatus: 'NOT_SENT', documentStatus: 'DRAFT',
  });
  const seedPost = source.reconSectorPosts[0];
  const post = (id: string, visitObjectId: string, name: string) => ({
    ...seedPost, id, visitObjectId, sector: SECTOR, post: name, task: 'Audit saved task',
    need: 1, requirements: '', comment: '', sourceSectorId: null, sourcePostId: null,
    minRating: null, parentPostId: '', demandKindCode: 'PHYSICAL_SQUAD',
  });
  const event = {
    ...source, id: ID, title: 'Audit synthetic two-object OM', code: 'AUDIT-OM',
    stage, objectId: bindingA.objectId, objectName: bindingA.objectName,
    passportBinding: bindingA, businessDate: '2026-10-19',
    chiefEmployeeId: '991099', chiefName: 'Audit chief',
    ownerName: 'Audit owner', protectedPersonId: null, protectedPersonName: '', protectedPersons: [],
    location: 'Audit location', address: 'Audit address', countryName: '', cityName: '',
    visitObjects: [visit(A, bindingA), visit(B, bindingB)],
    reconChecklist: checklist,
    reconSectorPosts: [post('audit-pa', A, 'Audit post A'), post('audit-delete', A, 'Audit deleted post'), post('audit-pb', B, 'Audit post B')],
    forceRoster: [], placementAssignments: [], forceRequests: [], forceAllocation: [],
    approvalRemarks: [], approvalRoute: [], journalEntries: [], vehicles: [], demandRows: [],
    closureDirectionSummaries: [], closingComment: '', approvalComment: '',
  } as unknown as SecurityEvent;
  const state = { event, saves: [] as { visitObjectId: string; sectorPosts: SecurityEvent['reconSectorPosts'] }[], imports: 0 };

  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/operations/my-permissions/') return route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } });
    if (path === BASE && req.method() === 'GET') return route.fulfill({ json: state.event });
    if (path === `${BASE}recon/` && req.method() === 'PATCH') {
      const body = req.postDataJSON();
      state.saves.push(body);
      // Keep the failing payload readable without delegating it to real API.
      return route.fulfill({ json: state.event });
    }
    if (path === `${BASE}recon/import-from-passport/` && req.method() === 'POST') {
      state.imports++;
      return route.fulfill({ json: state.event });
    }
    if (path.startsWith('/api/ops/objects/99100') && req.method() === 'GET') {
      return route.fulfill({ json: {
        id: path.includes('991002') ? '991002' : '991001', name: 'Audit object', code: 'AUDIT',
        type: 'Audit', region: 'Audit', address: 'Audit', objectState: 'ACTIVE', passportState: 'GREEN',
        ownership: 'OWN', hasSecurityEvents: false, photoUrl: null, sectors: [], passportVersions: [],
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      } });
    }
    return route.fallback();
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${ID}/?visit=${A}`);
  const panel = page.getByRole('region', { name: stage === 'RECON' ? 'Рекогносцировка объекта' : 'Расстановка сил', exact: true });
  await expect(panel).toBeVisible();
  return { state, panel, bindingB };
}

test('OM audit: renaming sector A leaves same-name sector B unchanged', async ({ page, request, businessWrites }) => {
  const { state, panel } = await prepare(page, request);
  await panel.getByRole('textbox', { name: `Название сектора: ${SECTOR}`, exact: true }).fill('Audit renamed A');
  await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  const body = state.saves[0];
  expect(body.visitObjectId).toBe(A);
  expect(body.sectorPosts.find(row => row.id === 'audit-pa')?.sector).toBe('Audit renamed A');
  expect(body.sectorPosts.find(row => row.id === 'audit-pb')?.sector, 'Hidden B must retain its own sector').toBe(SECTOR);
  expect(businessWrites).toEqual([]);
});

test('OM audit: deleting sector A retains all rows of same-name sector B', async ({ page, request, businessWrites }) => {
  const { state, panel } = await prepare(page, request);
  await panel.getByRole('button', { name: `Удалить сектор ${SECTOR}`, exact: true }).click();
  await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  const body = state.saves[0];
  expect(body.visitObjectId).toBe(A);
  expect(body.sectorPosts.filter(row => row.visitObjectId === A)).toEqual([]);
  expect(body.sectorPosts.filter(row => row.visitObjectId === B).map(row => row.id), 'Hidden B must survive deletion of A').toEqual(['audit-pb']);
  expect(businessWrites).toEqual([]);
});

test('OM audit: importing preserves changed and deleted saved post drafts', async ({ page, request, businessWrites }) => {
  const { state, panel } = await prepare(page, request);
  await panel.getByRole('spinbutton', { name: 'Потребность', exact: true }).first().fill('99');
  await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Audit unsaved task');
  // The visible row order is synthetic and fixed: post A, deleted post.
  await panel.getByRole('button', { name: 'Удалить пост', exact: true }).nth(1).click();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `${BASE}recon/import-from-passport/` && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Импорт из паспорта', exact: true }).click();
  await response;
  await expect.poll(() => state.imports).toBe(1);
  await expect(panel.getByRole('button', { name: 'Импорт из паспорта', exact: true })).toBeEnabled();
  // Soft assertions expose both loss paths in one deterministic import.
  await expect.soft(panel.getByRole('spinbutton', { name: 'Потребность', exact: true }).first()).toHaveValue('99');
  await expect.soft(panel.getByRole('textbox', { name: 'Задача', exact: true }).first()).toHaveValue('Audit unsaved task');
  await expect.soft(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveCount(1);
  expect(businessWrites).toEqual([]);
});

test('OM audit: selected object B passport link uses B binding', async ({ page, request, businessWrites }) => {
  const { panel, bindingB } = await prepare(page, request, 'PLACEMENT');
  await panel.getByRole('combobox', { name: 'Объект посещения', exact: true }).selectOption(B);
  await expect(panel.getByRole('region', { name: 'Выбранный пост', exact: true })).toContainText('Audit post B');
  const link = panel.getByRole('link', { name: 'Паспорт поста →', exact: true });
  await expect(link).toHaveAttribute('href', `/security-ops/objects/${bindingB.objectId}/passports/${bindingB.versionId}/`);
  expect(businessWrites).toEqual([]);
});
