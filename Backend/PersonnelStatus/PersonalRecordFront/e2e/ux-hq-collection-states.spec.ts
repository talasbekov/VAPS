import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { ForceAllocationRow, ForceCollectionRow } from '@/entities/security-event';
import type { ForceCollectionWithObjects } from '@/hooks/use-force-collections';

const DATE = '2026-10-23';
const LIST_URL = `/employees/?view=forces&tab=collections&businessDate=${DATE}&dateFrom=2026-10-22&dateTo=2026-10-24`;
const CARD_URL = `${LIST_URL}&collection=901`;
const permissions = ['forces.command', 'event.view', 'status.view'];
const row: ForceCollectionRow = {
  eventId: '901', code: 'ОМ-901', title: 'Сбор на встречу делегации', businessDate: DATE,
  eventTime: '10:00', location: 'Учебный объект', stage: 'FORCES', need: 9, requested: 9,
  allocating: 2, sent: 2, shortage: 7, allocated: 9, gathered: 2, departments: 3,
  boardStatus: { code: 'ANSWERED', label: 'Ответы получены 2 из 3 департаментов', answered: 2, total: 3 },
  urgent: false, isNew: false, collectionStatus: 'IN_PROGRESS', overdueCount: 0,
  visitObjects: [
    { visitObjectId: '7', objectId: '1', objectName: 'Первый объект', stage: 'FORCES' },
    { visitObjectId: '8', objectId: '2', objectName: 'Нулевая потребность', stage: 'FORCES' },
    { visitObjectId: '9', objectId: '3', objectName: 'Неразмеченный объект', stage: 'FORCES' },
  ],
};
function allocation(id: string, departmentId: string, departmentName: string, allocating: number | null): ForceAllocationRow {
  return {
    id, departmentId, departmentName, need: 3, allocating, sent: 0, status: 'DRAFT',
    comment: '', answerComment: '', decisionComment: '', responsibleName: 'Ответственный департамента',
    sentAt: '2026-10-22T04:00:00Z', dueAt: '2026-10-22T18:00:00Z', notifiedAt: null,
    submittedAt: null, decidedAt: null, directorates: [], members: [], groupDemands: [], history: [],
  };
}
function detail(): ForceCollectionWithObjects {
  return {
    ...row, canCollect: true, remaining: 7,
    totals: { need: 9, requested: 9, allocating: 2, sent: 2, shortage: 7 },
    needByObject: [
      { visitObjectId: '7', objectName: 'Первый объект', need: 9, statusLabel: 'Передан расчёт', chiefName: 'Старший объекта' },
      { visitObjectId: '8', objectName: 'Нулевая потребность', need: 0, statusLabel: 'Передан расчёт', chiefName: '' },
    ],
    allocations: [
      allocation('a1', '11', 'Департамент без ответа', null),
      allocation('a2', '12', 'Департамент с отказом', 0),
      allocation('a3', '13', 'Департамент с ответом', 2),
      { ...allocation('draft', '14', 'Черновой департамент', null), need: 1, sentAt: null },
    ],
    demandRows: [{ id: 'group', visitObjectId: '7', sector: '', task: '', shift: '', need: 2,
      kindCode: 'SPECIAL_GROUP', specification: 'Специальная группа связи', place: 'Главный вход', requirements: '', comment: '' }],
    objects: [
      { visitObjectId: '7', objectName: 'Первый объект', need: 9, assigned: 1 },
      { visitObjectId: '8', objectName: 'Нулевая потребность', need: 0, assigned: 0 },
      { visitObjectId: '9', objectName: 'Неразмеченный объект', need: null, assigned: 0 },
    ],
    roster: [
      { employeeId: 'e1', name: 'Ранее назначенный сотрудник', departmentId: '13', departmentName: 'Департамент с ответом',
        divisionId: '21', divisionName: 'Первое управление', acceptedAt: null, statusCode: null, statusLabel: null, visitObjectId: '7' },
      { employeeId: 'e2', name: 'Новый сотрудник', departmentId: '13', departmentName: 'Департамент с ответом',
        divisionId: '21', divisionName: 'Первое управление', acceptedAt: null, statusCode: null, statusLabel: null, visitObjectId: null },
    ],
    handover: {},
  };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function prepare(page: Page, options: { headquarters?: boolean } = {}) {
  const state = { list: 'rows' as 'rows' | 'empty' | 'error', cardFail: false, card: detail(),
    listReads: [] as string[], cardReads: [] as string[], listGate: null as ReturnType<typeof gate> | null,
    cardGate: null as ReturnType<typeof gate> | null };
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    // Mutations always reach ux-fixture's mandatory block, including accidental authz/business writes.
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === '/api/operations/my-permissions/') return route.fulfill({ json: {
      permissions, global_permissions: permissions, roles: options.headquarters ? [
        { code: 'OPS_STAFF', name: 'Штаб', scope_division_id: null, scope_division_name: null },
      ] : [],
    } });
    if (pathname === '/api/ops/security-events/forces/campaigns/') return route.fulfill({ json: { results: [] } });
    if (pathname === '/api/ops/security-events/forces/collections/') {
      state.listReads.push(pathname);
      if (state.listGate) await state.listGate.promise;
      return route.fulfill(state.list === 'error'
        ? { status: 503, json: { detail: 'Список сборов временно недоступен.' } }
        : { json: { results: state.list === 'empty' ? [] : [row] } });
    }
    if (pathname === '/api/ops/security-events/901/force-collection/') {
      state.cardReads.push(pathname);
      if (state.cardGate) await state.cardGate.promise;
      return route.fulfill(state.cardFail
        ? { status: 503, json: { detail: 'Сбор временно недоступен.' } }
        : { json: state.card });
    }
    if (pathname === '/api/core/divisions/') return route.fulfill({ json: { results: [
      { id: 11, name: 'Департамент без ответа', type_code: 'department' },
      { id: 12, name: 'Департамент с отказом', type_code: 'department' },
      { id: 13, name: 'Департамент с ответом', type_code: 'department' },
      { id: 14, name: 'Черновой департамент', type_code: 'department' },
    ] } });
    return route.fallback();
  });
  await signIn(page);
  return state;
}
function expectContext(page: Page, collection: boolean) {
  const query = new URL(page.url()).searchParams;
  expect(query.get('view')).toBe('forces');
  expect(query.get('tab')).toBe('collections');
  expect(query.get('businessDate')).toBe(DATE);
  expect(query.get('dateFrom')).toBe('2026-10-22');
  expect(query.get('dateTo')).toBe('2026-10-24');
  expect(query.get('collection')).toBe(collection ? '901' : null);
}

