import { test, expect, signIn, readEvent } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent } from '@/entities/security-event';

const objects = [
  { id: 'ux-add-a', code: 'UX-ADD-A', name: 'Объект выбора А', publishedVersionCount: 1 },
  { id: 'ux-add-b', code: 'UX-ADD-B', name: 'Объект выбора Б', publishedVersionCount: 0 },
];
async function prepare(page: Page, request: APIRequestContext, catalogFailure = 0) {
  const source = await readEvent(request);
  const event: SecurityEvent = { ...source, stage: 'BULLETIN', code: 'UX-ADD-OBJECT', canManageVisitObjects: true, canEditBulletin: true };
  const state = { event, catalogFailure, failedReads: 0, reads: 0, hold: false, release: () => {}, responses: 0, writes: [] as string[], failures: [] as string[] };
  const waiting = new Promise<void>(resolve => { state.release = resolve; });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }));
  await page.route(url => url.pathname === '/api/ops/security-events/', route => route.fulfill({ json: { results: [state.event], count: 1, next: null, previous: null, owners: [] } }));
  await page.route(url => url.pathname === '/api/ops/security-events/bindable-objects/', route => {
    state.reads++;
    if (state.catalogFailure) { state.failedReads++; return route.fulfill({ status: state.catalogFailure, json: { detail: 'Отказ чтения объектов' } }); }
    return route.fulfill({ json: { results: objects } });
  });
  await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/visit-objects/`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const { objectId } = route.request().postDataJSON(); if (!objects.some(row => row.id === objectId)) return route.fallback();
    state.writes.push(objectId); if (state.hold) await waiting; state.responses++;
    if (state.failures.includes(objectId)) return route.fulfill({ status: 503, json: { detail: 'Объект не добавлен' } });
    const object = objects.find(row => row.id === objectId)!;
    state.event = { ...state.event, visitObjects: [...state.event.visitObjects, { ...source.visitObjects[0], id: 'visit-' + objectId, objectId, objectName: object.name }] };
    return route.fulfill({ json: state.event });
  });
  await page.clock.install(); await signIn(page); await page.goto('/security-ops/events/');
  await page.getByRole('button', { name: 'Действия ' + event.code, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Добавить объекты посещения ' + event.code, exact: true }).click();
  return state;
}
async function reconnect(page: Page) {
  await page.clock.fastForward(61000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('a visit object catalog failure retries in the open dialog without losing its search', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request, 503); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByLabel('Поиск объекта', { exact: true }).fill('Объект выбора А');
  const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible();
  state.catalogFailure = 0; await retry.click(); await expect(dialog.getByRole('checkbox', { name: /Объект выбора А/ })).toBeVisible();
  await expect(dialog.getByLabel('Поиск объекта', { exact: true })).toHaveValue('Объект выбора А'); expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('an old visit save cannot close a newly opened object selection', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); let dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора А/ }).check(); state.hold = true; await dialog.getByRole('button', { name: 'Добавить (1)', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1); await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить объект посещения в мероприятие ' + state.event.code, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true }); await dialog.getByRole('checkbox', { name: /Объект выбора Б/ }).check();
  const response = page.waitForResponse(row => row.request().method() === 'POST' && new URL(row.url()).pathname.endsWith('/visit-objects/')); state.release(); await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('checkbox', { name: /Объект выбора Б/ })).toBeChecked(); expect(state.writes).toEqual(['ux-add-a']); expect(businessWrites).toEqual([]);
});

test('a cached visit object catalog failure preserves checked objects and search until inline recovery', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  const checkbox = dialog.getByRole('checkbox', { name: /Объект выбора А/ }); await checkbox.check(); await dialog.getByLabel('Поиск объекта', { exact: true }).fill('Объект выбора');
  state.catalogFailure = 503; await reconnect(page); const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible();
  await expect(checkbox).toBeChecked(); await expect(checkbox).toBeDisabled(); await expect(dialog.getByRole('button', { name: 'Добавить (1)', exact: true })).toBeDisabled();
  state.catalogFailure = 0; await retry.click(); await expect(checkbox).toBeEnabled(); await expect(checkbox).toBeChecked();
  await expect(dialog.getByLabel('Поиск объекта', { exact: true })).toHaveValue('Объект выбора'); expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a partial visit object batch retries only failed IDs and retains the failed selection', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора А/ }).check(); await dialog.getByRole('checkbox', { name: /Объект выбора Б/ }).check(); state.failures = ['ux-add-b'];
  await dialog.getByRole('button', { name: 'Добавить (2)', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Добавить (1)', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: /Объект выбора А/ })).toBeDisabled(); await expect(dialog.getByRole('checkbox', { name: /Объект выбора А/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Объект выбора Б/ })).toBeChecked(); expect(state.writes).toEqual(['ux-add-a', 'ux-add-b']);
  state.failures = []; await dialog.getByRole('button', { name: 'Добавить (1)', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.writes).toEqual(['ux-add-a', 'ux-add-b', 'ux-add-b']); expect(businessWrites).toEqual([]);
});

test('losing visit object capability closes its selection and a returned capability does not reopen it', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора Б/ }).check(); state.event = { ...state.event, canManageVisitObjects: false }; await reconnect(page);
  await expect(dialog).toHaveCount(0); state.event = { ...state.event, canManageVisitObjects: true }; await reconnect(page);
  const open = page.getByRole('button', { name: 'Добавить объект посещения в мероприятие ' + state.event.code, exact: true }); await expect(open).toBeVisible();
  await expect(dialog).toHaveCount(0); await open.click(); await expect(dialog.getByRole('checkbox', { name: /Объект выбора Б/ })).not.toBeChecked();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a temporary visit catalog failure does not lose the confirmed completion of an already submitted batch', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора А/ }).check(); state.hold = true; await dialog.getByRole('button', { name: 'Добавить (1)', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1); state.catalogFailure = 503; await reconnect(page);
  const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible(); state.catalogFailure = 0; await retry.click();
  await expect(dialog.getByRole('alert')).toHaveCount(0); state.release(); await expect(dialog).toHaveCount(0); expect(state.writes).toEqual(['ux-add-a']); expect(businessWrites).toEqual([]);
});

test('a hard visit catalog denial hides cached choices and recovery starts with no old checked objects', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора А/ }).check(); state.catalogFailure = 403; await reconnect(page);
  const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible(); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  state.catalogFailure = 0; await retry.click(); await expect(dialog.getByRole('checkbox', { name: /Объект выбора А/ })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Объект выбора А/ })).not.toBeChecked(); await expect(dialog.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('a pending visit batch locks its draft and continues its original snapshot after explicit window closure', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await dialog.getByRole('checkbox', { name: /Объект выбора А/ }).check(); await dialog.getByRole('checkbox', { name: /Объект выбора Б/ }).check(); state.hold = true;
  await dialog.getByRole('button', { name: 'Добавить (2)', exact: true }).click(); await expect.poll(() => state.writes.length).toBe(1);
  await expect(dialog.getByLabel('Поиск объекта', { exact: true })).toBeDisabled(); for (const checkbox of await dialog.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled();
  await expect(dialog).toContainText('Закрытие окна не отменяет начатое добавление.'); await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); state.release();
  await expect.poll(() => state.responses).toBe(2); expect(state.writes).toEqual(['ux-add-a', 'ux-add-b']); await expect(dialog).toHaveCount(0); expect(businessWrites).toEqual([]);
});

test('a denied visit catalog remains hidden after retry changes its error to a temporary failure', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2); state.catalogFailure = 403; await reconnect(page);
  const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeVisible(); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  const before = state.failedReads; state.catalogFailure = 503; await retry.click(); await expect.poll(() => state.failedReads).toBeGreaterThan(before);
  await expect(retry).toBeEnabled(); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  state.catalogFailure = 0; await retry.click(); await expect(dialog.getByRole('checkbox')).toHaveCount(2); expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});

test('reopening a denied visit catalog cannot disclose its old cache while the new read is failing', async ({ page, request, businessWrites }) => {
  const state = await prepare(page, request); const dialog = page.getByRole('dialog', { name: 'Добавить объекты посещения', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2); state.catalogFailure = 403; await reconnect(page);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0); state.catalogFailure = 503;
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить объект посещения в мероприятие ' + state.event.code, exact: true }).click();
  const retry = dialog.getByRole('button', { name: 'Повторить', exact: true }); await expect(retry).toBeEnabled(); await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  state.catalogFailure = 0; await retry.click(); await expect(dialog.getByRole('checkbox')).toHaveCount(2); expect(state.writes).toEqual([]); expect(businessWrites).toEqual([]);
});
