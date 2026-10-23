import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { AssistantTask } from '@/features/om-assistant/model';

// Mocked UI contracts only. Every assistant write is fulfilled locally;
// the UX fixture continues blocking any unexpected business mutation.
const id = '2733240a-32a0-46cd-9ad9-5127665c29e8';
const endpoint = '/api/ops/assistant/tasks/';
test.use({ timezoneId: 'America/Los_Angeles' });
const makeTask = (patch: Partial<AssistantTask> = {}): AssistantTask => ({
  id, initiatedBy: 'synthetic-chief', revision: 1, message: 'Запроси наряд', status: 'awaiting_executor', delegated: true,
  canEdit: true, canContinue: false, questions: [], interpretationNotice: null,
  gathering: { state: 'missing', campaignId: null },
  plan: { title: 'Проверка поручения', businessDate: '2026-10-25', eventId: '70', intent: 'send', allocations: [{ departmentId: '2', need: 4 }] },
  event: { id: '70', code: 'ОМ-70', title: 'Проверка поручения', stage: 'RECON', forceDemandTotal: 4, requested: 0, rosterCount: 0 },
  receipts: [], updatedAt: '2026-10-21T10:00:00Z', ...patch,
});

async function mockReads(page: Page, permissions: string[], state: { task: AssistantTask; headquarters?: boolean; enabled?: boolean; denied?: boolean }) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions, roles: [] } }));
  await page.route('**/api/ops/assistant/tasks/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === endpoint + 'configuration/') return route.fulfill({ json: { enabled: state.enabled !== false, provider: state.enabled === false ? null : 'ollama', model: null, isHeadquarters: state.headquarters ?? false } });
    if (pathname === endpoint + 'catalogs/') return route.fulfill({ json: { objects: [{ id: '30', name: 'Доступный объект' }], departments: [{ id: '2', name: 'Второй департамент' }] } });
    if (pathname === endpoint) return route.fulfill({ json: { results: [state.task], isHeadquarters: state.headquarters ?? false } });
    if (state.denied) return route.fulfill({ status: 403, json: { error_code: 'PERMISSION_DENIED', message: 'Доступ закрыт', details: {} } });
    return route.fulfill({ json: state.task });
  });
}