for (const width of [320, 1440]) {
  test(`HQ empty collections offer refresh without unused headers at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await prepare(page); state.list = 'empty';
    await page.goto(LIST_URL);
    const section = page.getByRole('region', { name: 'Сборы сил', exact: true });
    await expect(section.getByText(/Сборов нет/)).toBeVisible();
    await expect(section.getByRole('table')).toHaveCount(0);
    await expect(section.getByText(/не посчитана потребность/)).toHaveCount(0);
    const before = state.listReads.length; state.list = 'rows'; state.listGate = gate();
    try {
      await section.getByRole('button', { name: 'Обновить сборы', exact: true }).click();
      await expect.poll(() => state.listReads.length).toBe(before + 1);
      await expect(section.getByRole('button', { name: 'Обновляю…', exact: true })).toBeDisabled();
      expectContext(page, false);
      state.listGate.release();
      const table = section.getByRole('table', { name: 'Сборы сил', exact: true });
      await expect(table.getByRole('columnheader')).toHaveCount(9);
      const item = table.locator('[data-slot="force-collection-row"]');
      await expect(item.locator('[data-slot="collection-requested"]')).toHaveText('9');
      await expect(item.locator('[data-slot="collection-allocating"]')).toHaveText('2');
      await expect(item.locator('[data-slot="collection-shortage"]')).toHaveText('7');
      await expect(item.getByRole('button', { name: 'Открыть сбор ОМ-901', exact: true })).toBeVisible();
      expectContext(page, false);
      expect(businessWrites).toEqual([]);
    } finally { state.listGate.release(); }
  });

  test(`HQ failed collections retry in place without unused headers at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await prepare(page); state.list = 'error';
    await page.goto(LIST_URL);
    const section = page.getByRole('region', { name: 'Сборы сил', exact: true });
    await expect(section.getByRole('alert')).toContainText('Список сборов временно недоступен.');
    await expect(section.getByRole('table')).toHaveCount(0);
    const before = state.listReads.length; state.list = 'rows'; state.listGate = gate();
    try {
      await section.getByRole('button', { name: 'Повторить загрузку сборов', exact: true }).click();
      await expect.poll(() => state.listReads.length).toBe(before + 1);
      await expect(section.getByRole('button', { name: 'Повторить загрузку сборов', exact: true })).toHaveCount(0);
      expectContext(page, false);
      state.listGate.release();
      await expect(section.getByRole('button', { name: 'Открыть сбор ОМ-901', exact: true })).toBeVisible();
      await expect(section.getByRole('alert')).toHaveCount(0);
      expectContext(page, false);
      expect(businessWrites).toEqual([]);
    } finally { state.listGate.release(); }
  });
}

