import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const object = {
  id: 'roster-scope-fixture', name: 'Учебный объект областей наряда', code: 'SCOPE', type: 'BUILDING', region: '', address: '',
  objectState: 'ACTIVE', passportState: 'RED', ownership: 'OWN', hasSecurityEvents: false, photoUrl: null,
  sectors: [], passportVersions: [], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z',
};
const rows = [
  { status_id: 701, employee_id: 1, employee_name: 'Учебный сотрудник области А', rank_name: '', position_name: '', department_name: 'Учебный департамент А' },
  { status_id: 702, employee_id: 2, employee_name: 'Учебный сотрудник области Б', rank_name: '', position_name: '', department_name: 'Учебный департамент Б' },
].map(row => ({ ...row, service_profile: null,
  placement: { kind: 'GROUP', object_id: object.id, object_name: object.name, post_id: null, post_name: null,
    sector_name: null, group_id: 'duty-group-1', group_name: 'Учебная группа' },
  start_date: '2026-10-28', end_date: '2026-10-29', assigned_at: '2026-10-28T00:00:00Z',
}));

async function prepare(page: Page) {
  const state = { scopes: [1, 2], permissions: ['object.view', 'status.view'], permissionReads: 0,
    holdOld: false, holdCurrent: false, heldOld: 0, heldCurrent: 0, oldDelivered: false };
  let releaseOld!: () => void, releaseCurrent!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  const currentGate = new Promise<void>(resolve => { releaseCurrent = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => {
    state.permissionReads++;
    return route.fulfill({ json: { permissions: state.permissions, global_permissions: [],
      roles: state.scopes.map(scope => ({ code: 'ROSTER_READER', name: 'Учебный читатель наряда', scope_division_id: scope, scope_division_name: String(scope) })) } });
  });
  await page.route('**/api/ops/objects/**', route => route.fulfill({ json:
    new URL(route.request().url()).pathname === '/api/ops/objects/' ? {
      results: [object], freshness: [], unavailableKpi: [], kpi: { total: 1 },
      freshnessPolicy: { version: 'fp-v1', verificationIntervalDays: 120, dueSoonPercent: 25 },
    } : object }));
  await page.route('**/api/statuses/statuses/duty-assignments/**', async route => {
    const scopes = [...state.scopes];
    const old = scopes.includes(2);
    if (old && state.holdOld) { state.heldOld++; await oldGate; }
    if (!old && state.holdCurrent) { state.heldCurrent++; await currentGate; }
    await route.fulfill({ json: { results: old ? rows : [rows[0]] } });
    if (old && state.holdOld) state.oldDelivered = true;
  });
  await signIn(page);
  await page.goto(`/security-ops/objects/${object.id}/?dutyDate=2026-10-28`);
  for (const row of rows) await expect(page.getByText(row.employee_name, { exact: true })).toBeVisible();
  return { state, releaseOld, releaseCurrent };
}

async function refreshRights(page: Page) {
  const reply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/my-permissions/' && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await (await reply).finished();
}

test('a narrowed roster scope hides cached employees before new data and ignores a late old-scope response', async ({ page, businessWrites }) => {
  const { state, releaseOld, releaseCurrent } = await prepare(page);
  try {
    state.holdOld = true; state.holdCurrent = true;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.heldOld).toBeGreaterThan(0);
    state.scopes = [1];
    await refreshRights(page);
    await expect(page.getByText(rows[1].employee_name, { exact: true })).toHaveCount(0);
    await expect.poll(() => state.heldCurrent).toBeGreaterThan(0);
    releaseOld();
    await expect.poll(() => state.oldDelivered).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByText(rows[1].employee_name, { exact: true })).toHaveCount(0);
    releaseCurrent();
    await expect(page.getByText(rows[0].employee_name, { exact: true })).toBeVisible();
    await expect(page.getByText(rows[1].employee_name, { exact: true })).toHaveCount(0);
    expect(businessWrites).toEqual([]);
  } finally { releaseOld(); releaseCurrent(); }
});

test('restoring roster permission in a narrower scope waits for an authorized roster', async ({ page, businessWrites }) => {
  const { state, releaseOld, releaseCurrent } = await prepare(page);
  try {
    state.permissions = ['object.view']; state.scopes = [1];
    await refreshRights(page);
    await expect(page.getByText('Для просмотра состава нужен доступ к статусам сотрудников.', { exact: true })).toBeVisible();
    for (const row of rows) await expect(page.getByText(row.employee_name, { exact: true })).toHaveCount(0);
    state.holdCurrent = true; state.permissions = ['object.view', 'status.view'];
    await refreshRights(page);
    await expect.poll(() => state.heldCurrent).toBeGreaterThan(0);
    for (const row of rows) await expect(page.getByText(row.employee_name, { exact: true })).toHaveCount(0);
    releaseCurrent();
    await expect(page.getByText(rows[0].employee_name, { exact: true })).toBeVisible();
    await expect(page.getByText(rows[1].employee_name, { exact: true })).toHaveCount(0);
    expect(businessWrites).toEqual([]);
  } finally { releaseOld(); releaseCurrent(); }
});
