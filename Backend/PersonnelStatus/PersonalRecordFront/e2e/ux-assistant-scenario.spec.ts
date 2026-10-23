import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { AssistantTask } from '@/features/om-assistant/model';

const id = '2733240a-32a0-46cd-9ad9-5127665c29e8';
const endpoint = '/api/ops/assistant/tasks/';
const savedTask: AssistantTask = {
  id, initiatedBy: 'synthetic-chief', revision: 1, message: 'Сохранённое поручение',
  status: 'needs_information', delegated: false, canEdit: true, canContinue: false,
  questions: [{ field: 'title', text: 'Укажите название' }], interpretationNotice: null,
  gathering: null, plan: { eventId: null, title: null, intent: 'prepare', allocations: [] },
  event: null, receipts: [], updatedAt: '2026-10-22T10:00:00Z',
};

async function reads(page: Page, state: { tasks: AssistantTask[]; enabled?: boolean; listError?: boolean; detail?: AssistantTask }) {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['event.create', 'event.view'], global_permissions: ['event.create', 'event.view'], roles: [],
  } }));
  await page.route('**/api/ops/assistant/tasks/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === endpoint + 'configuration/') return route.fulfill({ json: { enabled: state.enabled !== false, provider: null, model: null, isHeadquarters: false } });
    if (pathname === endpoint + 'catalogs/') return route.fulfill({ json: { objects: [{ id: '30', name: 'Учебный объект' }], departments: [{ id: '2', name: 'Второй департамент' }] } });
    if (pathname === endpoint) return state.listError
      ? route.fulfill({ status: 503, json: { message: 'Учебный сбой чтения' } })
      : route.fulfill({ json: { results: state.tasks, isHeadquarters: false, page: 1, pageCount: 1, total: state.tasks.length, nextPage: null, previousPage: null } });
    return route.fulfill({ json: state.detail ?? savedTask });
  });
}

