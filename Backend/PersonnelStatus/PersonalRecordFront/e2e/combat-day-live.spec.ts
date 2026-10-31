import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

test.skip(process.env.SMOKE_LIVE !== '1', 'Requires isolated live Yandex QA runtime and fixture.');
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3317';
const boardPath = '/api/ops/combat-duty-board/';
interface Fixture { tag: string; password: string; accounts: Record<string, { login: string }>; own: string; other: string; ownName: string; today: string; tomorrow: string; people: { id: string; name: string }[]; eventId: string; eventTitle: string; types: { id: string; code: string }[] }
const load = (): Fixture => { if (!process.env.COMBAT_WALK_FIXTURE) throw new Error('COMBAT_WALK_FIXTURE is required.'); return JSON.parse(fs.readFileSync(process.env.COMBAT_WALK_FIXTURE, 'utf8')); };
const output = () => process.env.COMBAT_WALK_OUTPUT ?? test.info().outputDir;
async function signIn(browser: Browser, fixture: Fixture, role: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Qyzylorda', locale: 'ru-RU' });
  const csrf = await (await context.request.get(base + '/api/auth/csrf/')).json();
  await context.request.post(base + '/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: fixture.accounts[role].login, password: fixture.password, json: 'true', callbackUrl: base + '/workspace/' } });
  expect((await (await context.request.get(base + '/api/auth/session/')).json()).user, `session ${role}`).toBeTruthy();
  const token = await (await context.request.post(base + '/api/token/', { data: { username: fixture.accounts[role].login, password: fixture.password } })).json();
  expect(typeof token.access).toBe('string');
  const page = await context.newPage();
  return { context, page, headers: { Authorization: `Bearer ${token.access}` } };
}
async function board(page: Page, f: Fixture, date: string) {
  await page.goto(base + '/security-ops/duty-register/?' + new URLSearchParams({ section: 'combat', date, combat_division: f.own }));
  await expect(page.getByRole('region', { name: 'Расчёт боевого дежурства на день' })).toBeVisible();
  await expect(page.getByText('Загружаем расчёт…')).toHaveCount(0);
  await expect(page.getByLabel('Подразделение расчёта')).toHaveValue(f.own);
  await expect(page.getByRole('navigation', { name: 'Расчёт на неделю' }).getByRole('button')).toHaveCount(7);
}
async function confirm(page: Page) { await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); }