for (const width of [390, 1440]) {
  test(`HQ failed collection retries its direct link and preserves Back context at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await prepare(page); state.cardFail = true;
    await page.goto(CARD_URL);
    await expect(page.getByRole('alert').filter({ hasText: 'Сбор временно недоступен.' })).toBeVisible();
    const before = state.cardReads.length; state.cardFail = false; state.cardGate = gate();
    try {
      await page.getByRole('button', { name: 'Повторить загрузку сбора', exact: true }).click();
      await expect.poll(() => state.cardReads.length).toBe(before + 1);
      await expect(page.getByRole('button', { name: 'Повторить загрузку сбора', exact: true })).toHaveCount(0);
      expectContext(page, true);
      state.cardGate.release();
      await expect(page.getByRole('heading', { name: row.title, exact: true })).toBeVisible();
      expectContext(page, true);
      await page.getByRole('button', { name: 'Назад к списку сборов', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Открыть сбор ОМ-901', exact: true })).toBeVisible();
      expectContext(page, false);
      expect(businessWrites).toEqual([]);
    } finally { state.cardGate.release(); }
  });

  test(`HQ reference disclosure preserves pending split and roster selections at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page); await page.goto(CARD_URL);
    const reference = page.locator('details[data-slot="collection-reference"]');
    await expect(reference).toHaveJSProperty('open', false);
    const split = page.getByRole('region', { name: 'Запросы департаментам и полученные списки', exact: true });
    await expect(split.getByRole('columnheader')).toHaveCount(8);
    await expect(split.locator('[data-slot="department-row"]')).toHaveCount(3);
    const sent = split.locator('[data-slot="department-row"]');
    await expect(sent.nth(0).locator('[data-slot="department-allocating"]')).toHaveText('—');
    await expect(sent.nth(0).getByRole('button', { name: 'Довыделить недобор →', exact: true })).toHaveCount(0);
    await expect(sent.nth(1).locator('[data-slot="department-allocating"]')).toHaveText('0');
    await expect(sent.nth(1).getByRole('button', { name: 'Довыделить недобор →', exact: true })).toBeVisible();
    await expect(sent.nth(2).locator('[data-slot="department-allocating"]')).toHaveText('2');
    const need = split.getByRole('textbox', { name: 'Сколько человек, строка 1', exact: true });
    await need.fill('5');
    const comment = split.getByRole('textbox', { name: 'Комментарий Штаба, строка 1', exact: true });
    await comment.fill('Локально набранный черновик');
    const picked = page.getByRole('checkbox', { name: 'Отметить Новый сотрудник', exact: true });
    await picked.check();
    await page.getByLabel('На объект…', { exact: true }).selectOption('7');
    const summary = reference.locator('summary');
    await summary.focus(); await summary.press('Enter');
    await expect(reference).toHaveJSProperty('open', true);
    await expect(reference.getByTestId('collection-object-plan-8')).toContainText('Потребность 0');
    await expect(reference.getByTestId('collection-object-plan-9')).toContainText('Потребность не размечена');
    await expect(reference.getByRole('region', { name: 'Потребность в специальных группах', exact: true })).toContainText('Специальная группа связи · 2 · Главный вход');
    await expect(reference.locator('[data-slot="need-total"]')).toHaveText('Итого 9');
    await summary.press('Enter');
    await expect(reference).toHaveJSProperty('open', false);
    await expect(need).toHaveValue('5');
    await expect(comment).toHaveValue('Локально набранный черновик');
    await expect(picked).toBeChecked();
    await expect(page.getByLabel('На объект…', { exact: true })).toHaveValue('7');
    await expect(split.getByRole('button', { name: 'Сохранить черновик', exact: true })).toBeEnabled();
    await expect(split.getByRole('button', { name: 'Отправить запросы', exact: true })).toBeEnabled();
    expectContext(page, true);
    expect(businessWrites).toEqual([]);
  });
}

