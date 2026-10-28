import type { Page } from '@playwright/test';
import { test, expect, signIn } from './ux-fixture';

const path = '/security-ops/duty-register/';
const api = '/api/ops/duty-register/';
const period = { from: '2026-10-13', to: '2026-10-13' };

test('personal duty templates persist, apply a night interval and never submit a duty on Enter', async ({ page, businessWrites }) => {
  const longNote = 'Проверить связь ' + 'П'.repeat(180);
  await boot(page);
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('summary').filter({ hasText: /^Шаблоны дежурств/ }).click();
  await dialog.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await dialog.getByLabel('Плановое начало', { exact: true }).fill('2026-12-31T20:00');
  await dialog.getByLabel('Плановое завершение', { exact: true }).fill('2027-01-01T08:00');
  await dialog.getByLabel('Место', { exact: true }).fill('Объект · ночной пост');
  await dialog.getByLabel('Основание', { exact: true }).fill('Приказ 12');
  await dialog.getByRole('textbox', { name: 'Примечание', exact: true }).fill(longNote);
  await dialog.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await dialog.getByLabel('Название нового шаблона', { exact: true }).fill('ГБР · ночная смена');
  await dialog.getByLabel('Название нового шаблона', { exact: true }).press('Enter');
  await expect(dialog.getByText('Шаблон сохранён на сервере', { exact: false })).toBeVisible();
  expect(businessWrites).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  await dialog.locator('summary').filter({ hasText: /^Шаблоны дежурств/ }).click();
  await dialog.getByRole('combobox', { name: 'Сохранённый шаблон', exact: true }).selectOption({ label: 'ГБР · ночная смена · Личный' });
  await dialog.getByLabel('Дата смены по шаблону', { exact: true }).fill('2026-02-28');
  await dialog.getByRole('button', { name: 'Подставить в запись', exact: true }).click();
  await expect(dialog.getByLabel('Плановое начало', { exact: true })).toHaveValue('2026-02-28T20:00');
  await expect(dialog.getByLabel('Плановое завершение', { exact: true })).toHaveValue('2026-03-01T08:00');
  await expect(dialog.getByLabel('Место', { exact: true })).toHaveValue('Объект · ночной пост');
  await expect(dialog.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveValue(longNote);
  await expect(dialog.getByRole('button', { name: /Учётный сотрудник/ })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await dialog.getByRole('button', { name: 'Подставить в запись', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Учётный сотрудник/ })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole('button', { name: 'Удалить шаблон', exact: true }).click();
  await dialog.getByRole('button', { name: 'Да, удалить шаблон', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Сохранённый шаблон', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Плановое начало', { exact: true })).toHaveValue('2026-02-28T20:00');
});

test('copying a duty record opens a fresh plan and is unavailable to a reader', async ({ page, businessWrites }) => {
  await boot(page, snapshot({ period: { from: '2026-10-14', to: '2026-10-14' } }));
  await page.route('**/api/ops/duty-register/LOG:17/', route => route.fulfill({ json: record({ state: 'COMPLETED', actions: [], actual_start: '2026-10-13T08:03:00+05:00', actual_end: '2026-10-13T20:04:00+05:00' }) }));
  await page.goto(path + '?from=2026-10-14&to=2026-10-14&record=LOG%3A17');
  await page.getByRole('button', { name: 'Создать похожую', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Новая запись дежурства', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Вид дежурства', exact: true })).toHaveValue('GBR');
  await expect(dialog.getByLabel('Место', { exact: true })).toHaveValue('Место учёта');
  await expect(dialog.getByLabel('Плановое начало', { exact: true })).toHaveValue('2026-10-14T08:00');
  await expect(dialog.getByLabel('Плановое завершение', { exact: true })).toHaveValue('2026-10-14T20:00');
  await expect(dialog.getByRole('button', { name: /Учётный сотрудник/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Сохранить запись', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view'], roles: [] } }));
  await page.goto(path + '?from=2026-10-13&to=2026-10-13&record=LOG%3A17');
  await expect(page.getByRole('heading', { name: 'Запись дежурства', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать похожую', exact: true })).toHaveCount(0);
});
const kinds = { results: [
  { code: 'GBR', label: 'ГБР', label_kk: '', description: '', is_active: true },
  { code: 'SAKSHY', label: 'Смена Сакшы', label_kk: '', description: '', is_active: true },
  { code: 'KUMBEZ', label: 'Смена Кумбез', label_kk: '', description: '', is_active: true },
  { code: 'ARCHIVE', label: 'Архивный вид', label_kk: '', description: '', is_active: false },
] };
function record(extra: Record<string, unknown> = {}) {
  return { id: 'LOG:17', source: 'LOG', source_id: 17, employee_id: 7, employee_name: 'Учётный сотрудник',
    division_id: 4, division_name: 'Первое подразделение', service_duty_code: 'GBR', service_duty_label: 'ГБР',
    business_date: '2026-10-13', state: 'PLANNED', planned_start: '2026-10-13T08:00:00+05:00', planned_end: '2026-10-13T20:00:00+05:00',
    planned_minutes: 720, period_planned_minutes: 720, acknowledged_at: null, actual_start: null, actual_end: null,
    actual_minutes: null, period_actual_minutes: null, location_label: 'Место учёта', document_basis: '', note: '',
    created_at: '2026-10-12T12:00:00+05:00', updated_at: '2026-10-12T12:00:00+05:00', revision: 1,
    attention_codes: ['MISSING_START'], needs_attention: true, actions: ['acknowledge', 'cancel', 'classify', 'edit'],
    execution_mode: 'RECORDED_TIME', time_zone: 'Asia/Qyzylorda', cancelled_at: null, cancelled_reason: '', history: [], ...extra };
}
function snapshot(extra: Record<string, unknown> = {}) {
  return { period, generated_at: '2026-10-13T14:00:00+05:00', time_zone: 'Asia/Qyzylorda',
    rows: [record()], summary: { record_count: 3, employee_count: 2, completed_count: 1, active_count: 0, cancelled_count: 0,
      unconfirmed_count: 1, attention_count: 1, overlap_count: 2, missing_kind_count: 1, unknown_planned_count: 1,
      unknown_actual_count: 1, confirmed_actual_count: 0, planned_minutes: 720, actual_record_minutes: 0, actual_minutes: 0 },
    pagination: { count: 3, page: 1, pages: 1, page_size: 25 },
    by_kind: [{ service_duty_code: 'GBR', service_duty_label: 'ГБР', record_count: 3, employee_count: 2, planned_minutes: 720, actual_record_minutes: 0, attention_count: 1 }],
    by_employee: [{ subject_key: 'EMPLOYEE:7', employee_id: 7, employee_name: 'Учётный сотрудник', record_count: 3, planned_minutes: 720, actual_record_minutes: 0, actual_minutes: 0, attention_count: 1 }],
    filters: { divisions: [{ id: 4, name: 'Первое подразделение' }], employees: [{ employee_id: 7, employee_name: 'Учётный сотрудник' }] }, ...extra };
}
async function boot(page: Page, data = snapshot(), permissions = ['duty.view', 'duty.manage', 'dictionary.view']) {
  await signIn(page);
  let templates: Array<Record<string, unknown>> = [];
  await page.route('**/api/ops/duty-templates/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') return route.fulfill({ json: { results: templates, can_create: true, owner_choices: [{ id: 4, name: 'Первое подразделение' }], time_zone: 'Asia/Qyzylorda' } });
    const payload = request.postDataJSON();
    expect(payload.employee_id).toBeUndefined();
    expect(payload.actual_start).toBeUndefined();
    if (url.pathname.endsWith('/remove/')) { templates = templates.filter(row => !url.pathname.includes(String(row.id))); return route.fulfill({ json: { removed: true } }); }
    const row = { ...payload, owner_division_name: payload.owner_division_id ? 'Первое подразделение' : '', revision: payload.expected_revision + 1, can_manage: true, time_zone: 'Asia/Qyzylorda' };
    templates = [...templates.filter(item => item.id !== row.id), row];
    return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: row });
  });
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions, roles: [] } }));
  await page.route('**/api/ops/duty-register/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === api + 'kinds/') return route.fulfill({ json: kinds });
    if (url.pathname === api + 'choices/') return route.fulfill({ json: { results: [{ employee_id: 7, employee_name: 'Учётный сотрудник', division_id: 4, division_name: 'Первое подразделение', position_name: 'Сотрудник' }], count: 1, page: 1, page_size: 25 } });
    if (url.pathname.startsWith(api + 'requests/')) return route.fulfill({ json: { saved: false, record: null } });
    if (url.pathname === api + 'LOG:17/') return route.fulfill({ json: record() });
    if (url.pathname === api && route.request().method() === 'GET') return route.fulfill({ json: data });
    return route.fallback();
  });
  await page.goto(path + '?from=2026-10-13&to=2026-10-13');
}