for (const width of [320, 1440]) for (const canEdit of [true, false]) {
  test(`interpretation notice offers a permitted next step for editable=${canEdit} at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 900 });
    const detail = 'Provider detail <untrusted> & configuration';
    const state = { task: makeTask({ canEdit, event: null, gathering: null, status: 'needs_information', interpretationNotice: detail,
      plan: { title: null, businessDate: '2026-10-23', kind: 'INTERNAL', objectId: '30', objectName: 'Доступный объект', personnelTotal: 200,
        eventId: null, intent: 'prepare', allocations: [] }, questions: [{ field: 'title', text: 'Как называется мероприятие?' }] }) };
    await mockReads(page, canEdit ? ['event.create', 'event.view'] : ['forces.command', 'event.view'], state);
    await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
    const notice = page.getByRole('region', { name: 'Проверка распознанных сведений', exact: true });
    await expect(notice).toContainText('Поручение сохранено, но автоматический разбор текста не завершён.');
    await expect(notice.getByText(detail, { exact: true })).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('23.10.2026');
    await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('200');
    if (canEdit) {
      await expect(notice).toContainText('заполните недостающие сведения в форме');
      await expect(page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true })).toBeVisible();
    } else {
      await expect(notice).toContainText('Сведения уточняет инициатор поручения');
      await expect(notice).not.toContainText('заполните недостающие сведения в форме');
      await expect(page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true })).toHaveCount(0);
    }
    await notice.getByText('Подробности разбора', { exact: true }).click();
    await expect(notice.getByText(detail, { exact: true })).toBeVisible();
    await notice.getByText('Подробности разбора', { exact: true }).click();
    state.task = { ...state.task, revision: 2, status: 'awaiting_department_responses', questions: [],
      receipts: [{ operation: 'send_allocations', executedBy: 'synthetic-staff', createdAt: '2026-10-22T10:00:00Z', result: {} }] };
    await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
    await expect(notice).toContainText('Текущее состояние и результаты действий показаны в карточке ниже.');
    await expect(notice).not.toContainText('заполните недостающие сведения в форме');
    await expect(page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    expect(businessWrites).toEqual([]);
  });
}

for (const width of [320, 1440]) test(`foreign visitor labels and the FOREIGN API code stay consistent at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = { task: makeTask({ event: null, gathering: null, status: 'needs_information',
    plan: { title: 'Приём', businessDate: '2026-10-25', kind: 'FOREIGN', objectId: '30', objectName: 'Доступный объект',
      eventId: null, intent: 'prepare', allocations: [] }, questions: [{ field: 'personnelTotal', text: 'Уточните количество людей' }] }) };
  await mockReads(page, ['event.create', 'event.view'], state);
  const submitted: Array<{ fields: { kind: string; personnelTotal: number } }> = [];
  await page.route('**/api/ops/assistant/tasks/*/continue/', route => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: state.task });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('С участием иностранцев');
  await page.getByText('Изменить распознанные сведения', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Вид ОМ(?:\s|$)/ })).toHaveValue('FOREIGN');
  await expect(page.getByRole('option', { name: 'С участием иностранцев', exact: true })).toHaveAttribute('value', 'FOREIGN');
  await expect(page.getByText('Зарубежное', { exact: false })).toHaveCount(0);
  await page.getByLabel('Людей по поручению', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].fields.kind).toBe('FOREIGN');
  expect(submitted[0].fields.personnelTotal).toBe(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

test('chief sees the exact handoff owner and an event link without an unauthorized gathering link', async ({ page, businessWrites }) => {
  const state = { task: makeTask() };
  await mockReads(page, ['event.create', 'event.view'], state);
  await signIn(page);
  await page.goto('/security-ops/assistant?task=' + id);
  const card = page.getByRole('region', { name: 'Состояние поручения' });
  await expect(card.getByText('Ожидается штаб', { exact: true })).toBeVisible();
  await expect(card.getByText('Штаб второго департамента', { exact: true })).toBeVisible();
  await expect(card).toContainText('Запросы ещё не отправлены');
  await expect(card.getByText('Штаб готовит распределение', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: /распределени/ })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Открыть карточку ОМ' })).toHaveAttribute('href', '/security-ops/events/70/');
  await expect(card.getByRole('link', { name: 'Открыть сбор наряда' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Подготовка наряда' })).toHaveCount(0);
  await card.getByText('Ход подготовки', { exact: true }).click();
  await expect(page.getByRole('list', { name: 'Подготовка наряда' })).toContainText('Рекогносцировка');
  await card.getByText('Ход подготовки', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выполнить отправку от своего имени', exact: true })).toHaveCount(0);
  for (const [status, statusLabel] of [['awaiting_recon', 'Ожидается рекогносцировка'], ['awaiting_department_responses', 'Ожидаются ответы департаментов'], ['collecting', 'Состав собирается'], ['awaiting_approval', 'Ожидается согласование']]) {
    const gathering = status === 'awaiting_recon' || status === 'awaiting_approval' ? null : status === 'collecting' ? undefined : { state: 'ready' as const, campaignId: null };
    state.task = makeTask({ status, canContinue: false, gathering, event: { ...makeTask().event!, stage: status === 'awaiting_approval' ? 'APPROVAL' : 'RECON' } });
    await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
    await expect(card.getByText(statusLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выполнить отправку от своего имени', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Продолжить поручение', exact: true })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Открыть карточку ОМ' })).toBeVisible();
    if (gathering === null) await expect(card.getByRole('region', { name: 'Подготовка физического наряда' })).toHaveCount(0);
    else if (gathering === undefined) await expect(card).toContainText('создано ли одно активное распределение');
    else await expect(card).toContainText('Распределение для подбора подготовлено');
  }
  expect(businessWrites).toEqual([]);
});

test('staff continues a delegated task without editing its proposal or claiming final assignment', async ({ page, businessWrites }) => {
  const state = { task: makeTask({ canEdit: false, canContinue: true }), headquarters: true };
  await mockReads(page, ['forces.command', 'event.view'], state);
  let body: unknown;
  await page.route('**/api/ops/assistant/tasks/*/continue/', async route => {
    body = route.request().postDataJSON();
    state.task = makeTask({ canEdit: false, status: 'awaiting_department_responses', event: { ...makeTask().event!, requested: 4 },
      receipts: [{ operation: 'send_allocations', executedBy: 'synthetic-staff', createdAt: '2026-10-21T10:00:00Z', result: { delivery: { known: true, notifiedOfficers: 1 } } }] });
    return route.fulfill({ json: state.task });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  await expect(page.getByRole('link', { name: 'Открыть распределения', exact: true })).toHaveAttribute('href', '/employees/?view=forces&tab=collections');
  await expect(page.getByRole('button', { name: 'Сохранить сведения и продолжить' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выполнить отправку от своего имени' }).click();
  await expect(page.getByText('Ожидаются ответы департаментов', { exact: true }).first()).toBeVisible();
  expect(body).toEqual({});
  await expect(page.getByRole('link', { name: 'Открыть сбор наряда', exact: true })).toHaveAttribute('href', '/employees/?view=forces&tab=collections&collection=70');
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).not.toContainText('Люди назначены');
  state.task = { ...state.task, gathering: { state: 'ambiguous', campaignId: null } };
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(page.getByText('Штаб уточняет распределение', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Проверить распределения', exact: true })).toHaveAttribute('href', '/employees/?view=forces&tab=collections');
  state.task = { ...state.task, gathering: { state: 'ready', campaignId: '55' } };
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Открыть распределение', exact: true })).toHaveAttribute('href', '/employees/?view=forces&tab=collections&campaign=55');
  expect(businessWrites).toEqual([]);
});

test('text with selected event requests interpretation and persists the returned task in the address', async ({ page, businessWrites }) => {
  await mockReads(page, ['event.create', 'event.view'], { task: makeTask() });
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/ops/assistant/tasks/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: makeTask() });
  });
  await signIn(page); await page.goto('/security-ops/assistant?event=70');
  await page.getByLabel('Какой наряд нужно подготовить?').fill('Запроси 4 человека во втором департаменте');
  await page.getByRole('button', { name: 'Подготовить по поручению' }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  expect(body?.interpret).toBe(true);
  expect(body?.fields).toEqual({ eventId: '70' });
  expect(typeof body?.requestKey).toBe('string');
  expect(businessWrites).toEqual([]);
});

test('a lost response reuses the same request key and payload; New task gets a new key', async ({ page, businessWrites }) => {
  await mockReads(page, ['event.create', 'event.view'], { task: makeTask() });
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/ops/assistant/tasks/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('connectionfailed');
    return route.fulfill({ status: 201, json: makeTask() });
  });
  await signIn(page); await page.goto('/security-ops/assistant');
  await page.getByLabel('Какой наряд нужно подготовить?').fill('Подготовь внутреннее мероприятие');
  await page.getByRole('button', { name: 'Подготовить по поручению' }).click();
  await expect(page.getByLabel('Какой наряд нужно подготовить?')).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить сохранение' }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  expect(bodies[1]).toEqual(bodies[0]);
  await page.getByRole('button', { name: 'Новая задача' }).click();
  await page.getByLabel('Какой наряд нужно подготовить?').fill('Другое поручение');
  await page.getByRole('button', { name: 'Подготовить по поручению' }).click();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2].requestKey).not.toEqual(bodies[0].requestKey);
  expect(businessWrites).toEqual([]);
});

test('disabled text understanding offers visible manual fields and an explicit manual request', async ({ page, businessWrites }) => {
  await mockReads(page, ['event.create', 'event.view'], { task: makeTask(), enabled: false });
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/ops/assistant/tasks/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: makeTask() });
  });
  await signIn(page); await page.goto('/security-ops/assistant');
  await expect(page.getByText(/Понимание текста отключено/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подготовить по поручению' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Описать задачу', exact: true })).toBeDisabled();
  await page.getByText('Дополнительные сведения', { exact: true }).click();
  await page.getByLabel('Существующее ОМ, ID (если уже создано)').fill('70');
  await page.getByText('Запросы по департаментам', { exact: true }).click();
  await page.getByRole('button', { name: 'Добавить департамент' }).click();
  const department = page.getByRole('combobox', { name: 'Департамент 1', exact: true });
  await expect(department).toBeEnabled();
  await department.selectOption('2');
  await expect(department).toHaveValue('2');
  await page.getByLabel('Человек', { exact: true }).fill('4');
  await expect(department).toHaveValue('2');
  await page.getByRole('button', { name: 'Сохранить по указанным сведениям' }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  expect(body?.interpret).toBe(false);
  expect(body?.fields).toEqual({ eventId: '70', intent: 'prepare', personnelTotal: null, allocations: [{ departmentId: '2', need: 4 }] });
  expect(businessWrites).toEqual([]);
});