for (const width of [320, 1440]) {
  test(`creation has one active input path and preserves both drafts at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 950 });
    await reads(page, { tasks: [] });
    const creates: Array<{ message: string; interpret: boolean; fields: { title: string; personnelTotal: number; businessDate: string; objectId: string } }> = [];
    await page.route('**/api/ops/assistant/tasks/', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      creates.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { message: 'Учебный сбой сохранения' } });
    });
    await signIn(page); await page.goto('/security-ops/assistant');
    const form = page.getByRole('region', { name: 'Новое поручение', exact: true });
    await form.getByLabel('Какой наряд нужно подготовить?', { exact: true }).fill('Наряд на учебный объект — 12 человек');
    await page.getByRole('radio', { name: 'Заполнить форму', exact: true }).check();
    await expect(form.getByLabel('Какой наряд нужно подготовить?', { exact: true })).not.toBeVisible();
    await form.getByLabel('Название', { exact: true }).fill('Учебная встреча');
    await form.getByLabel('Дата начала', { exact: true }).fill('2026-10-25');
    await form.getByRole('combobox', { name: 'Объект', exact: true }).selectOption('30');
    await form.getByLabel('Людей по поручению', { exact: true }).fill('12');
    await page.getByRole('radio', { name: 'Описать задачу', exact: true }).check();
    await expect(form.getByLabel('Какой наряд нужно подготовить?', { exact: true })).toHaveValue('Наряд на учебный объект — 12 человек');
    await page.getByRole('radio', { name: 'Заполнить форму', exact: true }).check();
    await expect(form.getByLabel('Название', { exact: true })).toHaveValue('Учебная встреча');
    await expect(form.getByRole('button', { name: 'Подготовить по поручению', exact: true })).toHaveCount(0);
    await form.getByRole('button', { name: 'Сохранить по указанным сведениям', exact: true }).click();
    await expect.poll(() => creates.length).toBe(1);
    expect(creates[0]).toMatchObject({ message: 'Наряд на учебный объект — 12 человек', interpret: false,
      fields: { title: 'Учебная встреча', businessDate: '2026-10-25', objectId: '30', personnelTotal: 12 } });
    await expect(page.getByRole('alert').filter({ hasText: 'Ответ мог потеряться после сохранения' })).toBeVisible();
    await expect(form.getByLabel('Название', { exact: true })).toHaveValue('Учебная встреча');
    await expect(page.getByRole('radio', { name: 'Описать задачу', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    expect(businessWrites).toEqual([]);
  });

  test(`an empty queue has no pagination and saved tasks stay out of the creation focus at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = { tasks: [] as AssistantTask[] };
    await reads(page, state);
    await signIn(page); await page.goto('/security-ops/assistant');
    await expect(page.getByRole('region', { name: 'Новое поручение', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Страницы поручений', exact: true })).toHaveCount(0);
    const disclosure = page.getByText('Сохранённые поручения', { exact: true });
    await expect(disclosure).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Поручения', exact: true })).not.toBeVisible();
    await disclosure.click();
    const queue = page.getByRole('complementary', { name: 'Поручения', exact: true });
    await expect(queue).toContainText('Сохранённые поручения появятся здесь.');
    state.tasks = [savedTask];
    await queue.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(queue.getByRole('link', { name: /Сохранённое поручение/ })).toBeVisible();
    await expect(queue.getByRole('navigation', { name: 'Страницы поручений', exact: true })).toHaveCount(0);
    await queue.getByRole('link', { name: /Сохранённое поручение/ }).click();
    await expect(page).toHaveURL(new RegExp('task=' + id));
    await expect(page.getByRole('region', { name: 'Состояние поручения', exact: true })).toBeVisible();
    expect(businessWrites).toEqual([]);
  });
}

test('disabled text interpretation starts in the usable manual path with one save action', async ({ page, businessWrites }) => {
  await reads(page, { tasks: [], enabled: false });
  await signIn(page); await page.goto('/security-ops/assistant');
  const form = page.getByRole('region', { name: 'Новое поручение', exact: true });
  await expect(page.getByRole('radio', { name: 'Заполнить форму', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Описать задачу', exact: true })).toBeDisabled();
  await expect(form.getByLabel('Название', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Какой наряд нужно подготовить?', { exact: true })).not.toBeVisible();
  await expect(form.getByRole('button', { name: 'Подготовить по поручению', exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Сохранить по указанным сведениям', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('queue read errors offer retry without pagination and preserve the task text', async ({ page, businessWrites }) => {
  const state = { tasks: [savedTask], listError: true };
  await reads(page, state);
  await signIn(page); await page.goto('/security-ops/assistant');
  const message = page.getByLabel('Какой наряд нужно подготовить?', { exact: true });
  await message.fill('Не потерять это поручение');
  await page.getByText('Сохранённые поручения', { exact: true }).click();
  const queue = page.getByRole('complementary', { name: 'Поручения', exact: true });
  await expect(queue).toContainText('Список поручений недоступен.');
  await expect(queue.getByRole('navigation', { name: 'Страницы поручений', exact: true })).toHaveCount(0);
  state.listError = false;
  await queue.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(queue.getByRole('link', { name: /Сохранённое поручение/ })).toBeVisible();
  await expect(message).toHaveValue('Не потерять это поручение');
  expect(businessWrites).toEqual([]);
});

test('a stale queue page can return to the first page without losing event context or the draft', async ({ page, businessWrites }) => {
  const state = { tasks: [savedTask], listError: true };
  await reads(page, state);
  await signIn(page); await page.goto('/security-ops/assistant?event=70&page=99');
  const message = page.getByLabel('Какой наряд нужно подготовить?', { exact: true });
  await message.fill('Поручение в контексте существующего ОМ');
  const queue = page.getByRole('complementary', { name: 'Поручения', exact: true });
  await expect(queue).toContainText('Список поручений недоступен.');
  state.listError = false;
  await queue.getByRole('button', { name: 'На первую страницу', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
  expect(new URL(page.url()).searchParams.get('event')).toBe('70');
  await expect(queue.getByRole('link', { name: /Сохранённое поручение/ })).toBeVisible();
  await expect(message).toHaveValue('Поручение в контексте существующего ОМ');
  expect(businessWrites).toEqual([]);
});

for (const choice of ['saved', 'local'] as const) {
  test(`correction preserves unsaved fields across a remote revision and explicitly chooses ${choice}`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width: choice === 'local' ? 320 : 1440, height: 1000 });
    const state = { tasks: [savedTask], detail: { ...savedTask } };
    await reads(page, state);
    const writes: Array<{ fields: { title: string }; revision: number }> = [];
    await page.route(`**${endpoint}${id}/continue/`, route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON(); writes.push(body);
      state.detail = { ...state.detail, revision: 3, plan: { ...state.detail.plan, ...body.fields } };
      return route.fulfill({ json: state.detail });
    });
    await signIn(page); await page.goto(`/security-ops/assistant?task=${id}`);
    const title = page.getByLabel('Название', { exact: true });
    await title.fill('Мои несохранённые сведения');
    state.detail = { ...savedTask, revision: 2, plan: { ...savedTask.plan, title: 'Сведения из другой вкладки' } };
    await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
    const conflict = page.getByRole('status').filter({ hasText: 'Поручение изменилось' });
    await expect(conflict).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await expect(title).toHaveValue('Мои несохранённые сведения');
    const save = page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true });
    await expect(save).toBeDisabled();
    if (choice === 'saved') {
      await page.getByRole('button', { name: 'Загрузить сохранённые сведения', exact: true }).click();
      await expect(title).toHaveValue('Сведения из другой вкладки');
    } else {
      await page.getByRole('button', { name: 'Продолжить с моими правками', exact: true }).click();
      await expect(title).toHaveValue('Мои несохранённые сведения');
      await save.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ revision: 2, fields: { title: 'Мои несохранённые сведения' } });
      await expect(save).toBeEnabled();
      await expect(conflict).toHaveCount(0);
      // The acknowledged own save must not be mistaken for an external conflict.
      state.detail = { ...state.detail, revision: 4, plan: { ...state.detail.plan, title: 'Позднее сохранённое название' } };
      await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
      await expect(title).toHaveValue('Позднее сохранённое название');
    }
    await expect(conflict).toHaveCount(0);
    expect(businessWrites).toEqual([]);
  });
}

test('an unedited correction adopts the latest saved revision without a conflict prompt', async ({ page, businessWrites }) => {
  const state = { tasks: [savedTask], detail: { ...savedTask } };
  await reads(page, state); await signIn(page); await page.goto(`/security-ops/assistant?task=${id}`);
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('');
  state.detail = { ...savedTask, revision: 2, plan: { ...savedTask.plan, title: 'Новое сохранённое название' } };
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Новое сохранённое название');
  await expect(page.getByRole('status').filter({ hasText: 'Поручение изменилось' })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a successful uncertain correction retry adopts its own saved revision without a false conflict', async ({ page, businessWrites }) => {
  const state = { tasks: [savedTask], detail: { ...savedTask } };
  await reads(page, state);
  const writes: Array<{ fields: { title: string }; revision: number }> = [];
  await page.route(`**${endpoint}${id}/continue/`, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON(); writes.push(body);
    if (writes.length === 1) return route.fulfill({ status: 503, json: { message: 'Ответ потерян после записи' } });
    state.detail = { ...state.detail, revision: 2, plan: { ...state.detail.plan, ...body.fields } };
    return route.fulfill({ json: state.detail });
  });
  await signIn(page); await page.goto(`/security-ops/assistant?task=${id}`);
  const title = page.getByLabel('Название', { exact: true });
  await title.fill('Не создавать ложный конфликт после повтора');
  await page.getByRole('button', { name: 'Сохранить сведения и продолжить', exact: true }).click();
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
  await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toHaveCount(0);
  await expect(title).toHaveValue('Не создавать ложный конфликт после повтора');
  const conflict = page.getByRole('status').filter({ hasText: 'Поручение изменилось' });
  await expect(conflict).toHaveCount(0);
  state.detail = { ...state.detail, revision: 3, plan: { ...state.detail.plan, title: 'Последующее изменение' } };
  await page.getByRole('button', { name: 'Обновить состояние', exact: true }).click();
  await expect(title).toHaveValue('Последующее изменение');
  await expect(conflict).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});