function employeeGroup(index: number, extra: Record<string, unknown> = {}) {
  return { subject_key: `EMPLOYEE:${index}`, employee_id: String(index), employee_name: `Сотрудник ${index}`,
    record_count: 2, planned_minutes: 120, actual_record_minutes: 90, actual_minutes: 60, attention_count: 1,
    unknown_planned_count: 0, unknown_actual_count: 0, confirmed_actual_count: 1, ...extra };
}

for (const status of [403, 503]) test(`summary refresh reports ${status} and recovers without CSV controls`, async ({ page, businessWrites }) => {
  await boot(page, snapshot({ by_employee: [employeeGroup(7)] }));
  await page.getByRole('button', { name: 'По сотрудникам', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сотрудник 7', exact: true })).toBeVisible();
  let responseStatus = status;
  await page.route('**/api/ops/duty-register/?**', route => responseStatus === 200
    ? route.fulfill({ json: snapshot({ by_employee: [employeeGroup(7)] }) })
    : route.fulfill({ status: responseStatus, json: { detail: 'Отказ обновления сводки' } }));
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  responseStatus = 200;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сотрудник 7', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Выгрузить.*CSV/ })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('empty summary fits 320px and keeps read views without CSV controls', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await boot(page, snapshot({ rows: [], by_employee: [], by_kind: [], pagination: { count: 0, page: 1, pages: 1, page_size: 25 } }));
  await page.getByRole('button', { name: 'По сотрудникам', exact: true }).click();
  await expect(page.getByText('Нет данных в выбранном отборе.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Выгрузить.*CSV/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('journal presents administrative records, unknown facts and catalogue link', async ({ page, businessWrites }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /Требуют внимания/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Виды дежурств', exact: true })).toHaveAttribute('href', '/security-ops/dictionaries/SERVICE_DUTY_KINDS/');
  await expect(page.getByText('Учётный сотрудник', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Завершённых записей с неполным фактом: 1.', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('summary opens matching records and filters survive reload', async ({ page, businessWrites }) => {
  const reads: string[] = [];
  await boot(page);
  await page.route('**/api/ops/duty-register/?**', route => { reads.push(route.request().url()); return route.fulfill({ json: snapshot() }); });
  await page.getByRole('button', { name: /Требуют внимания/ }).click();
  await expect(page).toHaveURL(/attention=ANY/);
  await expect.poll(() => reads.some(url => new URL(url).searchParams.get('attention') === 'ANY')).toBeTruthy();
  await page.getByRole('form', { name: 'Фильтры журнала' }).locator('summary').click();
  await page.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('KUMBEZ');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect(page).toHaveURL(/kind=KUMBEZ/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Вид дежурства', exact: true })).toHaveValue('KUMBEZ');
  await expect(page.getByRole('combobox', { name: 'Отметки контроля', exact: true })).toHaveValue('ANY');
  expect(businessWrites).toEqual([]);
});

test('creation retains draft and UUID after a temporary save error', async ({ page, businessWrites }) => {
  await boot(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill(bodies.length === 1 ? { status: 503, json: { error_code: 'SERVER_ERROR', message: 'Временный отказ' } } : { status: 201, json: record() });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByLabel('Поиск сотрудника').fill('Учётный');
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('SAKSHY');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByLabel('Примечание').fill('Сохранить черновик');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('Примечание')).toHaveValue('Сохранить черновик');
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].client_request_id).toBeTruthy();
  expect(bodies[0]).toEqual(bodies[1]);
  expect(businessWrites).toEqual([]);
});

test('denied cached records stay hidden through the next temporary error', async ({ page, businessWrites }) => {
  await boot(page);
  await expect(page.getByText('Учётный сотрудник', { exact: true }).last()).toBeVisible();
  let status = 403;
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill({ status, json: { detail: 'Отказ чтения' } }));
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByText('Учётный сотрудник', { exact: true })).toHaveCount(0);
  status = 503;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Учётный сотрудник', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('journal keeps applied filters and print without CSV controls', async ({ page, businessWrites }) => {
  await boot(page, snapshot({ pagination: { count: 51, page: 1, pages: 3, page_size: 25 } }));
  await page.getByRole('form', { name: 'Фильтры журнала' }).locator('summary').click();
  await page.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect(page).toHaveURL(/kind=GBR/);
  await expect(page.getByRole('button', { name: /Выгрузить.*CSV/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('journal and detail fit a 320px viewport', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await boot(page);
  const longNote = 'Примечание ' + 'Ж'.repeat(180);
  await page.route('**/api/ops/duty-register/LOG:17/', route => route.fulfill({ json: record({ note: longNote }) }));
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: /Открыть запись/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Запись дежурства' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(longNote, { exact: true })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('detail records acknowledgement, actual start and completion as separate steps', async ({ page, businessWrites }) => {
  await boot(page);
  let current = record();
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/ops/duty-register/LOG:17/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: current });
    const action = new URL(route.request().url()).pathname.split('/').filter(Boolean).at(-1)!;
    const body = route.request().postDataJSON();
    calls.push({ action, body });
    if (action === 'acknowledge') current = record({ state: 'ACKNOWLEDGED', acknowledged_at: '2026-10-13T07:00:00+05:00', actions: ['start', 'cancel', 'classify', 'edit'] });
    if (action === 'start') current = record({ state: 'ACTIVE', acknowledged_at: '2026-10-13T07:00:00+05:00', actual_start: body.at + ':00+05:00', actions: ['complete', 'classify'] });
    if (action === 'complete') current = record({ state: 'COMPLETED', acknowledged_at: '2026-10-13T07:00:00+05:00', actual_start: '2026-10-13T08:00:00+05:00', actual_end: body.at + ':00+05:00', actual_minutes: 240, actions: ['classify'] });
    return route.fulfill({ json: current });
  });
  await page.getByRole('button', { name: /Открыть запись/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Запись дежурства' });
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Время отметки', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Подтверждение будет сохранено текущим временем сервера.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить отметку' }).click();
  await dialog.getByRole('button', { name: 'Отметить начало', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Время отметки', exact: true }).selectOption('RECORDED');
  await dialog.getByRole('textbox', { name: 'Фактическое время', exact: true }).fill('2026-10-13T08:00');
  await dialog.getByRole('button', { name: 'Сохранить отметку' }).click();
  await dialog.getByRole('button', { name: 'Отметить завершение', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Время отметки', exact: true }).selectOption('RECORDED');
  await dialog.getByRole('textbox', { name: 'Фактическое время', exact: true }).fill('2026-10-13T12:00');
  await dialog.getByRole('button', { name: 'Сохранить отметку' }).click();
  await expect(dialog.getByText('4 ч', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отменить запись', exact: true })).toHaveCount(0);
  expect(calls).toEqual([{ action: 'acknowledge', body: {} }, { action: 'start', body: { at: '2026-10-13T08:00' } }, { action: 'complete', body: { at: '2026-10-13T12:00' } }]);
  expect(businessWrites).toEqual([]);
});

test('creation sends an imported identifier beyond browser integer precision exactly', async ({ page, businessWrites }) => {
  await boot(page);
  const identifier = '9007199254740993';
  await page.route('**/api/ops/duty-register/choices/?**', route => route.fulfill({ json: { results: [{ employee_id: identifier, employee_name: 'Импортированный сотрудник', division_id: identifier, division_name: 'Дочернее подразделение', position_name: 'Сотрудник' }], count: 1, page: 1, page_size: 25 } }));
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: record({ employee_id: identifier, division_id: identifier }) });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await dialog.getByRole('button', { name: /Импортированный сотрудник/ }).click();
  await dialog.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await dialog.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await dialog.getByLabel('Плановое завершение').fill('2026-10-13T12:00');
  await dialog.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(dialog).not.toBeVisible();
  expect(payload?.employee_id).toBe(identifier);
  expect(businessWrites).toEqual([]);
});

test('dispatch saves catalogue kind and links that source record to the journal', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['duty.dispatch', 'object.view'], global_permissions: [], roles: [] } }));
  await page.route('**/api/ops/duty-register/kinds/', route => route.fulfill({ json: kinds }));
  const object = { id: '12', name: 'Учётный объект', code: 'TEST', objectState: 'ACTIVE', sectors: [{ id: '4', name: 'Сектор', posts: [{ id: '8', name: 'Пост' }] }] };
  await page.route('**/api/ops/objects/**', route => route.fulfill({ json: { results: [object] } }));
  const person = { employee_id: 7, full_name: 'Учётный сотрудник', department_name: 'Подразделение', directorate_name: '', position_name: 'Сотрудник', status_id: 501, status_label: 'Дежурство', date_start: '2026-10-13', date_end: '2026-10-15' };
  const assignment = { id: 11, employee_id: 7, full_name: person.full_name, source_status_id: 501, placement: { kind: 'POST', object_id: '12', object_name: object.name, post_id: '8', post_name: 'Пост', sector_name: 'Сектор' }, start_at: '2026-10-13T03:00:00Z', end_at: '2026-10-13T15:00:00Z', created_at: '2026-10-13T03:00:00Z', created_by: 'Автор', valid: true, cancelled_at: null, invalid_reason: null, service_duty_code: 'KUMBEZ', service_duty_label: 'Смена Кумбез' };
  let payload: Record<string, unknown> | undefined;
  let placed = false;
  await page.route('**/api/ops/duty-dispatch/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { business_date: '2026-10-13', receiver: { id: 18, name: 'Принимающий департамент' }, can_configure: false, can_assign: true, can_cancel: true, people: [person], assignments: placed ? [assignment] : [] } });
    payload = route.request().postDataJSON(); placed = true;
    return route.fulfill({ status: 201, json: assignment });
  });
  await page.goto('/security-ops/duty-dispatch/?date=2026-10-13');
  await page.getByRole('button', { name: 'Назначить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить дежурство' });
  await dialog.getByRole('combobox', { name: 'Вид по справочнику', exact: true }).selectOption('KUMBEZ');
  await dialog.getByRole('combobox', { name: /^Тип дежурства/ }).click();
  await page.getByRole('option', { name: 'Постовое', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Объект/ }).click();
  await page.getByRole('option', { name: object.name + ' (TEST)', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Пост/ }).click();
  await page.getByRole('option', { name: 'Пост (Сектор)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить назначение' }).click();
  await expect(dialog).not.toBeVisible();
  expect(payload?.service_duty_code).toBe('KUMBEZ');
  await page.getByRole('tab', { name: /^Расставлены/ }).click();
  await expect(page.getByRole('article')).toContainText('Смена Кумбез');
  await expect(page.getByRole('link', { name: 'Учёт смены', exact: true })).toHaveAttribute('href', /record=DISPATCH%3A11/);
  expect(businessWrites).toEqual([]);
});

