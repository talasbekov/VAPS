import { test, expect, signIn } from './ux-fixture';

const dictionaryPath = '/security-ops/dictionaries/SERVICE_DUTY_KINDS/';
const entriesApi = '**/api/ops/dictionaries/SERVICE_DUTY_KINDS/entries/';
function ownKind(label: string) {
  return { id: '1001', dictionaryCode: 'SERVICE_DUTY_KINDS', code: 'DUTY_' + 'A'.repeat(32), label, labelKk: '', description: '', isActive: true,
    groupCode: null, ownerDivisionId: null, updatedAt: '2026-10-13T12:00:00+05:00', inactiveSince: null, supersedes: null, supersededBy: null,
    usage: { status: 'TRACKED', reason: null, references: [], totalCount: 0 } };
}

for (const keyboard of [false, true]) test(`a custom duty kind needs a name and supports ${keyboard ? 'Enter' : 'the add button'} at 320px`, async ({ page, businessWrites }) => {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['dictionary.view', 'dictionary_value.manage'], roles: [] } }));
  let created: ReturnType<typeof ownKind> | null = null;
  const posts: Record<string, unknown>[] = [];
  await page.route(entriesApi, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { results: created ? [created] : [] } });
    const body = route.request().postDataJSON(); posts.push(body); created = ownKind(body.label);
    return route.fulfill({ status: 201, json: created });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(dictionaryPath);
  await expect(page.getByRole('heading', { name: 'Виды дежурств', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Код *', exact: true })).toHaveCount(0);
  const label = page.getByRole('textbox', { name: 'Название *', exact: true });
  await label.fill('Дежурный по внутреннему архиву');
  if (keyboard) await label.press('Enter'); else await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(label).toHaveValue('');
  expect(posts).toHaveLength(1);
  expect(posts[0].code ?? '').toBe('');
  expect(posts[0].label).toBe('Дежурный по внутреннему архиву');
  await expect(page.getByRole('row').filter({ hasText: 'Дежурный по внутреннему архиву' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('own-duty-kind-320.png'), fullPage: true, animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

test('an empty duty kind name cannot be submitted', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['dictionary.view', 'dictionary_value.manage'], roles: [] } }));
  await page.route(entriesApi, route => route.fulfill({ json: { results: [] } }));
  await page.goto(dictionaryPath);
  const label = page.getByRole('textbox', { name: 'Название *', exact: true });
  await label.fill('   ');
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled();
  expect(businessWrites).toEqual([]);
});

test('other catalogues retain their explicit code field', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.goto('/security-ops/dictionaries/RETURN_REASONS/');
  await expect(page.getByRole('textbox', { name: 'Код *', exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const width of [320, 390, 1440]) test(`duty kind names and opening fit the initial table viewport at ${width}px`, async ({ page, businessWrites }) => {
  await signIn(page);
  const row = ownKind('Дежурный по внутреннему архиву');
  await page.route(entriesApi, route => route.fulfill({ json: { results: [row] } }));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(dictionaryPath);
  const headers = page.getByRole('columnheader');
  await expect(headers.first()).toHaveText('Наименование (RU)');
  await expect(headers.nth(1)).toHaveText('Действия');
  const entry = page.getByRole('row').filter({ hasText: row.label });
  await expect(entry).toBeVisible();
  const opening = entry.getByRole('button', { name: 'Открыть', exact: true });
  for (const target of [entry.getByRole('cell').first(), opening]) {
    await expect.poll(async () => {
      const box = await target.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= width);
    }, { message: 'Name and opening must fit before any horizontal scrolling' }).toBeTruthy();
  }
  await opening.focus(); await opening.press('Enter');
  await expect(page.getByRole('button', { name: 'Корректировать', exact: true })).toBeVisible();
  expect(await page.getByRole('table').evaluate(table => table.parentElement?.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('named-duty-kind-' + width + '.png'), fullPage: true, animations: 'disabled' });
  expect(businessWrites).toEqual([]);
});

const states = { PLANNED: 'запланировано', ACKNOWLEDGED: 'подтверждено', ACTIVE: 'начато', COMPLETED: 'завершено' };
function assignment(state: keyof typeof states) {
  return { id: 11, employee_id: 7, full_name: 'Учётный сотрудник', department_name: 'Подразделение', source_status_id: 501,
    placement: { kind: 'POST', object_id: '12', object_name: 'Учётный объект', post_id: '8', post_name: 'Пост', sector_name: 'Сектор' },
    start_at: '2026-10-13T08:00:00+05:00', end_at: '2026-10-13T20:00:00+05:00', created_at: '2026-10-12T12:00:00+05:00', created_by: 'Автор',
    cancelled_at: null, valid: true, invalid_reason: null, service_duty_code: 'GBR', service_duty_label: 'ГБР', duty_record_id: 'DISPATCH:11',
    execution_state: state, can_cancel: state === 'PLANNED' || state === 'ACKNOWLEDGED' };
}
function queue(state: keyof typeof states) {
  return { business_date: '2026-10-13', time_zone: 'Asia/Qyzylorda', receiver: { id: 18, name: 'Принимающий департамент' }, receiver_options: [],
    can_configure: false, can_assign: false, can_cancel: true, access_reason: null, people: [], assignments: [assignment(state)] };
}

for (const state of Object.keys(states) as (keyof typeof states)[]) test(`dispatch explains ${state} execution and offers only an allowed removal`, async ({ page, businessWrites }) => {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['duty.dispatch', 'object.view'], roles: [] } }));
  await page.route('**/api/ops/duty-dispatch/**', route => route.fulfill({ json: queue(state) }));
  await page.goto('/security-ops/duty-dispatch/?date=2026-10-13');
  const card = page.getByRole('article');
  await expect(card.getByText('Исполнение: ' + states[state], { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Снять назначение', exact: true })).toHaveCount(assignment(state).can_cancel ? 1 : 0);
  await expect(card.getByRole('link', { name: 'Учёт смены', exact: true })).toHaveAttribute('href', /record=DISPATCH%3A11/);
  expect(businessWrites).toEqual([]);
});

test('an open removal keeps its reason and disables another attempt when execution started', async ({ page, businessWrites }) => {
  await signIn(page);
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['duty.dispatch', 'object.view'], roles: [] } }));
  let started = false, posts = 0;
  await page.route('**/api/ops/duty-dispatch/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: queue(started ? 'ACTIVE' : 'PLANNED') });
    started = true; posts++;
    return route.fulfill({ status: 422, json: { error_code: 'INVALID_STATE_TRANSITION', message: 'Начатую смену нельзя снять.', details: {}, request_id: null, timestamp: '' } });
  });
  await page.goto('/security-ops/duty-dispatch/?date=2026-10-13');
  await page.getByRole('button', { name: 'Снять назначение', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Снять назначение' });
  await form.getByRole('textbox', { name: 'Причина', exact: true }).fill('Моя причина');
  await form.getByRole('button', { name: 'Подтвердить снятие', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Подтвердить снятие', exact: true })).toBeDisabled();
  await expect(form.getByRole('textbox', { name: 'Причина', exact: true })).toHaveValue('Моя причина');
  expect(posts).toBe(1);
  expect(businessWrites).toEqual([]);
});