test('HQ handed-over collection keeps top-up requests and new roster assignments reachable', async ({ page, businessWrites }) => {
  const state = await prepare(page);
  state.card = { ...detail(), canCollect: false, stage: 'APPROVAL', handover: { at: '2026-10-22T04:00:00Z' } };
  await page.goto(CARD_URL);
  const reference = page.locator('details[data-slot="collection-reference"]');
  await expect(reference).toHaveJSProperty('open', false);
  const split = page.getByRole('region', { name: 'Запросы департаментам и полученные списки', exact: true });
  await expect(split.getByRole('button', { name: 'Сохранить черновик', exact: true })).toHaveCount(0);
  const topUp = split.locator('[data-slot="department-row"]').nth(1).getByRole('button', { name: 'Довыделить недобор →', exact: true });
  await topUp.click();
  const dialog = page.getByRole('dialog', { name: 'Довыделить недобор — Департамент с отказом', exact: true });
  await expect(dialog.getByLabel('Сколько человек довыделить', { exact: true })).toHaveValue('3');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Отметить Ранее назначенный сотрудник', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Отметить Новый сотрудник', exact: true }).check();
  await page.getByLabel('На объект…', { exact: true }).selectOption('7');
  await expect(page.getByRole('button', { name: 'Отдать объекту: 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Передать на расстановку', exact: true })).toHaveCount(0);
  expectContext(page, true);
  expect(businessWrites).toEqual([]);
});

for (const width of [320, 390]) {
  test(`HQ compact header brings requests within 900px at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page, { headquarters: true }); await page.goto(CARD_URL);
    const heading = page.getByRole('heading', { name: 'Запросы департаментам и полученные списки', exact: true });
    await expect(heading).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await heading.evaluate(element => ({
      documentTop: element.getBoundingClientRect().top + window.scrollY,
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    expect(geometry.documentTop, `Request heading must appear before 900px: ${JSON.stringify(geometry)}`).toBeLessThan(900);
    expect(geometry.pageHorizontalOverflow).toBe(false);
    const primary = page.locator('dl[aria-label="Состояние сбора"]');
    await expect(primary.locator('dt')).toHaveText(['Потребность', 'Собрано', 'Осталось собрать']);
    await expect(primary.locator('dd')).toHaveText(['9', '2', '7']);
    await expect(page.locator('details[data-slot="collection-progress-details"]')).toHaveJSProperty('open', false);
    await expect(page.locator('details[data-slot="collection-reference"]')).toHaveJSProperty('open', false);
    expectContext(page, true);
    expect(businessWrites).toEqual([]);
  });

  test(`HQ compact header retains all metrics and local work across progress disclosure at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await prepare(page, { headquarters: true });
    state.card.allocated = 10;
    state.card.allocations[2].allocating = 1;
    state.card.totals = { ...state.card.totals, allocating: 1, shortage: 8 };
    await page.goto(CARD_URL);
    const primary = page.locator('dl[aria-label="Состояние сбора"]');
    await expect(primary.locator('dd')).toHaveText(['9', '2', '7']);
    const progress = page.locator('details[data-slot="collection-progress-details"]');
    await expect(progress).toHaveJSProperty('open', false);
    const banner = page.getByRole('status', { name: 'Текущий этап сбора', exact: true });
    await expect(banner).toContainText('Шаг 4 из 4');
    await expect(banner).toContainText('Раздать по ОМ и объектам');
    expect(await banner.evaluate(element => Boolean(element.closest('details')))).toBe(false);
    const draft = page.getByRole('textbox', { name: 'Сколько человек, строка 1', exact: true });
    await draft.fill('5');
    const comment = page.getByRole('textbox', { name: 'Комментарий Штаба, строка 1', exact: true });
    await comment.fill('Черновик до раскрытия этапов');
    const picked = page.getByRole('checkbox', { name: 'Отметить Новый сотрудник', exact: true });
    await picked.check();
    const target = page.getByLabel('На объект…', { exact: true });
    await target.selectOption('7');
    const summary = progress.locator('summary');
    await summary.focus(); await summary.press('Enter');
    await expect(progress).toHaveJSProperty('open', true);
    const secondary = progress.locator('dl[aria-label="Квоты и ответы департаментов"]');
    await expect(secondary.locator('dt')).toHaveText(['Распределено квотами', 'Департаменты выделяют']);
    await expect(secondary.locator('dd')).toHaveText(['10', '1']);
    await expect(progress.getByText('Больше потребности на 1', { exact: true })).toBeVisible();
    const stages = progress.getByRole('list', { name: 'Этапы работы Штаба', exact: true });
    await expect(stages.getByRole('listitem')).toHaveCount(4);
    await expect(stages.locator('[aria-current="step"]')).toContainText('Раздать по ОМ и объектам');
    await summary.focus(); await summary.press('Enter');
    await expect(progress).toHaveJSProperty('open', false);
    await expect(primary.locator('dd')).toHaveText(['9', '2', '7']);
    await expect(draft).toHaveValue('5');
    await expect(comment).toHaveValue('Черновик до раскрытия этапов');
    await expect(picked).toBeChecked();
    await expect(target).toHaveValue('7');
    await expect(page.getByRole('button', { name: 'Сохранить черновик', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Отправить запросы', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Отдать объекту: 1', exact: true })).toBeEnabled();
    expectContext(page, true);
    expect(businessWrites).toEqual([]);
  });
}