for (const intervalKind of ['normal', 'short', 'edited', 'micro'] as const) test(`editing preserves exact planned timestamps: ${intervalKind}`, async ({ page, businessWrites }) => {
  await boot(page);
  const original = record(intervalKind === 'normal'
    ? { planned_start: '2026-10-13T08:00:37.123+05:00', planned_end: '2026-10-13T20:00:42.987+05:00' }
    : intervalKind === 'micro' ? { planned_start: '2026-10-13T12:00:01.100100+05:00', planned_end: '2026-10-13T12:00:01.100900+05:00' }
    : { planned_start: '2026-10-13T12:00:01.100+05:00', planned_end: `2026-10-13T12:0${intervalKind === 'edited' ? '1' : '0'}:59.900+05:00` });
  let patch: Record<string, unknown> | undefined;
  await page.route('**/api/ops/duty-register/LOG:17/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: original });
    patch = route.request().postDataJSON();
    return route.fulfill({ json: { ...original, note: patch?.note, revision: 2 } });
  });
  await page.getByRole('button', { name: /Открыть запись/ }).first().click();
  await page.getByRole('dialog', { name: 'Запись дежурства' }).getByRole('button', { name: 'Исправить план', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Исправить плановую запись' });
  await dialog.getByLabel('Примечание', { exact: true }).fill('Уточнено примечание');
  await dialog.getByLabel('Причина исправления').fill('Добавлено пояснение');
  if (intervalKind === 'edited') await dialog.getByLabel('Плановое начало').fill('2026-10-13T12:01');
  await dialog.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(dialog).not.toBeVisible();
  expect(patch?.planned_start ?? original.planned_start).toBe(intervalKind === 'edited' ? '2026-10-13T12:01' : original.planned_start);
  expect(patch?.planned_end ?? original.planned_end).toBe(original.planned_end);
  expect(businessWrites).toEqual([]);
});

for (const loadLatest of [false, true]) test(`stale planning edit preserves exact timestamps after ${loadLatest ? 'loading latest' : 'keeping draft'}`, async ({ page, businessWrites }) => {
  await boot(page);
  const original = record({ planned_start: '2026-10-13T08:00:37.123+05:00', planned_end: '2026-10-13T20:00:42.987+05:00' });
  const newer = record({ revision: 2, note: 'Изменение другого автора', planned_start: '2026-10-13T09:00:11.456+05:00', planned_end: '2026-10-13T21:00:22.654+05:00' });
  let current = original;
  const patches: Record<string, unknown>[] = [];
  await page.route('**/api/ops/duty-register/LOG:17/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: current });
    const body = route.request().postDataJSON(); patches.push(body);
    if (patches.length === 1) {
      current = newer;
      return route.fulfill({ status: 409, json: { error_code: 'DUTY_REGISTER_CONFLICT', message: 'Форма устарела.', details: {}, request_id: null, timestamp: '' } });
    }
    current = record({ revision: 3, note: body.note });
    return route.fulfill({ json: current });
  });
  await page.getByRole('button', { name: /Открыть запись/ }).first().click();
  await page.getByRole('dialog', { name: 'Запись дежурства' }).getByRole('button', { name: 'Исправить план', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Исправить плановую запись' });
  await dialog.getByLabel('Примечание', { exact: true }).fill('Мой черновик');
  await dialog.getByLabel('Причина исправления').fill('Уточнение');
  await dialog.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveValue('Мой черновик');
  await expect(dialog.getByText('Изменение другого автора', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Сохранить исправление' })).toBeDisabled();
  await dialog.getByRole('button', { name: loadLatest ? 'Загрузить актуальную редакцию' : 'Продолжить с моим черновиком' }).click();
  await dialog.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(dialog).not.toBeVisible();
  expect(patches).toHaveLength(2);
  expect(patches.map(body => body.expected_revision)).toEqual([1, 2]);
  const expected = loadLatest ? newer : original;
  expect(patches[1].note).toBe(loadLatest ? newer.note : 'Мой черновик');
  expect(patches[1].planned_start ?? expected.planned_start).toBe(expected.planned_start);
  expect(patches[1].planned_end ?? expected.planned_end).toBe(expected.planned_end);
  expect(businessWrites).toEqual([]);
});

test('first-load failure disables date presets until the server clock is available', async ({ page, businessWrites }) => {
  await boot(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let failed = true;
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill(failed
    ? { status: 503, json: { detail: 'Временный отказ' } } : { json: snapshot() }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сегодня', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '7 дней', exact: true })).toBeDisabled();
  failed = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByRole('button', { name: '7 дней', exact: true }).click();
  await expect(page).toHaveURL(/from=2026-10-07/);
  expect(errors).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('print includes the applied filters while draft controls are hidden', async ({ page, businessWrites }) => {
  await boot(page);
  await page.getByRole('form', { name: 'Фильтры журнала' }).locator('summary').click();
  for (const [name, value] of [['Вид дежурства', 'KUMBEZ'], ['Состояние', 'COMPLETED'], ['Подразделение', '4'], ['Сотрудник', '7'], ['Источник', 'LOG'], ['Отметки контроля', 'ANY']]) {
    await page.getByRole('combobox', { name, exact: true }).selectOption(value);
  }
  await page.getByRole('searchbox', { name: 'Поиск по записям' }).fill('Приказ');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect(page).toHaveURL(/kind=KUMBEZ/);
  await page.emulateMedia({ media: 'print' });
  const applied = page.getByRole('region', { name: 'Применённый отбор' });
  await expect(applied).toBeVisible();
  for (const value of ['Смена Кумбез', 'Завершено', 'Первое подразделение', 'Учётный сотрудник', 'Журнал', 'Требуют внимания', 'Приказ']) {
    await expect(applied.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('form', { name: 'Фильтры журнала' })).not.toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('invalid draft period explains the limit without sending a list request', async ({ page, businessWrites }) => {
  await boot(page);
  let reads = 0;
  await page.route('**/api/ops/duty-register/?**', route => { reads++; return route.fulfill({ json: snapshot() }); });
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeEnabled();
  const baseline = reads;
  await page.getByRole('textbox', { name: 'По дату включительно', exact: true }).fill('2026-10-12');
  await expect(page.getByText('Конечная дата должна быть не раньше начальной.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить фильтры' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'С даты', exact: true }).fill('2025-10-01');
  await expect(page.getByText('Выберите период не длиннее 366 дней.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Применить фильтры' })).toBeDisabled();
  expect(reads).toBe(baseline);
  expect(businessWrites).toEqual([]);
});

test('uncertain committed creation survives reload and recovers without another POST', async ({ page, businessWrites }) => {
  await boot(page);
  const bodies: Record<string, unknown>[] = [];
  let recovered = '';
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { detail: 'Ответ потерян после сохранения' } });
  });
  await page.route('**/api/ops/duty-register/requests/**', route => {
    recovered = new URL(route.request().url()).pathname.split('/').filter(Boolean).at(-1)!;
    return route.fulfill({ json: { saved: true, record: record({ note: 'Исходная попытка' }) } });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Исходная попытка');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await page.setViewportSize({ width: 320, height: 780 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveValue('Исходная попытка');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Запись дежурства' })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(recovered).toBe(bodies[0].client_request_id);
  expect(businessWrites).toEqual([]);
});

test('uncommitted network failure reopens the frozen attempt and retries its exact body', async ({ page, businessWrites }) => {
  await boot(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return bodies.length === 1 ? route.abort('connectionreset') : route.fulfill({ status: 201, json: record() });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('KUMBEZ');
  await form.getByLabel('Плановое начало').fill('2026-10-13T20:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-14T08:00');
  await form.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Не менять исходную попытку');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
  await page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveValue('Не менять исходную попытку');
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(businessWrites).toEqual([]);
});

test('a definitive validation rejection leaves creation fields editable', async ({ page, businessWrites }) => {
  await boot(page);
  await page.route('**/api/ops/duty-register/', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 422, json: { error_code: 'VALIDATION_ERROR', message: 'Уточните время записи.', details: {}, request_id: null, timestamp: '' } }) : route.fallback());
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('alert')).toHaveText('Уточните время записи.');
  await expect(form.getByRole('textbox', { name: 'Плановое завершение', exact: true })).toBeEnabled();
  await expect(form.getByRole('region', { name: 'Незавершённое сохранение' })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a creator with read access can confirm a pending save after write scope was removed', async ({ page, businessWrites }) => {
  await boot(page);
  await page.route('**/api/ops/duty-register/', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { detail: 'Ответ потерян' } }) : route.fallback());
  await page.route('**/api/ops/duty-register/requests/**', route => route.fulfill({ json: { saved: true, record: null } }));
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Закрытая исходная область');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('region', { name: 'Незавершённое сохранение' })).toBeVisible();
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view'], global_permissions: [], roles: [],
    duty_register_scope: { read: [5], write: [], plan: [], dispatch: [] } } }));
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill({ json: snapshot({ rows: [], by_kind: [], by_employee: [], filters: { employees: [], divisions: [] }, pagination: { count: 0, page: 1, pages: 1, page_size: 25 } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(form).not.toBeVisible();
  await page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByText('Запись сохранена. Просмотр в текущей области доступа недоступен.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить запись' })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a delayed recovery lookup cannot send a POST after the form scope changed', async ({ page, businessWrites }) => {
  await boot(page);
  let posts = 0;
  let release!: () => void;
  let entered = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    return posts === 1 ? route.fulfill({ status: 503, json: { detail: 'Ответ потерян' } }) : route.fulfill({ json: record() });
  });
  await page.route('**/api/ops/duty-register/requests/**', async route => {
    entered = true; await held;
    await route.fulfill({ json: { saved: false, record: null } });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect.poll(() => entered).toBeTruthy();
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view', 'duty.manage'], global_permissions: [], roles: [],
    duty_register_scope: { read: [5], write: [5], plan: [5], dispatch: [] } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(form).not.toBeVisible();
  const response = page.waitForResponse(value => value.url().includes('/duty-register/requests/'));
  release(); await response;
  await page.waitForTimeout(500);
  expect(posts).toBe(1);
  expect(businessWrites).toEqual([]);
});

for (const loseCloseResponse of [false, true]) test(`a rejected recovery can be durably closed ${loseCloseResponse ? 'after losing its response' : 'before correcting the draft'}`, async ({ page, businessWrites }) => {
  await boot(page);
  const bodies: Record<string, unknown>[] = [];
  let closed = false;
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('connectionreset');
    if (bodies.length === 2) return route.fulfill({ status: 422, json: { error_code: 'VALIDATION_ERROR', message: 'Вид больше недоступен.', details: {}, request_id: null, timestamp: '' } });
    return route.fulfill({ status: 201, json: record({ service_duty_code: 'SAKSHY' }) });
  });
  await page.route('**/api/ops/duty-register/requests/**', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().url()).toContain(String(bodies[0].client_request_id) + '/close/');
      closed = true;
      if (loseCloseResponse) return route.abort('connectionreset');
    }
    return route.fulfill({ json: { saved: false, closed, record: null } });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Сохранить черновик');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Вид больше недоступен.');
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Закрыть эту попытку', exact: true }).click();
  if (loseCloseResponse) {
    await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toBeDisabled();
    await expect(form.getByRole('button', { name: 'Проверить сохранение', exact: true })).toBeEnabled();
    await page.reload();
    await page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true }).click();
    await form.getByRole('button', { name: 'Проверить сохранение', exact: true }).click();
  }
  await expect(form.getByRole('region', { name: 'Незавершённое сохранение' })).toHaveCount(0);
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toBeEnabled();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveValue('Сохранить черновик');
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('SAKSHY');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form).not.toBeVisible();
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2].client_request_id).not.toBe(bodies[0].client_request_id);
  expect(bodies[2].note).toBe('Сохранить черновик');
  expect(businessWrites).toEqual([]);
});