test('daily combat groups: department head → headquarters → linked employees → handover; foreign department denied', async ({ browser }) => {
  const f = load(); fs.mkdirSync(output(), { recursive: true });
  const roles: Record<string, Awaited<ReturnType<typeof signIn>>> = {};
  const contexts: BrowserContext[] = []; const errors: string[] = [];
  try {
    for (const role of ['head', 'hq', 'employee', 'foreign', 'observer']) {
      roles[role] = await signIn(browser, f, role); contexts.push(roles[role].context);
      roles[role].page.on('pageerror', e => errors.push(`${role}: ${e.message}`));
      roles[role].page.on('console', message => { if (message.type() === 'error') errors.push(`${role}: ${message.text()}`); });
      roles[role].page.on('response', r => { if (r.status() >= 500) errors.push(`${role}: ${r.status()} ${new URL(r.url()).pathname}`); });
    }
    const head = roles.head.page;
    await board(head, f, f.tomorrow);
    await expect(head.getByRole('link', { name: 'Сотрудники подразделения', exact: true })).toBeVisible();
    const expenseDuty = () => head.getByRole('region', { name: 'Расход на выбранную дату' }).getByText('На дежурстве', { exact: true }).locator('..').locator('dd');
    await expect(expenseDuty()).toHaveText('0');
    await head.getByRole('button', { name: 'Справочники подразделения', exact: true }).click();
    await head.getByLabel('Наименование записи справочника').fill(`${f.tag}-БГ-1`);
    await head.getByLabel('Предельная численность группы').fill('3');
    await head.getByRole('button', { name: 'Добавить запись', exact: true }).click();
    await expect(head.getByRole('region', { name: 'Справочники боевого дежурства' }).getByRole('listitem').filter({ hasText: `${f.tag}-БГ-1 · до 3 чел.` })).toBeVisible();
    const choices = await (await roles.head.context.request.get(base + boardPath + `choices/?date=${f.tomorrow}&division_id=${f.own}`, { headers: roles.head.headers })).json();
    const group = choices.groups.find((g: { name: string }) => g.name === `${f.tag}-БГ-1`);
    expect(group).toBeTruthy();
    expect(choices.groups.every((g: { divisionId: string }) => g.divisionId === f.own)).toBeTruthy();
    await head.getByRole('button', { name: 'Сформировать группу', exact: true }).click();
    const form = head.getByRole('dialog');
    await form.getByLabel('Группа', { exact: true }).selectOption(group.id);
    await form.getByLabel('Вид дежурства', { exact: true }).selectOption(f.types.find(t => t.code === 'DAY')!.id);
    await expect(form.getByLabel(`Добавить: ${f.people[3].name}`, { exact: true })).toBeDisabled();
    for (const person of f.people.slice(0, 2)) await form.getByLabel(`Добавить: ${person.name}`, { exact: true }).click();
    await form.getByLabel(`Водитель: ${f.people[1].name}`, { exact: true }).check();
    await form.getByLabel('Тип места службы').selectOption('POINT');
    await form.getByLabel('Широта общей точки').fill('51.13'); await form.getByLabel('Долгота общей точки').fill('71.43');
    await form.getByLabel('Охранное мероприятие группы').selectOption(f.eventId);
    await form.getByRole('button', { name: 'Добавить технику', exact: true }).click();
    await form.getByLabel('Наименование техники 1').fill('Проверочный автомобиль'); await form.getByLabel('Количество техники 1').fill('2');
    await form.getByRole('button', { name: 'Приблизить карту', exact: true }).click();
    await expect(form).toBeVisible();
    await form.getByLabel('Поиск улицы или района').fill('Республика');
    await form.getByLabel('Поиск улицы или района').press('Enter');
    await expect(form).toBeVisible();
    await form.evaluate(node => { node.scrollTop = 0; });
    await head.screenshot({ path: path.join(output(), 'head-form-tomorrow.png'), fullPage: true });
    await form.getByLabel('Широта общей точки').scrollIntoViewIfNeeded();
    await head.screenshot({ path: path.join(output(), 'head-map-point.png'), fullPage: true });
    await form.getByRole('button', { name: 'Подать состав и обновить расход' }).click(); await expect(form).toHaveCount(0);
    let card = head.getByTestId('combat-group-card').filter({ hasText: `${f.tag}-БГ-1` });
    await expect(card).toContainText('На рассмотрении'); await expect(card).toContainText(f.eventTitle);
    await expect(expenseDuty()).toHaveText('2');
    const snapshot = await (await roles.head.context.request.get(base + boardPath + `?date=${f.tomorrow}&division_id=${f.own}`, { headers: roles.head.headers })).json();
    const shift = snapshot.shifts.find((s: { groupId: string }) => s.groupId === group.id);
    expect(snapshot.summary).toMatchObject({ people: 2, vehicles: 2, formedGroups: 1 });
    const statusRows = await (await roles.head.context.request.get(base + `/api/operations/statuses/?business_date=${f.tomorrow}&division_id=${f.own}&limit=1000`, { headers: roles.head.headers })).json();
    expect(statusRows.results.filter((s: { source_ref?: string }) => s.source_ref === `combat:${shift.id}`)).toHaveLength(2);
    await head.screenshot({ path: path.join(output(), 'head-board-tomorrow.png'), fullPage: true });
    // A different department cannot read the roster or alter its catalogues by ID.
    expect((await roles.foreign.context.request.get(base + boardPath + `${shift.id}/`, { headers: roles.foreign.headers })).status()).toBe(403);
    expect((await roles.foreign.context.request.patch(base + `/api/ops/combat-catalogs/${group.id}/?kind=groups`, { headers: roles.foreign.headers, data: { name: 'Foreign edit' } })).status()).toBe(403);
    await board(roles.observer.page, f, f.tomorrow);
    await expect(roles.observer.page.getByRole('link', { name: 'Сотрудники подразделения', exact: true })).toHaveCount(0);
    await expect(roles.observer.page.getByRole('button', { name: 'Сформировать группу', exact: true })).toHaveCount(0);
    await expect(roles.observer.page.getByRole('button', { name: 'Принять состав', exact: true })).toHaveCount(0);
    // Return, resubmit and cancel through the actual role screens.
    await board(roles.hq.page, f, f.tomorrow);
    await roles.hq.page.getByRole('button', { name: 'Вернуть', exact: true }).click(); await roles.hq.page.getByLabel('Причина действия с группой').fill('Уточнить место службы'); await confirm(roles.hq.page);
    await board(head, f, f.tomorrow); await head.getByRole('button', { name: 'Исправить и подать повторно' }).click();
    await head.getByRole('dialog').getByRole('button', { name: 'Подать состав и обновить расход' }).click(); await expect(head.getByRole('dialog')).toHaveCount(0);
    await head.getByRole('button', { name: 'Отменить группу', exact: true }).click(); await head.getByLabel('Причина действия с группой').fill('Проверка отмены будущего назначения'); await confirm(head);
    await expect(expenseDuty()).toHaveText('0');
    // Today's assignment exercises actual start/handover without changing server time.
    const response = await roles.head.context.request.post(base + boardPath, { headers: roles.head.headers, data: { businessDate: f.today, groupId: group.id, dutyTypeId: f.types.find(t => t.code === 'DAY')!.id, members: f.people.slice(0, 2).map((p, i) => ({ employeeId: p.id, isLeader: i === 0, isDriver: i === 1 })), location: { kind: 'POST', objectId: choices.places[0].objectId, postId: choices.places[0].posts[0].id }, eventId: f.eventId, equipment: [] } });
    expect(response.status()).toBe(201);
    await board(roles.hq.page, f, f.today); await roles.hq.page.getByRole('button', { name: 'Принять состав', exact: true }).click(); await confirm(roles.hq.page);
    await board(head, f, f.today);
    for (const [outgoing, incoming] of [[f.people[1], f.people[2]], [f.people[2], f.people[1]]]) {
      await head.getByRole('button', { name: 'Заменить участника', exact: true }).click(); await head.getByLabel('Причина действия с группой').fill('Проверка переноса назначения'); await head.getByLabel('Заменяемый участник').selectOption(outgoing.id); await head.getByLabel('Новый участник').selectOption(incoming.id); await confirm(head);
    }
    await head.goto(base + '/statuses/');
    const employeeRow = head.getByRole('row').filter({ hasText: f.people[0].name.split(' ')[0] });
    await expect(employeeRow).toContainText('На дежурстве');
    await expect(employeeRow).toContainText('Групповое');
    await expect(employeeRow).toContainText(`${f.tag}-БГ-1`);
    await expect(employeeRow).toContainText('Пост 1');
    await expect(employeeRow).toContainText(f.eventTitle);
    await head.screenshot({ path: path.join(output(), 'statuses-group-place.png'), fullPage: true });
    await employeeRow.getByRole('link', { name: `${f.tag}-БГ-1`, exact: true }).click();
    await expect(head.getByTestId('combat-group-card').filter({ hasText: `${f.tag}-БГ-1` })).toBeVisible();
    for (const role of ['employee', 'head']) {
      const page = roles[role].page; await page.goto(base + '/security-ops/profile/');
      await expect(page.getByRole('region', { name: 'Мои боевые дежурства' })).toBeVisible();
      await page.getByRole('region', { name: 'Мои боевые дежурства' }).getByRole('button', { name: 'Ознакомлен, заступлю', exact: true }).click(); await confirm(page);
    }
    await head.getByRole('region', { name: 'Мои боевые дежурства' }).getByRole('button', { name: 'Отметить заступление' }).click(); await confirm(head);
    await expect(head.getByRole('region', { name: 'Мои боевые дежурства' })).toContainText('Дежурит');
    await head.screenshot({ path: path.join(output(), 'leader-active-profile.png'), fullPage: true });
    await head.getByRole('button', { name: 'Сдать смену', exact: true }).click(); await head.getByLabel('Замечания по сдаче').fill('Проверка: без замечаний'); await confirm(head);
    await head.getByRole('button', { name: 'Завершить дежурство', exact: true }).click(); await confirm(head);
    await expect(head.getByRole('region', { name: 'Мои боевые дежурства' })).toContainText('Завершена');
    await board(roles.hq.page, f, f.today); await roles.hq.page.screenshot({ path: path.join(output(), 'hq-completed.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await Promise.allSettled(contexts.map(context => context.close())); }
});

test('group formation remains usable on a narrow screen with equipment', async ({ browser }) => {
  const f = load(); const { context, page } = await signIn(browser, f, 'head');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await board(page, f, f.tomorrow);
    await page.getByRole('button', { name: 'Сформировать группу', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Добавить технику', exact: true }).click();
    await form.getByLabel('Наименование техники 1').fill('Проверочный автомобиль группы');
    await form.getByLabel('Количество техники 1').scrollIntoViewIfNeeded();
    expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The form must fit without horizontal scrolling').toBeTruthy();
    await page.screenshot({ path: path.join(output(), 'head-form-mobile.png'), fullPage: true });
    await form.getByRole('button', { name: 'Подать состав и обновить расход' }).scrollIntoViewIfNeeded();
    expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The action buttons must stay within the form').toBeTruthy();
  } finally { await context.close(); }
});
