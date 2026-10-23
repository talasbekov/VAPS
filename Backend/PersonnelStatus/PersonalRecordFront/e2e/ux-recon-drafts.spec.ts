import { test, expect, signIn, readEvent } from './ux-fixture';
import type { Page, APIRequestContext } from '@playwright/test';
import type { SecurityEvent, UpdateReconRequest } from '@/entities/security-event';

const ID = 'ux-recon-drafts', A = 'draft-visit-a', B = 'draft-visit-b';
const SECTOR = 'Общий сектор';
const BASE = `/api/ops/security-events/${ID}/`;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function prepare(page: Page, request: APIRequestContext) {
  const source = await readEvent(request);
  const checklist = source.reconChecklist.map(row => ({ ...row, state: 'NORMAL' as const, done: true, result: 'MATCHES' as const, comment: '' }));
  const visit = (id: string) => ({ ...source.visitObjects[0], id, objectId: id === A ? '991001' : '991002',
    objectName: id === A ? 'Объект А' : 'Объект Б', stage: 'RECON' as const, chiefEmployeeId: '991099',
    canManageRecon: true, canManagePlacement: true, reconChecklist: structuredClone(checklist),
    approvalRemarks: [], approvalRoute: [], approvalStatus: 'NOT_SENT' as const, documentStatus: 'DRAFT' as const,
    passportBinding: { objectId: id === A ? '991001' : '991002', objectName: 'Объект', versionId: id === A ? '991011' : '991012',
      versionNumber: 1, effectiveFrom: '2026-01-01', boundAt: '2026-10-01T00:00:00Z' } });
  const post = (id: string, visitObjectId: string, name: string) => ({ ...source.reconSectorPosts[0], id,
    visitObjectId, sector: SECTOR, post: name, task: 'Сохранённая задача', need: 1, comment: '',
    sourceSectorId: null, sourcePostId: null, parentPostId: '', demandKindCode: 'PHYSICAL_SQUAD' });
  const event = { ...source, id: ID, title: 'Проверка черновиков рекогносцировки', stage: 'RECON',
    objectId: '991001', passportBinding: visit(A).passportBinding, visitObjects: [visit(A), visit(B)],
    reconChecklist: checklist, reconSectorPosts: [post('post-a', A, 'Пост А'), post('post-delete', A, 'Удаляемый пост'), post('post-b', B, 'Пост Б')],
    forceRoster: [], placementAssignments: [], forceRequests: [], forceAllocation: [],
    approvalRemarks: [], approvalRoute: [], journalEntries: [], demandRows: [] } as unknown as SecurityEvent;
  const state = { event, saves: [] as UpdateReconRequest[], saveGate: null as ReturnType<typeof gate> | null,
    failSave: false, imports: 0, importGate: null as ReturnType<typeof gate> | null,
    completions: [] as { visitObjectId?: string }[] };
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/operations/my-permissions/') return route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } });
    if (path === BASE && req.method() === 'GET') return route.fulfill({ json: state.event });
    if (path === `${BASE}recon/` && req.method() === 'PATCH') {
      const body = req.postDataJSON() as UpdateReconRequest;
      state.saves.push(body);
      const response = structuredClone(state.event);
      response.reconSectorPosts = body.sectorPosts!.map((row, index) => ({ ...row,
        id: row.id.startsWith('recon-local-') ? `server-post-${state.saves.length}-${index}` : row.id }));
      const target = response.visitObjects.find(visit => visit.id === body.visitObjectId)!;
      target.reconChecklist = body.checklist!;
      if (state.saveGate) await state.saveGate.promise;
      if (state.failSave) return route.fulfill({ status: 400, json: { detail: 'Invalid draft', errors: { sectorPosts: ['Проверка отказа'] } } });
      state.event = response;
      return route.fulfill({ json: response });
    }
    if (path === `${BASE}recon/import-from-passport/` && req.method() === 'POST') {
      state.imports++;
      if (state.importGate) await state.importGate.promise;
      state.event = { ...state.event, reconSectorPosts: [...state.event.reconSectorPosts,
        post(`import-${state.imports}`, req.postDataJSON().visitObjectId, 'Импортированный пост')] };
      return route.fulfill({ json: state.event });
    }
    if (path === `${BASE}recon/complete/` && req.method() === 'POST') {
      state.completions.push(req.postDataJSON());
      return route.fulfill({ json: state.event });
    }
    return route.fallback();
  });
  await signIn(page);
  await page.goto(`/security-ops/events/${ID}/?visit=${A}`);
  const panel = page.getByRole('region', { name: 'Рекогносцировка объекта', exact: true });
  await expect(panel).toBeVisible();
  const choose = async (id: string) => {
    await panel.getByRole('combobox', { name: 'Объект посещения', exact: true }).selectOption(id);
    await expect(panel.getByRole('textbox', { name: 'Пост', exact: true }).first()).toHaveValue(id === A ? 'Пост А' : 'Пост Б');
  };
  return { state, panel, choose };
}