test('closing a pending attempt finds a saved record without cancelling it', async ({ page, businessWrites }) => {
  await boot(page);
  let creates = 0;
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    creates++;
    return route.abort('connectionreset');
  });
  await page.route('**/api/ops/duty-register/requests/**', route => route.fulfill({ json: { saved: true, closed: false, record: record() } }));
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await form.getByRole('button', { name: 'Закрыть эту попытку', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Запись дежурства' })).toBeVisible();
  expect(creates).toBe(1);
  expect(businessWrites).toEqual([]);
});

test('a read-only creator closes a pending attempt without revealing its previous scope', async ({ page, businessWrites }) => {
  await boot(page);
  await page.route('**/api/ops/duty-register/', route => route.request().method() === 'POST' ? route.abort('connectionreset') : route.fallback());
  let closes = 0;
  await page.route('**/api/ops/duty-register/requests/**', route => {
    if (route.request().method() === 'POST') closes++;
    return route.fulfill({ json: { saved: false, closed: true, record: null } });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Сведения прежней области');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form.getByRole('region', { name: 'Незавершённое сохранение' })).toBeVisible();
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view'], global_permissions: [], roles: [],
    duty_register_scope: { read: [5], write: [], plan: [], dispatch: [] } } }));
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill({ json: snapshot({ rows: [], by_kind: [], by_employee: [], filters: { employees: [], divisions: [] }, pagination: { count: 0, page: 1, pages: 1, page_size: 25 } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(form).not.toBeVisible();
  await page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Примечание', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Закрыть эту попытку', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить запись', exact: true })).toHaveCount(0);
  expect(closes).toBe(1);
  expect(businessWrites).toEqual([]);
});

test('a delayed close cannot unlock a new draft after the form scope changed', async ({ page, businessWrites }) => {
  await boot(page);
  let creates = 0, closes = 0, entered = false;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    creates++;
    return route.abort('connectionreset');
  });
  await page.route('**/api/ops/duty-register/requests/**', async route => {
    closes++; entered = true; await held;
    await route.fulfill({ json: { saved: false, closed: true, record: null } });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await form.getByRole('button', { name: 'Закрыть эту попытку', exact: true }).click();
  await expect.poll(() => entered).toBeTruthy();
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view', 'duty.manage'], global_permissions: [], roles: [],
    duty_register_scope: { read: [5], write: [5], plan: [5], dispatch: [] } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(form).not.toBeVisible();
  const response = page.waitForResponse(value => value.url().includes('/duty-register/requests/'));
  release(); await response;
  await expect(page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true })).toHaveCount(0);
  await expect(form).not.toBeVisible();
  expect(creates).toBe(1); expect(closes).toBe(1);
  expect(businessWrites).toEqual([]);
});