test('a denied detail refresh removes retained event metadata and all continuation actions', async ({ page, businessWrites }) => {
  const state = { task: makeTask(), denied: false };
  await mockReads(page, ['event.create', 'event.view'], state);
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toBeVisible();
  state.denied = true;
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(page.getByText('Поручение недоступно для текущего пользователя.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Продолжить поручение', exact: true })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('deadline editor keeps Astana time in a browser using another time zone', async ({ page, businessWrites }) => {
  const selected = makeTask({ plan: { ...makeTask().plan, allocations: [{ departmentId: '2', need: 4, dueAt: '2026-10-25T12:00:00Z' }] } });
  await mockReads(page, ['event.create', 'event.view'], { task: selected });
  let body: { fields?: { allocations?: { dueAt?: string }[] } } | undefined;
  await page.route('**/api/ops/assistant/tasks/*/continue/', route => {
    body = route.request().postDataJSON(); return route.fulfill({ json: selected });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  await page.getByText('Изменить предложение запросов', { exact: true }).click();
  const deadline = page.getByLabel('Срок ответа по времени Астаны', { exact: true });
  await expect(deadline).toHaveValue(/^2026-10-25T17:00(?::00)?$/);
  await deadline.fill('2026-10-25T18:30');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить' }).click();
  await expect.poll(() => body?.fields?.allocations?.[0]?.dueAt).toBe('2026-10-25T18:30:00+05:00');
  expect(businessWrites).toEqual([]);
});

test('the 26th unfinished task remains reachable with queue page, event context and selection after reload and Back', async ({ page, businessWrites }) => {
  const earlier = makeTask({ event: { ...makeTask().event!, title: 'Раннее незавершённое поручение' } });
  await mockReads(page, ['event.create', 'event.view'], { task: earlier });
  const newest = Array.from({ length: 25 }, (_, index) => makeTask({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    status: 'completed', event: { ...makeTask().event!, title: `Новое завершённое поручение ${index + 1}` } }));
  const reads: number[] = [];
  await page.route('**/api/ops/assistant/tasks/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.pathname !== endpoint) return route.fallback();
    const current = Number(url.searchParams.get('page') ?? '1'); reads.push(current);
    return route.fulfill({ json: { results: current === 2 ? [earlier] : newest, isHeadquarters: false,
      page: current, pageCount: 2, total: 26, nextPage: current === 1 ? 2 : null, previousPage: current === 2 ? 1 : null } });
  });
  await signIn(page); await page.goto('/security-ops/assistant?event=70');
  await page.getByText('Сохранённые поручения', { exact: true }).click();
  const queue = page.getByRole('complementary', { name: 'Поручения', exact: true });
  await expect(queue).toContainText('Страница 1 из 2');
  await expect(queue.getByRole('link', { name: /Раннее незавершённое/ })).toHaveCount(0);
  await queue.getByRole('button', { name: 'Следующая страница поручений' }).click();
  await expect(queue).toContainText('Страница 2 из 2'); await expect(queue).toContainText('Всего поручений: 26');
  await queue.getByRole('link', { name: /Раннее незавершённое/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBe(id);
  expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  expect(new URL(page.url()).searchParams.get('event')).toBe('70');
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('Раннее незавершённое поручение');
  await page.reload();
  await expect(queue).toContainText('Страница 2 из 2');
  const before = reads.filter(value => value === 2).length;
  await queue.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => reads.filter(value => value === 2).length).toBeGreaterThan(before);
  await queue.getByRole('button', { name: 'Предыдущая страница поручений' }).click();
  await expect(queue).toContainText('Страница 1 из 2');
  expect(new URL(page.url()).searchParams.get('task')).toBe(id);
  expect(new URL(page.url()).searchParams.get('event')).toBe('70');
  await page.goBack();
  await expect(queue).toContainText('Страница 2 из 2');
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('Раннее незавершённое поручение');
  expect(businessWrites).toEqual([]);
});

test('a mistyped existing event ID is recovered from the queue and corrected on the same saved task', async ({ page, businessWrites }) => {
  const state = { enabled: false, task: makeTask({ status: 'event_unavailable', event: null, canEdit: true,
    gathering: null, plan: { eventId: '999999999', intent: 'prepare', allocations: [] } }) };
  await mockReads(page, ['event.create', 'event.view'], state);
  let saved = false;
  const creates: Record<string, unknown>[] = [];
  const corrections: { pathname: string; body: { revision?: number; fields?: { eventId?: string } } }[] = [];
  await page.route('**/api/ops/assistant/tasks/**', route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === endpoint) {
      creates.push(request.postDataJSON()); saved = true;
      return route.fulfill({ status: 404, json: { error_code: 'ENTITY_NOT_FOUND', message: 'Мероприятие не найдено.', details: {} } });
    }
    if (request.method() === 'GET' && pathname === endpoint) {
      return route.fulfill({ json: { results: saved ? [state.task] : [], isHeadquarters: false } });
    }
    if (request.method() === 'POST' && pathname === endpoint + id + '/continue/') {
      corrections.push({ pathname, body: request.postDataJSON() });
      state.task = makeTask({ status: 'awaiting_recon', revision: 2, gathering: null,
        plan: { ...makeTask().plan, intent: 'prepare', allocations: [] } });
      return route.fulfill({ json: state.task });
    }
    return route.fallback();
  });
  await signIn(page); await page.goto('/security-ops/assistant');
  await page.getByText('Дополнительные сведения', { exact: true }).click();
  await page.getByLabel('Существующее ОМ, ID (если уже создано)').fill('999999999');
  await page.getByRole('button', { name: 'Сохранить по указанным сведениям', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Мероприятие не найдено' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('task')).toBe(false);
  await page.getByText('Сохранённые поручения', { exact: true }).click();
  const queue = page.getByRole('complementary', { name: 'Поручения', exact: true });
  await queue.getByRole('button', { name: 'Обновить', exact: true }).click();
  await queue.getByRole('link', { name: /Запроси наряд/ }).click();
  await expect(page).toHaveURL(new RegExp('task=' + id));
  await page.getByText('Изменить предложение запросов', { exact: true }).click();
  await page.getByText('Дополнительные сведения', { exact: true }).click();
  await page.getByLabel('Существующее ОМ, ID (если уже создано)').fill('70');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('Ожидается рекогносцировка');
  expect(creates).toHaveLength(1);
  expect(corrections).toHaveLength(1);
  expect(corrections[0].pathname).toBe(endpoint + id + '/continue/');
  expect(corrections[0].body).toEqual({ revision: 1, fields: { eventId: '70', intent: 'prepare', personnelTotal: null, allocations: [] } });
  expect(new URL(page.url()).searchParams.get('task')).toBe(id);
  expect(businessWrites).toEqual([]);
});

test('clearing a manual object while answering a missing-kind question sends an explicit null', async ({ page, businessWrites }) => {
  const state = { task: makeTask({ status: 'needs_information', event: null, gathering: null,
    questions: [{ field: 'kind', text: 'Мероприятие внутреннее или с участием иностранных лиц?' }],
    plan: { title: 'Уточнение объекта', businessDate: '2027-06-01', objectId: '30', objectName: 'Доступный объект', intent: 'prepare', allocations: [] } }) };
  await mockReads(page, ['event.create', 'event.view'], state);
  const corrections: { fields?: { objectId?: string | null; kind?: string } }[] = [];
  await page.route('**/api/ops/assistant/tasks/*/continue/', route => {
    corrections.push(route.request().postDataJSON());
    state.task = makeTask({ status: 'awaiting_recon', revision: 2, gathering: null, questions: [],
      plan: { ...state.task.plan, kind: 'INTERNAL', objectId: null, objectName: undefined, eventId: '71' },
      event: { ...makeTask().event!, id: '71', code: 'ОМ-71', title: 'Уточнение объекта' } });
    return route.fulfill({ json: state.task });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  const object = page.getByRole('combobox', { name: 'Объект', exact: true });
  await expect(object).toBeHidden();
  await page.getByText('Изменить распознанные сведения', { exact: true }).click();
  await expect(object).toHaveValue('30');
  await object.selectOption('');
  await page.getByRole('combobox', { name: 'Вид ОМ', exact: true }).selectOption('INTERNAL');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  const card = page.getByRole('region', { name: 'Состояние поручения' });
  await expect(card).toContainText('Ожидается рекогносцировка');
  await expect(card).not.toContainText('Доступный объект');
  expect(corrections).toHaveLength(1);
  expect(corrections[0].fields?.objectId).toBeNull();
  expect(corrections[0].fields?.kind).toBe('INTERNAL');
  expect(businessWrites).toEqual([]);
});

for (const width of [1440, 390]) test(`basic clarification and collapsed requests preserve the complete draft at ${width}px`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = { task: makeTask({ status: 'needs_information', event: null, gathering: null,
    questions: [{ field: 'title', text: 'Укажите название.' }, { field: 'kind', text: 'Укажите вид ОМ.' }],
    plan: { title: 'Уточнение поручения', businessDate: '2026-10-23', objectId: '30', objectName: 'Доступный объект', personnelTotal: 200, intent: 'prepare', allocations: [] } }) };
  await mockReads(page, ['event.create', 'event.view'], state);
  const corrections: { fields?: Record<string, unknown> }[] = [];
  await page.route('**/api/ops/assistant/tasks/*/continue/', route => {
    corrections.push(route.request().postDataJSON());
    return route.fulfill({ json: state.task });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  const card = page.getByRole('region', { name: 'Состояние поручения' });
  await expect(card.getByRole('heading', { name: 'Уточните название и вид ОМ', exact: true })).toBeVisible();
  const context = card.locator('dl[aria-label="Сведения поручения"]');
  await expect(context).toContainText('23.10.2026');
  await expect(context).toContainText('Доступный объект');
  await expect(context).toContainText('200');
  const correctionLink = card.getByRole('link', { name: 'Уточнить сведения', exact: true });
  await expect(correctionLink).toHaveAttribute('href', '#assistant-correction');
  await page.locator('#assistant-correction > summary').click();
  await expect(page.getByLabel('Название', { exact: true })).toBeHidden();
  await correctionLink.click();
  await expect(page).toHaveURL(new RegExp(`task=${id}#assistant-correction$`));
  await expect(card).toContainText('23.10.2026');
  await expect(card).toContainText('Доступный объект');
  await expect(card.getByText('200', { exact: true })).toBeVisible();
  await expect(card.getByText('Инициатор поручения', { exact: true })).toBeVisible();
  await page.getByText('Сохранённые поручения', { exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Поручения', exact: true }).getByRole('link')).toContainText('Доступный объект');
  await page.getByText('Сохранённые поручения', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Нужны сведения', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Название', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Вид ОМ', exact: true })).toBeVisible();
  await expect(page.getByLabel('Дата начала', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Людей по поручению', { exact: true })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Объект', exact: true })).toBeHidden();
  await page.getByText('Изменить распознанные сведения', { exact: true }).click();
  await expect(page.getByLabel('Дата начала', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Людей по поручению', { exact: true })).toHaveValue('200');
  await expect(page.getByRole('combobox', { name: 'Объект', exact: true })).toHaveValue('30');
  await page.getByText('Изменить распознанные сведения', { exact: true }).click();
  await expect(page.getByLabel('Существующее ОМ, ID (если уже создано)')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Добавить департамент', exact: true })).toBeHidden();
  await page.getByLabel('Название', { exact: true }).fill('Наряд на Аккорду');
  await card.getByText('Исходное поручение', { exact: true }).click();
  await expect(card.getByText('Запроси наряд', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Наряд на Аккорду');
  await page.getByRole('combobox', { name: /^Вид ОМ(?:\s|$)/ }).selectOption('INTERNAL');
  await page.getByText('Дополнительные сведения', { exact: true }).click();
  await page.getByLabel('Время (необязательно)', { exact: true }).fill('10:30');
  await page.getByText('Дополнительные сведения', { exact: true }).click();
  await page.getByText('Запросы по департаментам', { exact: true }).click();
  await page.getByRole('button', { name: 'Добавить департамент', exact: true }).click();
  await page.getByRole('combobox', { name: /^Департамент 1(?:\s|$)/ }).selectOption('2');
  await page.getByLabel('Человек', { exact: true }).fill('40');
  await page.getByText('Запросы по департаментам', { exact: true }).click();
  await page.getByText('Запросы по департаментам', { exact: true }).click();
  await expect(page.getByLabel('Человек', { exact: true })).toHaveValue('40');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Наряд на Аккорду');
  await expect(page.getByLabel('Дата начала', { exact: true })).toHaveValue('2026-10-23');
  // The wrapping label also contains the select's option text without a word
  // separator. A partial label query can read the retained hidden control.
  await expect(page.getByLabel('Объект')).toHaveValue('30');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  await expect.poll(() => corrections.length).toBe(1);
  expect(corrections[0].fields).toEqual({ title: 'Наряд на Аккорду', kind: 'INTERNAL', businessDate: '2026-10-23',
    businessDateEnd: null, eventTime: '10:30', objectId: '30', personnelTotal: 200, intent: 'prepare', allocations: [{ departmentId: '2', need: 40 }] });
  expect(businessWrites).toEqual([]);
});

test('an explicit headcount question remains visible and can clear a suggestion without changing hidden event facts', async ({ page, businessWrites }) => {
  const state = { task: makeTask({ status: 'needs_information', event: null, gathering: null,
    questions: [{ field: 'personnelTotal', text: 'Уточните общее количество людей или очистите поле.' }],
    plan: { title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-23', objectId: '30', objectName: 'Доступный объект',
      personnelTotal: 200, intent: 'prepare', allocations: [] } }) };
  await mockReads(page, ['event.create', 'event.view'], state);
  const corrections: { revision?: number; fields?: Record<string, unknown> }[] = [];
  await page.route('**/api/ops/assistant/tasks/*/continue/', route => {
    corrections.push(route.request().postDataJSON());
    return route.fulfill({ json: state.task });
  });
  await signIn(page); await page.goto('/security-ops/assistant?task=' + id);
  await expect(page.getByLabel('Людей по поручению', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Название', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Дата начала', { exact: true })).toBeHidden();
  await expect(page.getByText('Уточните общее количество людей или очистите поле.', { exact: true })).toHaveCount(1);
  await page.getByLabel('Людей по поручению', { exact: true }).fill('');
  await expect(page.getByLabel('Людей по поручению', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  await expect.poll(() => corrections.length).toBe(1);
  expect(corrections[0]).toEqual({ revision: 1, fields: { title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-23',
    businessDateEnd: null, eventTime: null, objectId: '30', personnelTotal: null, intent: 'prepare', allocations: [] } });
  expect(businessWrites).toEqual([]);
});