for (const operation of ['rename', 'remove'] as const) {
  test(`sector ${operation} changes only the selected visit in the full wire payload`, async ({ page, request, businessWrites }) => {
    const { panel, state } = await prepare(page, request);
    if (operation === 'rename') await panel.getByRole('textbox', { name: `Название сектора: ${SECTOR}`, exact: true }).fill('Сектор только А');
    else await panel.getByRole('button', { name: `Удалить сектор ${SECTOR}`, exact: true }).click();
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    const body = state.saves[0];
    expect(body.visitObjectId).toBe(A);
    expect(body.sectorPosts!.filter(row => row.visitObjectId === A).map(row => row.sector))
      .toEqual(operation === 'rename' ? ['Сектор только А', 'Сектор только А'] : []);
    expect(body.sectorPosts!.filter(row => row.visitObjectId === B).map(row => [row.id, row.sector]))
      .toEqual([['post-b', 'Общий сектор']]);
    expect(businessWrites).toEqual([]);
  });
}

test('same-name sectors keep their collapse and empty-sector state within each visit', async ({ page, request, businessWrites }) => {
  const { panel } = await prepare(page, request);
  await panel.getByRole('button', { name: `Сектор ${SECTOR}`, exact: true }).click();
  await panel.getByRole('button', { name: '+ Добавить сектор', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Объект посещения', exact: true }).selectOption(B);
  await expect(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveValue('Пост Б');
  await expect(panel.getByRole('textbox', { name: 'Название сектора: Сектор 2', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '+ Добавить сектор', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Название сектора: Сектор 2', exact: true }).fill('Пустой сектор Б');
  await panel.getByRole('combobox', { name: 'Объект посещения', exact: true }).selectOption(A);
  await expect(panel.getByRole('button', { name: `Сектор ${SECTOR}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('textbox', { name: 'Название сектора: Сектор 2', exact: true })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Название сектора: Пустой сектор Б', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('import retains changed saved rows, deletions and new rows while adding passport posts', async ({ page, request, businessWrites }) => {
  const { panel, state } = await prepare(page, request);
  await panel.getByRole('spinbutton', { name: 'Потребность', exact: true }).first().fill('99');
  await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Несохранённая задача');
  await panel.getByRole('button', { name: 'Удалить пост', exact: true }).nth(1).click();
  await panel.getByRole('button', { name: '+ Пост', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Пост', exact: true }).last().fill('Ручной пост');
  await panel.getByRole('button', { name: 'Импорт из паспорта', exact: true }).click();
  await expect.poll(() => state.imports).toBe(1);
  await expect.poll(() => panel.getByRole('textbox', { name: 'Пост', exact: true }).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)))
    .toEqual(['Пост А', 'Ручной пост', 'Импортированный пост']);
  await expect(panel.getByRole('spinbutton', { name: 'Потребность', exact: true }).first()).toHaveValue('99');
  await expect(panel.getByRole('textbox', { name: 'Задача', exact: true }).first()).toHaveValue('Несохранённая задача');
  expect(businessWrites).toEqual([]);
});

test('saving A sends confirmed B rows and preserves the unsaved B draft after the response', async ({ page, request, businessWrites }) => {
  const { panel, state, choose } = await prepare(page, request);
  await choose(B);
  await panel.getByRole('textbox', { name: 'Задача', exact: true }).fill('Черновик Б');
  await choose(A);
  await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Правка А');
  await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].sectorPosts!.find(row => row.id === 'post-b')!.task).toBe('Сохранённая задача');
  await choose(B);
  await expect(panel.getByRole('textbox', { name: 'Задача', exact: true })).toHaveValue('Черновик Б');
  await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[1].visitObjectId).toBe(B);
  expect(state.saves[1].sectorPosts!.find(row => row.id === 'post-a')!.task).toBe('Правка А');
  expect(businessWrites).toEqual([]);
});

test('late save A retains later edits and deletions on A plus new edits on B', async ({ page, request, businessWrites }) => {
  const { panel, state, choose } = await prepare(page, request);
  state.saveGate = gate();
  try {
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Отправленная правка А');
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Поздняя правка А');
    await panel.getByRole('button', { name: 'Удалить пост', exact: true }).nth(1).click();
    await choose(B);
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).fill('Поздняя правка Б');
    state.saveGate.release();
    await expect(panel.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeEnabled();
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true })).toHaveValue('Поздняя правка Б');
    await choose(A);
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true })).toHaveValue('Поздняя правка А');
    await expect(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveCount(1);
  } finally { state.saveGate.release(); }
  expect(businessWrites).toEqual([]);
});

test('late failed save keeps the drafts for both visits available for retry', async ({ page, request, businessWrites }) => {
  const { panel, state, choose } = await prepare(page, request);
  state.saveGate = gate(); state.failSave = true;
  try {
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Черновик А до отказа');
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    await choose(B);
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).fill('Черновик Б до отказа');
    state.saveGate.release();
    await expect(panel.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeEnabled();
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true })).toHaveValue('Черновик Б до отказа');
    await choose(A);
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true }).first()).toHaveValue('Черновик А до отказа');
  } finally { state.saveGate.release(); }
  expect(businessWrites).toEqual([]);
});

test('new post receives its saved ID while later edits remain dirty and save without duplication', async ({ page, request, businessWrites }) => {
  const { panel, state } = await prepare(page, request);
  await panel.getByRole('button', { name: '+ Пост', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Пост', exact: true }).last().fill('Новый пост');
  state.saveGate = gate();
  try {
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).last().fill('Поздняя задача нового поста');
    state.saveGate.release();
    await expect(panel.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeEnabled();
    await expect(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveCount(3);
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true }).last()).toHaveValue('Поздняя задача нового поста');
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(2);
    expect(state.saves[1].sectorPosts!.filter(row => row.post === 'Новый пост').map(row => [row.id, row.task]))
      .toEqual([['server-post-1-2', 'Поздняя задача нового поста']]);
    await expect(panel.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeDisabled();
  } finally { state.saveGate.release(); }
  expect(businessWrites).toEqual([]);
});

test('completion waits for pending import and later edits to be saved before confirming the current calculation', async ({ page, request, businessWrites }) => {
  const { panel, state } = await prepare(page, request);
  const complete = panel.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true });
  await expect(complete).toBeEnabled();
  state.importGate = gate();
  try {
    await panel.getByRole('button', { name: 'Импорт из паспорта', exact: true }).click();
    await expect.poll(() => state.imports).toBe(1);
    await expect(complete).toBeDisabled();
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Правка во время импорта');
    state.importGate.release();
    await expect(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveCount(3);
    await expect(panel.getByRole('textbox', { name: 'Задача', exact: true }).first()).toHaveValue('Правка во время импорта');
    await expect(complete).toBeDisabled();
    expect(state.completions).toEqual([]);
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect(complete).toBeEnabled();
    await complete.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('физнаряд 3');
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => state.completions).toEqual([{ visitObjectId: A }]);
  } finally { state.importGate.release(); }
  expect(businessWrites).toEqual([]);
});

test('completion of clean B waits for the pending save of A', async ({ page, request, businessWrites }) => {
  const { panel, state, choose } = await prepare(page, request);
  state.saveGate = gate();
  try {
    await panel.getByRole('textbox', { name: 'Задача', exact: true }).first().fill('Правка А');
    await panel.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    await choose(B);
    const complete = panel.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true });
    await expect(complete).toBeDisabled();
    expect(state.completions).toEqual([]);
    state.saveGate.release();
    await expect(complete).toBeEnabled();
    await complete.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => state.completions).toEqual([{ visitObjectId: B }]);
  } finally { state.saveGate.release(); }
  expect(businessWrites).toEqual([]);
});

test('completion confirmation expires when browser navigation changes the selected visit', async ({ page, request, businessWrites }) => {
  const { panel, state } = await prepare(page, request);
  await panel.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('физнаряд 2');
  await page.evaluate(visitId => {
    const url = new URL(window.location.href);
    url.searchParams.set('visit', visitId);
    window.history.pushState(null, '', url.href);
  }, B);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: 'Пост', exact: true })).toHaveValue('Пост Б');
  expect(state.completions).toEqual([]);
  await panel.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('физнаряд 1');
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => state.completions).toEqual([{ visitObjectId: B }]);
  expect(businessWrites).toEqual([]);
});