test('large employee summary stays bounded and keeps its page in the URL', async ({ page, businessWrites }) => {
  const people = Array.from({ length: 95 }, (_, index) => ({ subject_key: 'EMPLOYEE:' + (index + 7), employee_id: index + 7,
    employee_name: 'Сотрудник сводки ' + (index + 1), record_count: 2, planned_minutes: 720, actual_record_minutes: 600,
    actual_minutes: 600, attention_count: 0, unknown_planned_count: 0, unknown_actual_count: 0, confirmed_actual_count: 2 }));
  await boot(page, snapshot({ by_employee: people }));
  await page.getByRole('button', { name: 'По сотрудникам', exact: true }).click();
  const results = page.getByRole('region', { name: 'Результаты журнала' });
  await expect(results.getByRole('article')).toHaveCount(40);
  const pages = page.getByRole('navigation', { name: 'Страницы сводки', exact: true });
  await expect(pages.getByText('Показано 1–40 из 95', { exact: true })).toBeVisible();
  await pages.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page).toHaveURL(/group_page=2/);
  await expect(results.getByRole('heading', { name: 'Сотрудник сводки 41', exact: true })).toBeVisible();
  await page.reload();
  await expect(pages.getByText('Показано 41–80 из 95', { exact: true })).toBeVisible();
  await expect(results.getByRole('article')).toHaveCount(40);
  await results.getByRole('article').first().getByRole('button', { name: 'Показать записи', exact: true }).click();
  await expect(page).toHaveURL(/employee_id=47/);
  await expect(page).not.toHaveURL(/group_page=/);
  expect(businessWrites).toEqual([]);
});

