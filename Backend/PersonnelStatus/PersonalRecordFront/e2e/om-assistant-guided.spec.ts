import { test as base, expect, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import type { AssistantTask } from '@/features/om-assistant/model';

const baseURL = process.env.GUIDED_ASSISTANT_BASE_URL || 'http://127.0.0.1:3393';
interface AnswerBody { requestKey: string; revision: number; message: string }
interface RetryBody { requestKey: string; revision: number }

const taskId = '2733240a-32a0-46cd-9ad9-5127665c29e8';
const endpoint = '/api/ops/assistant/tasks/';
const question = { id: 'object-0-sector-count', field: 'briefing.objects.0.sectorCount',
  text: 'Аккорда: сколько секторов нужно подготовить?', placeholder: 'Укажите число секторов', canDefer: true };
function taskFor(patch: Partial<AssistantTask> = {}): AssistantTask {
  return { id: taskId, initiatedBy: 'browser-fixture', revision: 1,
    message: 'Подготовить наряд на Аккорду и Тарлан', status: 'needs_information',
    delegated: false, canEdit: true, canContinue: false, canMessage: true,
    questions: [{ field: question.field, text: question.text }], interpretationNotice: null,
    processing: { state: 'ready', attempt: 1, error: null, retryable: false },
    guidance: { current: question, remaining: 2, deferred: 0 },
    plan: { title: 'Учебная проверка нескольких объектов', intent: 'prepare', allocations: [],
      briefing: { objects: [
        { name: 'Аккорда', sectorCount: null, sectors: [], personnelNeed: 5, needStatus: 'known' },
        { name: 'Тарлан', sectorCount: 2, sectors: [], personnelNeed: 8, needStatus: 'known' },
      ], protectedPersons: [] } },
    gathering: null, event: null, receipts: [], updatedAt: '2026-10-27T13:00:00Z',
    messages: [{ id: 'message-original', role: 'user', text: 'Подготовить наряд на Аккорду и Тарлан',
      requestKey: 'original', createdAt: '2026-10-27T13:00:00Z' }], ...patch };
}
const test = base.extend<{ safety: { unexpectedWrites: string[]; errors: string[] } }>({
  safety: async ({ page }, use) => {
    const unexpectedWrites: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/ws/**', () => {});
    await page.route('**/api/**', route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        unexpectedWrites.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
        return route.fulfill({ status: 403, json: { detail: 'Unexpected mutation blocked by fixture' } });
      }
      return route.fulfill({ json: { results: [], count: 0 } });
    });
    await use({ unexpectedWrites, errors });
    expect(unexpectedWrites).toEqual([]);
    expect(errors).toEqual([]);
  },
});
async function setup(page: Page, state: { task: AssistantTask }, permissions = ['event.create', 'event.view']) {
  const token = await encode({ secret: 'guided-assistant-browser-fixture-only',
    token: { id: 'browser-fixture', sub: 'browser-fixture' } });
  await page.context().addCookies([{ name: 'next-auth.session-token', value: token, url: baseURL }]);
  await page.route('**/api/auth/session**', route => route.fulfill({ json: {
    user: { id: 'browser-fixture', name: 'Browser fixture', accessToken: 'fixture-only', userData: { id: 'browser-fixture' } },
    expires: '2099-01-01T00:00:00Z',
  } }));
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions, global_permissions: permissions, roles: [],
  } }));
  await page.route('**/api/ops/assistant/tasks/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/configuration/')) return route.fulfill({ json: { enabled: true, provider: 'openai', isHeadquarters: false } });
    if (pathname.endsWith('/catalogs/')) return route.fulfill({ json: { objects: [], departments: [] } });
    if (pathname === endpoint) return route.fulfill({ json: { results: [state.task], isHeadquarters: false, page: 1, pageCount: 1, total: 1 } });
    return route.fulfill({ json: state.task });
  });
  await page.goto('/security-ops/assistant/?task=' + taskId);
  return page.getByRole('region', { name: 'Переписка по поручению' });
}