for (const scenario of [
  { name: 'unsent zero demand', step: 2, label: 'Разделить по департаментам' },
  { name: 'sent requests without roster', step: 3, label: 'Получить ответы и списки' },
  { name: 'handover without roster', step: 4, label: 'Раздать по ОМ и объектам', bannerLabel: 'Состав передан на расстановку' },
]) {
  test(`HQ compact header preserves current-step semantics for ${scenario.name}`, async ({ page, businessWrites }) => {
    const state = await prepare(page, { headquarters: true });
    state.card = { ...detail(), roster: [], allocations: scenario.step === 3 ? [allocation('sent', '11', 'Департамент без ответа', null)] : [],
      handover: scenario.step === 4 ? { at: '2026-10-22T04:00:00Z' } : {} };
    if (scenario.step === 2) state.card = { ...state.card, need: 0, allocated: 0, gathered: 0, remaining: 0,
      totals: { need: 0, requested: 0, allocating: 0, sent: 0, shortage: 0 } };
    await page.goto(CARD_URL);
    const banner = page.getByRole('status', { name: 'Текущий этап сбора', exact: true });
    await expect(banner).toContainText(`Шаг ${scenario.step} из 4`);
    await expect(banner).toContainText(scenario.bannerLabel ?? scenario.label);
    const progress = page.locator('details[data-slot="collection-progress-details"]');
    await expect(progress).toHaveJSProperty('open', false);
    if (scenario.step === 2) await expect(page.locator('dl[aria-label="Состояние сбора"] dd')).toHaveText(['0', '0', '0']);
    await progress.locator('summary').click();
    const stages = progress.getByRole('list', { name: 'Этапы работы Штаба', exact: true });
    await expect(stages.getByRole('listitem')).toHaveCount(4);
    await expect(stages.locator('[aria-current="step"]')).toContainText(scenario.label);
    if (scenario.step === 2) await expect(progress.locator('dl[aria-label="Квоты и ответы департаментов"] dd')).toHaveText(['0', '0']);
    expectContext(page, true);
    expect(businessWrites).toEqual([]);
  });
}

for (const width of [320, 390]) {
  test(`HQ sent table keeps department values and actions within ${width}px without horizontal scrolling`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await prepare(page, { headquarters: true });
    state.card.allocations[2].status = 'SUBMITTED';
    await page.goto(CARD_URL);
    const section = page.getByRole('region', { name: 'Запросы департаментам и полученные списки', exact: true });
    const rows = section.locator('[data-slot="department-row"]');
    await expect(rows).toHaveCount(3);
    const container = section.locator('[data-slot="table-container"]');
    expect(await container.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    for (const button of [
      rows.nth(1).getByRole('button', { name: 'Довыделить недобор →', exact: true }),
      rows.nth(2).getByRole('button', { name: 'Вернуть департаменту', exact: true }),
    ]) {
      const rect = await button.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    for (const row of await rows.all()) {
      const cells = row.locator(':scope > td');
      await expect(cells).toHaveCount(8);
      for (const cell of await cells.all()) {
        const rect = await cell.boundingBox();
        if (rect) { expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1); }
      }
    }
    await expect(rows.nth(0).locator('[data-slot="department-allocating"]')).toHaveText('—');
    await expect(rows.nth(1).locator('[data-slot="department-allocating"]')).toHaveText('0');
    const need = section.getByRole('textbox', { name: 'Сколько человек, строка 1', exact: true });
    await need.fill('5');
    const expand = rows.nth(0).getByRole('button', { name: 'Департамент без ответа', exact: true });
    await expand.focus(); await expand.press('Enter');
    await expect(section.getByText('Департамент ещё никого не выделил', { exact: true })).toBeVisible();
    await expand.press('Enter'); await expect(need).toHaveValue('5');
    await rows.nth(1).getByRole('button', { name: 'Довыделить недобор →', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    await rows.nth(2).getByRole('button', { name: 'Вернуть департаменту', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(need).toHaveValue('5');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    expect(businessWrites).toEqual([]);
  });
}