test('a denied record invalidates its cached list through a temporary refresh failure', async ({ page, businessWrites }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Учётный сотрудник', exact: true })).toBeVisible();
  let listFailed = true;
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill(listFailed
    ? { status: 503, json: { detail: 'Временный отказ списка' } } : { json: snapshot() }));
  await page.route('**/api/ops/duty-register/LOG:17/**', route => route.fulfill({ status: 403, json: { detail: 'Область записи отозвана' } }));
  await page.getByRole('button', { name: /Открыть запись/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Запись дежурства' });
  await expect(dialog.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByText('Учётный сотрудник', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeDisabled();
  listFailed = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Учётный сотрудник', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('creation still works when the browser has no randomUUID method', async ({ page, businessWrites }) => {
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }));
  await boot(page);
  let nonce = '';
  await page.route('**/api/ops/duty-register/', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    nonce = route.request().postDataJSON().client_request_id;
    return route.fulfill({ status: 201, json: record() });
  });
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись дежурства' });
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: /Учётный сотрудник/ }).click();
  await form.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await form.getByLabel('Плановое начало').fill('2026-10-13T08:00');
  await form.getByLabel('Плановое завершение').fill('2026-10-13T20:00');
  await form.getByRole('button', { name: 'Сохранить запись' }).click();
  await expect(form).not.toBeVisible();
  expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(businessWrites).toEqual([]);
});

