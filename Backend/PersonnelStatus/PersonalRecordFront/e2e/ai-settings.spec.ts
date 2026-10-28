import { expect, test, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

const initial = { provider: 'disabled', baseUrl: '', model: '', hasKey: false, revision: '1' };
const baseURL = process.env.AI_SETTINGS_BASE_URL || 'http://127.0.0.1:3391';

for (const entry of ['/security-ops/assistant/', '/workspace/']) {
  test(`HTTP task creation sends POST and shows its saved result from ${entry}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const submitted: Array<{ requestKey: string; message: string }> = [];
    const id = '2733240a-32a0-46cd-9ad9-5127665c29e8';
    const task = { id, initiatedBy: 'ai-settings-fixture', revision: 1, message: 'Наряд на Аккорду, 200 человек',
      status: 'needs_information', delegated: false, canEdit: true, canContinue: false,
      questions: [{ field: 'businessDate', text: 'На какую дату нужен наряд?' }], interpretationNotice: null,
      plan: { title: 'Учебное поручение', objectName: 'Аккорда', personnelTotal: 200, allocations: [] },
      event: null, gathering: null, receipts: [], updatedAt: '2026-10-24T08:00:00Z' };
    await setup(page, ['event.create', 'event.view']);
    await page.route('**/api/ops/assistant/tasks/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST') {
        submitted.push(request.postDataJSON());
        return route.fulfill({ status: 201, json: task });
      }
      if (path.endsWith('/configuration/')) return route.fulfill({ json: { enabled: true, provider: 'openai', isHeadquarters: false } });
      if (path.endsWith('/catalogs/')) return route.fulfill({ json: { objects: [], departments: [] } });
      if (path.endsWith(`/${id}/`)) return route.fulfill({ json: task });
      return route.fulfill({ json: { results: submitted.length ? [task] : [], isHeadquarters: false, page: 1, pageCount: 1, total: submitted.length } });
    });
    // Real HTTP hostname, mapped locally by Playwright. Crypto is not stubbed.
    const httpOrigin = new URL(baseURL); httpOrigin.hostname = 'smart-http.test';
    const token = await encode({ secret: 'ai-settings-browser-fixture-only', token: { id: 'ai-settings-fixture', sub: 'ai-settings-fixture' } });
    await page.context().addCookies([{ name: 'next-auth.session-token', value: token, url: httpOrigin.origin }]);
    await page.goto(httpOrigin.origin + entry);
    expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues })))
      .toEqual({ secure: false, uuid: 'undefined', random: 'function' });
    await page.getByRole('textbox', { name: 'Какой наряд нужно подготовить?' }).fill(task.message);
    await page.getByRole('button', { name: 'Подготовить по поручению' }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0].message).toBe(task.message);
    expect(submitted[0].requestKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(page).toHaveURL(new RegExp(`task=${id}`));
    await expect(page.getByRole('region', { name: 'Состояние поручения' })).toContainText('200');
    expect(errors).toEqual([]);
  });
}
async function setup(page: Page, permissions = ['settings.view', 'settings.manage'], globalPermissions = permissions) {
  await page.routeWebSocket('**/ws/**', () => {});
  const token = await encode({ secret: 'ai-settings-browser-fixture-only', token: { id: 'ai-settings-fixture', sub: 'ai-settings-fixture' } });
  await page.context().addCookies([{ name: 'next-auth.session-token', value: token, url: baseURL }]);
  // No API request may reach a real service, including incidental shell reads.
  await page.route('**/api/**', route => route.fulfill({ json: { results: [], count: 0 } }));
  await page.route('**/api/auth/session**', route => route.fulfill({ json: {
    user: { id: 'ai-settings-fixture', name: 'AI settings fixture', accessToken: 'fixture-only', userData: { id: 'ai-settings-fixture' } },
    expires: '2099-01-01T00:00:00Z',
  } }));
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions, global_permissions: globalPermissions, roles: [],
  } }));
  await page.route('**/api/ops/settings/**', route => route.fulfill({ json: { results: [], sectionVersions: {} } }));
}

test('administrator can check an unsaved draft, then save and see a masked stored key', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  const browserWarnings: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
    if (message.type() === 'warning') browserWarnings.push(message.text());
  });
  await setup(page);
  const checks: unknown[] = [], saves: unknown[] = [];
  let saved = { ...initial };
  await page.route('**/api/ops/assistant-settings/', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); saves.push(body);
      saved = { provider: body.provider, baseUrl: body.baseUrl, model: body.model, hasKey: true, revision: '2' };
    }
    await route.fulfill({ json: saved });
  });
  await page.route('**/api/ops/assistant-settings/check/', route => {
    checks.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, message: 'Модель ответила на проверку.' } });
  });
  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Подключение ИИ', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Подключение ИИ', exact: true }).click();
  await expect(page.getByLabel('Адрес API')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.getByLabel('Провайдер').selectOption('openai');
  await page.getByLabel('Адрес API').fill('http://model.example.test:8002');
  await page.getByLabel('Модель', { exact: true }).fill('gemma-4-31b-it');
  await page.getByLabel('Ключ API', { exact: true }).fill('test-secret-value');
  await page.getByRole('button', { name: 'Проверить соединение' }).click();
  await expect(page.getByRole('status')).toContainText('Модель ответила');
  expect(saves).toEqual([]);
  expect(checks).toEqual([{ provider: 'openai', baseUrl: 'http://model.example.test:8002', model: 'gemma-4-31b-it', apiKey: 'test-secret-value', revision: '1' }]);
  await page.getByLabel('Модель', { exact: true }).fill('new-model');
  await expect(page.getByText('Модель ответила на проверку.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('сохранены');
  expect(saves).toHaveLength(1);
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByText('Ключ сохранён на сервере.')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-secret-value');
  await page.reload();
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('new-model');
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('ai-settings-desktop.png'), fullPage: true });
  await testInfo.attach('browser-console', { body: JSON.stringify({ browserErrors, browserWarnings }, null, 2), contentType: 'application/json' });
  expect(browserErrors).toEqual([]);
});

for (const profile of [
  { name: 'ordinary user', permissions: ['event.view'], global: ['event.view'] },
  { name: 'scoped settings administrator', permissions: ['settings.manage'], global: [] },
  { name: 'scoped wildcard', permissions: ['*'], global: [] },
]) test(`${profile.name} cannot see or directly open AI settings`, async ({ page }) => {
  await setup(page, profile.permissions, profile.global);
  let reads = 0;
  await page.route('**/api/ops/assistant-settings/**', route => { reads++; return route.fulfill({ json: initial }); });
  await page.goto('/settings/');
  await expect(page.getByRole('link', { name: 'Подключение ИИ', exact: true })).toHaveCount(0);
  await page.goto('/settings/ai/');
  await expect(page.getByText('Доступ закрыт', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveCount(0);
  expect(reads).toBe(0);
});

test('stored key requires explicit intent for a new origin and blank key preserves it', async ({ page }) => {
  await setup(page, ['*']);
  const writes: any[] = [];
  await page.route('**/api/ops/assistant-settings/', route => {
    if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { provider: 'openai', baseUrl: 'http://old.example.test', model: 'stored-model', hasKey: true, revision: '3' } });
  });
  await page.goto('/settings/ai/');
  await page.getByLabel('Модель', { exact: true }).fill('changed-model');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('сохранены');
  expect(writes[0]).not.toHaveProperty('apiKey');
  expect(writes[0]).not.toHaveProperty('clearKey');
  await page.getByLabel('Адрес API').fill('http://new.example.test');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('замените или удалите');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.getByLabel('Удалить сохранённый ключ').check();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].clearKey).toBe(true);
});

test('load failure offers retry and failed check or save preserves the draft', async ({ page }) => {
  await setup(page);
  let failRead = true;
  await page.route('**/api/ops/assistant-settings/', route =>
    failRead || route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { detail: 'Сервис временно недоступен' } })
      : route.fulfill({ json: initial }));
  await page.route('**/api/ops/assistant-settings/check/', route => route.fulfill({ json: { ok: false, message: 'Модель не ответила' } }));
  await page.goto('/settings/ai/');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Не удалось загрузить');
  await expect(page.getByLabel('Адрес API')).toHaveCount(0);
  failRead = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await page.getByLabel('Провайдер').selectOption('ollama');
  await page.getByLabel('Адрес API').fill('http://model.example.test');
  await page.getByLabel('Модель', { exact: true }).fill('gemma');
  await page.getByRole('button', { name: 'Проверить соединение' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Модель не ответила');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('недоступен');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('gemma');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
});

test('loading and in-flight requests lock the editor and cannot show stale check success', async ({ page }) => {
  await setup(page);
  let releaseRead!: () => void, releaseCheck!: () => void, releaseSave!: () => void;
  const read = new Promise<void>(resolve => { releaseRead = resolve; });
  const check = new Promise<void>(resolve => { releaseCheck = resolve; });
  const save = new Promise<void>(resolve => { releaseSave = resolve; });
  let saves = 0;
  await page.route('**/api/ops/assistant-settings/', async route => {
    if (route.request().method() === 'PUT') {
      saves++; await save;
      return route.fulfill({ json: { ...initial, provider: 'openai', baseUrl: 'http://model.example.test/v1/chat/completions', model: 'changed', revision: '2' } });
    }
    await read;
    await route.fulfill({ json: { ...initial, provider: 'openai', baseUrl: 'http://model.example.test/v1/chat/completions', model: 'stored' } });
  });
  await page.route('**/api/ops/assistant-settings/check/', async route => {
    await check; await route.fulfill({ json: { ok: true, message: 'Проверка завершена' } });
  });
  try {
    await page.goto('/security-ops/settings/ai/');
    await expect(page.getByRole('status')).toContainText('Загрузка');
    await expect(page.getByLabel('Ключ API', { exact: true })).toHaveCount(0);
    releaseRead();
    await page.getByRole('button', { name: 'Проверить соединение' }).click();
    await expect(page.getByRole('button', { name: 'Проверка…' })).toBeDisabled();
    await expect(page.getByLabel('Модель', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Ключ API', { exact: true })).toBeDisabled();
    releaseCheck();
    await expect(page.getByRole('status')).toContainText('Проверка завершена');
    expect(saves).toBe(0);
    await page.getByLabel('Модель', { exact: true }).fill('changed');
    await expect(page.getByText('Проверка завершена', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
    await expect(page.getByLabel('Адрес API')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Проверить соединение' })).toBeDisabled();
    releaseSave();
    await expect(page.getByRole('status')).toContainText('сохранены');
    expect(saves).toBe(1);
  } finally { releaseRead(); releaseCheck(); releaseSave(); }
});

test('revision conflict keeps the draft until an explicit reload retrieves current settings', async ({ page }) => {
  await setup(page);
  let revision = '1';
  const writes: any[] = [];
  await page.route('**/api/ops/assistant-settings/', route => {
    if (route.request().method() === 'PUT') {
      writes.push(route.request().postDataJSON()); revision = '2';
      return route.fulfill({ status: 409, json: { detail: 'Настройки изменены другим администратором.' } });
    }
    return route.fulfill({ json: { provider: 'ollama', baseUrl: 'http://model.example.test', model: revision === '1' ? 'original' : 'current-server-model', hasKey: false, revision } });
  });
  await page.goto('/settings/ai/');
  await page.getByLabel('Модель', { exact: true }).fill('my-unsaved-model');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('другим администратором');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('my-unsaved-model');
  expect(writes[0].revision).toBe('1');
  await page.getByRole('button', { name: 'Загрузить актуальные настройки и сбросить изменения' }).click();
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('current-server-model');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.getByLabel('Модель', { exact: true }).fill('second-draft');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].revision).toBe('2');
});

test('server validation explains the rejected address and preserves the editable draft', async ({ page }) => {
  await setup(page);
  await page.route('**/api/ops/assistant-settings/', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 400, json: { detail: ['Адрес API не должен содержать переходы между каталогами.'] } })
    : route.fulfill({ json: { ...initial, provider: 'openai', baseUrl: 'http://model.example.test', model: 'gemma' } }));
  await page.goto('/settings/ai/');
  await page.getByLabel('Адрес API').fill('http://model.example.test/a/../v1');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('не должен содержать переходы');
  await expect(page.getByLabel('Адрес API')).toHaveValue('http://model.example.test/a/../v1');
  await page.getByLabel('Адрес API').fill('http://model.example.test/v1');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