for (const width of [320, 390, 1440]) {
  test(`one question and explicit short-answer submission at ${width}px`, async ({ page, safety: _safety }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = { task: taskFor() }, sent: AnswerBody[] = [];
    const conversation = await setup(page, state);
    await expect(conversation.getByLabel('Текущий вопрос')).toContainText(question.text);
    await expect(conversation.getByRole('list', { name: 'История сообщений' })).toBeHidden();
    await expect(conversation.getByText('Все недостающие сведения', { exact: true })).toBeVisible();
    await conversation.getByLabel('Ваш ответ', { exact: true }).fill('3');
    await page.route('**/api/ops/assistant/tasks/*/messages/', async route => {
      sent.push(route.request().postDataJSON());
      state.task = taskFor({ revision: 2, guidance: { current: { ...question, id: 'next-post-count',
        text: 'Аккорда, сектор 1: сколько постов?' }, remaining: 1, deferred: 0,
        feedback: 'Сохранено: для Аккорды указано 3 сектора.' },
        messages: [...(state.task.messages ?? []), { id: 'message-short', role: 'user', text: '3', requestKey: sent[0].requestKey, createdAt: '2026-10-27T13:01:00Z' }] });
      return route.fulfill({ status: 202, json: state.task });
    });
    await conversation.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].message).toBe('3');
    expect(sent[0].revision).toBe(1);
    expect(sent[0].requestKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(conversation.getByRole('status')).toContainText('указано 3 сектора');
    await expect(conversation.getByLabel('Ваш ответ', { exact: true })).toHaveValue('');
    await expect(conversation.getByLabel('Текущий вопрос')).toContainText('сколько постов');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });

  test(`defer choice is reviewable and never sends automatically at ${width}px`, async ({ page, safety: _safety }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = { task: taskFor() }, sent: AnswerBody[] = [];
    const conversation = await setup(page, state);
    await page.route('**/api/ops/assistant/tasks/*/messages/', route => {
      sent.push(route.request().postDataJSON());
      state.task = taskFor({ revision: 2, guidance: { current: null, remaining: 1, deferred: 1,
        feedback: 'Вопрос отложен. Потребность пока неизвестна.' } });
      return route.fulfill({ status: 202, json: state.task });
    });
    await conversation.getByRole('button', { name: 'Пока не знаю', exact: true }).click();
    await expect(conversation.getByLabel('Ваш ответ', { exact: true })).toHaveValue('Пока не знаю');
    expect(sent).toEqual([]);
    await conversation.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].message).toBe('Пока не знаю');
    await expect(conversation.getByRole('button', { name: 'Вернуться к отложенным вопросам', exact: true })).toBeVisible();
    await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
    await expect(conversation).toContainText('Осталось уточнений: 1');
    await expect(conversation.getByRole('button', { name: 'Отправить сообщение', exact: true })).toBeDisabled();
  });
}

test('server question changes preserve the draft and require explicit acknowledgement', async ({ page, safety: _safety }) => {
  const state = { task: taskFor() }, sent: AnswerBody[] = [];
  const conversation = await setup(page, state);
  await conversation.getByLabel('Ваш ответ', { exact: true }).fill('3');
  state.task = taskFor({ revision: 2, guidance: { current: { ...question, id: 'tarlan-sector-count',
    text: 'Тарлан: сколько секторов нужно подготовить?' }, remaining: 1, deferred: 0 } });
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(conversation.getByLabel('Текущий вопрос')).toContainText('Тарлан');
  await expect(conversation.getByLabel('Ваш ответ', { exact: true })).toHaveValue('3');
  await expect(conversation.getByRole('button', { name: 'Отправить ответ', exact: true })).toBeDisabled();
  await page.route('**/api/ops/assistant/tasks/*/messages/', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: taskFor({ revision: 3 }) });
  });
  await conversation.getByRole('button', { name: 'Проверил вопрос — использовать мой ответ', exact: true }).click();
  await conversation.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].revision).toBe(2);
  expect(sent[0].message).toBe('3');
});

test('queued and failed processing hide old guidance and offer an explicit retry', async ({ page, safety: _safety }) => {
  const state = { task: taskFor({ processing: { state: 'queued', attempt: 1, error: null, retryable: false } }) };
  const conversation = await setup(page, state);
  await expect(conversation.getByRole('status')).toContainText('Ожидает обработки');
  await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
  await expect(conversation.getByLabel('Сообщение помощнику', { exact: true })).toBeDisabled();
  state.task = taskFor({ processing: { state: 'failed', attempt: 1, error: 'Учебный сбой модели', retryable: true } });
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(conversation.getByRole('status')).toContainText('Учебный сбой модели');
  await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
  const retries: RetryBody[] = [];
  await page.route('**/api/ops/assistant/tasks/*/retry/', route => {
    retries.push(route.request().postDataJSON());
    state.task = taskFor({ revision: 2, processing: { state: 'queued', attempt: 2, error: null, retryable: false } });
    return route.fulfill({ status: 202, json: state.task });
  });
  await conversation.getByRole('button', { name: 'Повторить обработку', exact: true }).click();
  await expect.poll(() => retries.length).toBe(1);
  expect(retries[0].revision).toBe(1);
  await expect(conversation.getByRole('status')).toContainText('Ожидает обработки');
  await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
});

test('observer cannot send a short answer or defer a question', async ({ page, safety: _safety }) => {
  const state = { task: taskFor({ canEdit: false, canMessage: false }) };
  const conversation = await setup(page, state);
  await expect(conversation.getByLabel('Ваш ответ', { exact: true })).toBeDisabled();
  await expect(conversation.getByRole('button', { name: 'Пока не знаю', exact: true })).toBeDisabled();
  await expect(conversation.getByRole('button', { name: 'Отправить ответ', exact: true })).toBeDisabled();
});