test('expired temporary division grant hides old scoped data even if the new read fails', async ({ page, businessWrites }) => {
  await boot(page, snapshot({ rows: [record({ employee_name: 'Сотрудник временной области', division_id: 5 })] }));
  let narrow = false;
  let permissionReads = 0;
  await page.route('**/api/operations/my-permissions/', route => {
    permissionReads++;
    return route.fulfill({ json: { permissions: ['duty.view', 'duty.manage', 'dictionary.view'], global_permissions: [], roles: [], status_manage_division_ids: [],
      duty_register_scope: { read: narrow ? [4] : [4, 5], write: [4], plan: [4], dispatch: [] } } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => permissionReads).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Сотрудник временной области', exact: true })).toBeVisible();
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill({ status: 503, json: { detail: 'Временный отказ' } }));
  const before = permissionReads;
  narrow = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => permissionReads).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await expect(page.getByText('Сотрудник временной области', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('journal optional filters keep the complete draft when closed and applied', async ({ page, businessWrites }) => {
  await boot(page);
  const form = page.getByRole('form', { name: 'Фильтры журнала' });
  const disclosure = form.locator('details');
  const summary = disclosure.locator('summary');
  await expect(summary).toHaveText('Дополнительные фильтры · 0');
  await expect(disclosure).not.toHaveAttribute('open');
  for (const name of ['С даты', 'По дату включительно', 'Поиск по записям']) await expect(form.getByLabel(name, { exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Отметки контроля', exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Вид дежурства', exact: true })).not.toBeVisible();
  await summary.focus(); await summary.press('Enter');
  for (const [name, value] of [['Вид дежурства', 'KUMBEZ'], ['Состояние', 'ACTIVE'], ['Подразделение', '4'], ['Сотрудник', '7'], ['Источник', 'LOG']]) {
    await form.getByRole('combobox', { name, exact: true }).selectOption(value);
  }
  await form.getByLabel('Поиск по записям', { exact: true }).fill('Пост 2');
  await form.getByRole('combobox', { name: 'Отметки контроля', exact: true }).selectOption('ANY');
  await form.getByLabel('С даты', { exact: true }).fill('2026-10-10');
  await expect(summary).toHaveText('Дополнительные фильтры · 5');
  await summary.click();
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(page).not.toHaveURL(/kind=/);
  await form.getByRole('button', { name: 'Применить фильтры', exact: true }).click();
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ from: '2026-10-10', to: '2026-10-13', kind: 'KUMBEZ', state: 'ACTIVE', division_id: '4', employee_id: '7', source: 'LOG', attention: 'ANY', search: 'Пост 2' });
  await expect(disclosure).toHaveAttribute('open', '');
  await page.reload();
  await expect(summary).toHaveText('Дополнительные фильтры · 5');
  await expect(form.getByRole('combobox', { name: 'Вид дежурства', exact: true })).toHaveValue('KUMBEZ');
  await expect(form.getByLabel('Поиск по записям', { exact: true })).toHaveValue('Пост 2');
  await summary.click();
  await expect(page.getByRole('region', { name: 'Применённый отбор' }).getByText('Смена Кумбез', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Сбросить отбор', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('kind')).toBe(false);
  await expect(summary).toHaveText('Дополнительные фильтры · 0');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(form.getByLabel('С даты', { exact: true })).toHaveValue('2026-10-10');
  await page.setViewportSize({ width: 320, height: 780 });
  await summary.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
});

test('journal opens active optional filters even when the selected people have no period records', async ({ page, businessWrites }) => {
  await boot(page, snapshot({ filters: { divisions: [], employees: [] } }));
  await page.goto(path + '?from=2026-10-13&to=2026-10-13&kind=ARCHIVE&state=ACTIVE&source=STATUS&division_id=9007199254740993&employee_id=7');
  const form = page.getByRole('form', { name: 'Фильтры журнала' });
  await expect(form.locator('summary')).toHaveText('Дополнительные фильтры · 5');
  await expect(form.getByRole('combobox', { name: 'Подразделение', exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Подразделение', exact: true })).toHaveValue('9007199254740993');
  await expect(form.getByRole('combobox', { name: 'Сотрудник', exact: true })).toHaveValue('7');
  await expect(form.getByRole('combobox', { name: 'Вид дежурства', exact: true })).toHaveValue('ARCHIVE');
  await form.locator('summary').click();
  const applied = page.getByRole('region', { name: 'Применённый отбор' });
  for (const value of ['Архивный вид', 'Заступил', 'Выход из статуса сотрудника', 'ID 9007199254740993', 'ID 7']) await expect(applied.getByText(value, { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('empty journal guidance follows reader, creation, recovery and failed refresh actions', async ({ page, businessWrites }) => {
  const empty = snapshot({ rows: [], by_kind: [], by_employee: [], pagination: { count: 0, page: 1, pages: 1, page_size: 25 } });
  await boot(page, empty, ['duty.view']);
  const result = page.getByRole('region', { name: 'Результаты журнала' });
  const add = page.getByRole('button', { name: 'Добавить запись', exact: true });
  const recover = page.getByRole('button', { name: 'Проверить предыдущее сохранение', exact: true });
  for (const permission of ['duty.view', 'analytics.view', 'duty.dispatch']) {
    await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: [permission], roles: [] } }));
    await page.reload();
    await expect(result).toContainText('Измените период или сбросьте отбор.');
    await expect(result).not.toContainText('Добавить запись');
    await expect(add).toHaveCount(0);
    await expect(recover).toHaveCount(0);
  }
  await page.route('**/api/operations/my-permissions/', route => route.fulfill({ json: { permissions: ['duty.view', 'duty.manage'], roles: [] } }));
  await page.reload();
  await expect(add).toBeEnabled();
  await expect(result).toContainText('Добавить запись');
  const session = await (await page.request.get('/api/auth/session/')).json();
  await page.evaluate(actor => {
    sessionStorage.setItem('smart-josparlau:duty-create:' + encodeURIComponent(actor), JSON.stringify({ version: 1, scope: 'previous-scope', zone: 'Asia/Qyzylorda',
      body: { employee_id: 7, service_duty_code: 'GBR', client_request_id: 'a7dad977-c4bf-41ba-bb82-b384a98a7bb0', planned_start: '2026-10-13T08:00', planned_end: '2026-10-13T20:00', location_label: '', document_basis: '', note: '' },
      person: { employee_id: 7, employee_name: 'Учётный сотрудник', division_id: 4, division_name: 'Первое подразделение', position_name: 'Сотрудник' }, kindLabel: 'ГБР' }));
    window.dispatchEvent(new Event('smart-josparlau:duty-create-changed'));
  }, session.user.id ?? session.user.email ?? '');
  await expect(recover).toBeEnabled();
  await expect(result).toContainText('Проверить предыдущее сохранение');
  await expect(result).not.toContainText('Добавить запись');
  await expect(add).toHaveCount(0);
  await page.route('**/api/ops/duty-register/?**', route => route.fulfill({ status: 503, json: { detail: 'Временный отказ' } }));
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByText('Показаны ранее загруженные данные.', { exact: false })).toBeVisible();
  await expect(recover).toBeDisabled();
  await expect(result).toContainText('Измените период или сбросьте отбор.');
  await expect(result).not.toContainText('Проверить предыдущее сохранение');
  expect(businessWrites).toEqual([]);
});
