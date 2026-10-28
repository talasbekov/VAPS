import fs from 'node:fs';
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

type Role = 'chief' | 'officer' | 'reader';
type Division = 'department' | 'mine' | 'child' | 'foreignDepartment' | 'foreign';
type Person = 'own' | 'child' | 'foreign';
interface Fixture {
  database: string;
  origin: string;
  runId: string;
  businessDate: string;
  divisions: Record<Division, { id: number; name: string }>;
  people: Record<Person, { id: number; name: string }>;
  users: Record<Role, { id: number; username: string; role: string; scope: number; permissions: string[] }>;
  expected: { ownRoster: number; ownStaff: number; ownVacancies: number };
  superusers: number;
}

function readFixture(origin: string): Fixture {
  const value = JSON.parse(fs.readFileSync(process.env.DAILY_ACCEPTANCE_FIXTURE_PATH as string, 'utf8')) as Fixture;
  const positiveId = (id: unknown): boolean => Number.isSafeInteger(id) && Number(id) > 0;
  if (!value.database?.startsWith('sj_daily_acceptance_') || value.origin !== origin ||
      !/^[a-f0-9]{32}$/.test(value.runId) || !/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate) ||
      new Date(value.businessDate + 'T00:00:00Z').toISOString().slice(0, 10) !== value.businessDate ||
      value.superusers !== 0 || value.expected?.ownRoster !== 2 || value.expected.ownStaff !== 3 || value.expected.ownVacancies !== 1 ||
      !(['chief', 'officer', 'reader'] as const).every(role => positiveId(value.users?.[role]?.id) &&
        value.users[role].username === `qa_daily_${value.runId}_${role}` && positiveId(value.users[role].scope)) ||
      !(['department', 'mine', 'child', 'foreignDepartment', 'foreign'] as const).every(key =>
        positiveId(value.divisions?.[key]?.id) && typeof value.divisions[key].name === 'string' && value.divisions[key].name.length > 0) ||
      !(['own', 'child', 'foreign'] as const).every(key => positiveId(value.people?.[key]?.id) &&
        typeof value.people[key].name === 'string' && value.people[key].name.length > 0)) {
    throw new Error('Expected origin-bound metadata for one fresh sj_daily_acceptance database and its unique synthetic identities.');
  }
  const expectedPermissions: Record<Role, string[]> = {
    chief: ['status.view', 'status.manage', 'daily_report.mark_update'],
    officer: ['status.view', 'daily_report.generate'], reader: ['status.view'],
  };
  for (const role of ['chief', 'officer', 'reader'] as const) {
    expect([...value.users[role].permissions].sort()).toEqual(expectedPermissions[role].sort());
  }
  expect(value.users.officer.role).toBe('DEPARTMENT_EXPENSE_OFFICER');
  expect(value.users.chief.scope).toBe(value.divisions.mine.id);
  expect(value.users.reader.scope).toBe(value.divisions.mine.id);
  expect(value.users.officer.scope).toBe(value.divisions.department.id);
  expect(new Set(Object.values(value.people).map(person => person.id)).size).toBe(3);
  expect(new Set(Object.values(value.divisions).map(division => division.id)).size).toBe(5);
  expect(new Set(Object.values(value.users).map(user => user.id)).size).toBe(3);
  return value;
}

test('real daily expense: scoped submission, pinned composition and explicit send', async ({ browser, baseURL }, testInfo) => {
  const origin = baseURL as string;
  const fixture = readFixture(origin);
  const password = process.env.DAILY_ACCEPTANCE_PASSWORD as string;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const saved: Record<string, unknown> = {};
  const save = (name: string, value: unknown) => { saved[name] = value; };
  const errors: string[] = [];
  const checks: unknown[] = [];
  const trace: { role?: string; method: string; path: string; status: number }[] = [];
  const writes: { role: Role; path: string; body: unknown }[] = [];
  const blockedWrites: { role: Role; path: string; reason: string }[] = [];
  const selectedDate = new Date(fixture.businessDate + 'T00:00:00Z');
  selectedDate.setUTCDate(selectedDate.getUTCDate() + 1);
  const businessDate = selectedDate.toISOString().slice(0, 10);
  const end = new Date(selectedDate);
  end.setUTCDate(end.getUTCDate() + 1);
  const row = (id: number) => ({ employee_id: id, status_type_code: 'VACATION', date_start: businessDate, date_end: end.toISOString().slice(0, 10) });

  // Actual requests continue to Django. Validate all browser mutation payloads
  // before dispatch and abort anything outside this one synthetic workflow.
  const watchWrites = async (context: BrowserContext, role: Role) => {
    await context.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/auth/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      try {
        expect(request.method()).toBe('POST');
        const body = request.postDataJSON() as Record<string, unknown>;
        if (role === 'chief' && pathname === '/api/operations/statuses/') {
          expect(body).toEqual({ ...row(fixture.people.own.id), participations: [] });
        } else {
          const division = role === 'chief' ? fixture.divisions.mine.id : fixture.divisions.department.id;
          const expectedPath = role === 'chief' ? '/api/ops/daily/daily-submissions/' : '/api/operations/daily-summaries/';
          expect([expectedPath, ...(role === 'officer' ? ['/api/operations/daily-summaries/send/'] : [])]).toContain(pathname);
          expect(String(body.division_id)).toBe(String(division));
          expect(body.business_date).toBe(businessDate);
          const extras = pathname === '/api/operations/daily-summaries/' ? { allow_incomplete: true } :
            pathname === '/api/operations/daily-summaries/send/' ? { reason: '' } : {};
          expect(body).toEqual({ division_id: body.division_id, business_date: businessDate, ...extras });
        }
        expect(writes.some(write => write.path === pathname)).toBe(false);
        writes.push({ role, path: pathname, body });
        return route.continue();
      } catch (error) {
        blockedWrites.push({ role, path: pathname, reason: String(error) });
        return route.abort('blockedbyclient');
      }
    });
  };

  try {
    const apis = {} as Record<Role, APIRequestContext>;
    for (const role of ['chief', 'officer', 'reader'] as const) {
      const api = await browser.newContext({ baseURL: origin });
      contexts.push(api);
      const tokenResponse = await api.request.post('/api/token/', { data: { username: fixture.users[role].username, password } });
      expect(tokenResponse.status()).toBe(200);
      const access = (await tokenResponse.json()).access;
      const claims = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8')) as { user_id: number | string };
      expect(String(claims.user_id)).toBe(String(fixture.users[role].id));
      await api.setExtraHTTPHeaders({ Authorization: 'Bearer ' + access });
      apis[role] = api.request;
      const permissions = await (await api.request.get('/api/operations/my-permissions/')).json();
      expect(permissions.permissions.sort()).toEqual([...fixture.users[role].permissions].sort());
      expect(permissions.global_permissions).toEqual([]);
      expect(permissions.roles).toEqual([expect.objectContaining({
        code: fixture.users[role].role, scope_division_id: fixture.users[role].scope,
      })]);
      checks.push({ role, check: 'exact scoped permissions', passed: true });
    }
    const denied = async (role: Role, method: 'get' | 'post', endpoint: string, data: unknown, label: string) => {
      const response = await apis[role][method](endpoint, data === undefined ? undefined : { data });
      const body = await response.json();
      expect(response.status(), label + JSON.stringify(body)).toBe(403);
      checks.push({ role, check: label, status: response.status(), body });
    };
    for (const [person, division] of [['own', 'mine'], ['child', 'child']] as const) {
      const response = await apis.chief.get('/api/ops/daily/employees/?division_id=' + fixture.divisions[division].id);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.results).toEqual([expect.objectContaining({ id: String(fixture.people[person].id),
        full_name: fixture.people[person].name, division_id: fixture.divisions[division].id })]);
    }
    await denied('chief', 'get', '/api/ops/daily/employees/?division_id=' + fixture.divisions.foreign.id + '&business_date=' + businessDate, undefined, 'foreign personnel read');
    await denied('chief', 'post', '/api/ops/daily/statuses-bulk/', { business_date: businessDate, rows: [row(fixture.people.foreign.id)] }, 'foreign status write');
    await denied('chief', 'post', '/api/ops/daily/daily-submissions/', { division_id: fixture.divisions.foreign.id, business_date: businessDate }, 'foreign submission');
    await denied('reader', 'post', '/api/ops/daily/statuses-bulk/', { business_date: businessDate, rows: [row(fixture.people.own.id)] }, 'reader cannot write own status');
    await denied('reader', 'post', '/api/ops/daily/daily-submissions/', { division_id: fixture.divisions.mine.id, business_date: businessDate }, 'reader cannot submit');
    await denied('officer', 'post', '/api/ops/daily/statuses-bulk/', { business_date: businessDate, rows: [row(fixture.people.own.id)] }, 'officer cannot write status');
    await denied('officer', 'post', '/api/operations/daily-summaries/', { division_id: fixture.divisions.foreignDepartment.id, business_date: businessDate }, 'foreign summary assembly');
    save('negative-access.json', checks);
    const listed = await (await apis.chief.get('/api/ops/daily/daily-submissions/?business_date=' + businessDate)).json();
    expect(listed.results).toEqual([]);
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda', serviceWorkers: 'block' });
    contexts.push(context);
    await watchWrites(context, 'chief');
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) trace.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    });
    const csrf = await (await page.request.get('/api/auth/csrf/')).json();
    const login = await page.request.post('/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: fixture.users.chief.username, password, json: 'true' } });
    expect((await login.json()).url).not.toContain('error=');
    const session = await (await page.request.get('/api/auth/session/')).json();
    expect(session.error).toBeUndefined();
    expect(session.user?.name).toBe(fixture.users.chief.username);
    await page.goto('/daily-expense/?businessDate=' + fixture.businessDate);
    const group = page.getByRole('group', { name: new RegExp('^' + fixture.divisions.mine.name) });
    await expect(group).toBeVisible({ timeout: 20000 });
    if (businessDate !== fixture.businessDate) {
      const dateParts = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
      }).formatToParts(new Date(fixture.businessDate + 'T00:00:00Z'));
      const initialLabel = ['day', 'month', 'year'].map(type => dateParts.find(part => part.type === type)?.value).join(' ');
      await page.getByRole('button', { name: initialLabel, exact: true }).click();
      const calendar = page.locator('[data-slot="popover-content"]');
      const grid = calendar.getByRole('grid');
      await expect(grid).toBeVisible();
      const selectedDay = calendar.locator('button[data-day="' + selectedDate.toLocaleDateString('ru-RU', { timeZone: 'UTC' }) + '"]');
      // DayPicker opens the browser's current month, even when its selected
      // date belongs to the next month. Follow the rendered month, boundedly.
      for (let step = 0; step < 3 && !(await selectedDay.isVisible()); step += 1) {
        const caption = await grid.getAttribute('aria-label');
        expect(caption).toBeTruthy();
        await calendar.getByRole('button', { name: 'Следующий месяц', exact: true }).click();
        await expect(grid).not.toHaveAttribute('aria-label', caption as string);
      }
      await selectedDay.click();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(new RegExp('businessDate=' + businessDate));
      checks.push({ check: 'calendar changes the business date and URL', businessDate, passed: true });
    }
    await group.locator('button[aria-expanded]').click();
    await expect(group.getByText('1 списочно', { exact: true })).toBeVisible();
    await expect(group.getByText(fixture.people.own.name, { exact: false })).toBeVisible();
    await expect(page.getByText(fixture.people.foreign.name, { exact: false })).toHaveCount(0);
    await group.getByRole('button', { name: 'Проставить', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Статус', exact: true }).click();
    await page.getByRole('option', { name: 'В отпуске', exact: true }).click();
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/operations/statuses/');
    await dialog.getByRole('button', { name: 'Проставить', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const createdBody = await createdResponse.json();
    expect(createdBody.date_start).toBe(businessDate);
    expect(createdBody.date_end).toBe(end.toISOString().slice(0, 10));
    expect(createdBody.created_by).toBe(String(fixture.users.chief.id));
    save('created-status.json', createdBody);
    await expect(dialog).toHaveCount(0);
    await expect(group.getByText('В отпуске', { exact: true })).toBeVisible();
    await group.getByRole('button', { name: /^(Сдать день|Проверить и сдать)$/ }).click();
    await expect(group.getByText(/Сотрудников по списку: 2\./)).toBeVisible();
    await group.getByRole('button', { name: 'Отмена', exact: true }).click();
    const afterCancel = await (await apis.chief.get('/api/ops/daily/daily-submissions/?business_date=' + businessDate)).json();
    expect(afterCancel.results).toEqual([]);
    await group.getByRole('button', { name: /^(Сдать день|Проверить и сдать)$/ }).click();
    const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/ops/daily/daily-submissions/');
    await group.getByRole('button', { name: 'Подтвердить сдачу', exact: true }).click();
    const submittedResponse = await submitted;
    expect(submittedResponse.status()).toBe(201);
    const submission = await submittedResponse.json();
    save('submission.json', submission);
    await expect(group.getByText(/День сдан: v1/)).toBeVisible();
    const detail = await (await apis.chief.get('/api/operations/daily-submissions/' + submission.id + '/')).json();
    save('submission-detail.json', detail);
    expect(detail.snapshot.roster.map((person: { employee_id: number }) => person.employee_id).sort()).toEqual([fixture.people.own.id, fixture.people.child.id].sort());
    expect(detail.snapshot.rows).toHaveLength(1);
    expect(detail.snapshot.rows[0].employee_id).toBe(fixture.people.own.id);
    expect(detail.snapshot.rows[0].status_type_code).toBe('VACATION');
    checks.push({ check: 'cancel did not submit; confirmed subtree snapshot contains two own people and one vacation', passed: true });
    await page.screenshot({ path: testInfo.outputPath('chief.png'), fullPage: true });
    const officerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', timezoneId: 'Asia/Qyzylorda', serviceWorkers: 'block' });
    contexts.push(officerContext);
    await watchWrites(officerContext, 'officer');
    const officerPage = await officerContext.newPage();
    pages.push(officerPage);
    officerPage.on('pageerror', error => errors.push(error.message));
    officerPage.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) trace.push({ role: 'officer', method: response.request().method(), path: url.pathname, status: response.status() });
    });
    const officerCsrf = await (await officerPage.request.get('/api/auth/csrf/')).json();
    const officerLogin = await officerPage.request.post('/api/auth/callback/credentials/', { form: { csrfToken: officerCsrf.csrfToken, username: fixture.users.officer.username, password, json: 'true' } });
    expect((await officerLogin.json()).url).not.toContain('error=');
    const officerSession = await (await officerPage.request.get('/api/auth/session/')).json();
    expect(officerSession.error).toBeUndefined();
    expect(officerSession.user?.name).toBe(fixture.users.officer.username);
    await officerPage.goto('/daily-expense/?businessDate=' + businessDate);
    await expect(officerPage.getByTestId('daily-list-total')).toHaveText('2');
    await expect(officerPage.getByTestId('daily-ready-total')).toHaveText('1');
    await expect(officerPage.getByText(fixture.divisions.foreign.name, { exact: false })).toHaveCount(0);
    const summaryRegion = officerPage.getByRole('region', { name: 'Суточный свод', exact: true });
    await expect(summaryRegion.getByText('Свод не собран', { exact: true })).toBeVisible();
    const assembled = officerPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/operations/daily-summaries/');
    await summaryRegion.getByRole('button', { name: 'Собрать свод', exact: true }).click();
    const assembledResponse = await assembled;
    expect(assembledResponse.status()).toBe(201);
    const summary = await assembledResponse.json();
    save('summary-assembled.json', summary);
    expect(summary.sent_at).toBeNull();
    expect(summary.sent_by).toBe('');
    await expect(summaryRegion.getByText('Свод собран · v1 · ожидает отправки', { exact: true })).toBeVisible();
    await summaryRegion.getByRole('button', { name: 'Проверить состав', exact: true }).click();
    const pinned = summaryRegion.getByRole('button', { name: fixture.divisions.mine.name + ' · версия 1', exact: true });
    await pinned.click();
    const savedRoster = summaryRegion.getByRole('list', { name: 'Сохранённый состав', exact: true });
    await expect(savedRoster.getByRole('listitem')).toHaveCount(2);
    await expect(savedRoster.getByText(fixture.people.own.name, { exact: true })).toBeVisible();
    await expect(savedRoster.getByText(fixture.people.child.name, { exact: true })).toBeVisible();
    await expect(savedRoster.getByText('В отпуске', { exact: false })).toBeVisible();
    await expect(savedRoster.getByText('В строю', { exact: true })).toBeVisible();
    const beforeSend = await (await apis.officer.get('/api/operations/daily-submissions/' + summary.id + '/')).json();
    save('summary-before-send.json', beforeSend);
    expect(beforeSend.snapshot.roster).toEqual([]);
    expect(beforeSend.snapshot.sources).toEqual([expect.objectContaining({ submission_id: submission.id, division_id: fixture.divisions.mine.id, version: 1 })]);
    const sent = officerPage.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/operations/daily-summaries/send/');
    await summaryRegion.getByRole('button', { name: 'Отправить дежурному', exact: true }).click();
    const sentResponse = await sent;
    expect(sentResponse.status()).toBe(200);
    const delivered = await sentResponse.json();
    save('summary-sent.json', delivered);
    expect(delivered.id).toBe(summary.id);
    expect(delivered.sent_at).not.toBeNull();
    expect(delivered.sent_by).toBe(String(fixture.users.officer.id));
    expect(delivered.incomplete_reason).toBe('');
    await expect(summaryRegion.getByText(/Свод отправлен · v1 ·/)).toBeVisible();
    const afterSend = await (await apis.officer.get('/api/operations/daily-submissions/' + summary.id + '/')).json();
    expect(afterSend.snapshot).toEqual(beforeSend.snapshot);
    save('summary-after-send.json', afterSend);
    const duplicate = await apis.officer.post('/api/operations/daily-summaries/send/', { data: { division_id: fixture.divisions.department.id, business_date: businessDate } });
    expect(duplicate.status()).toBe(409);
    const duplicateBody = await duplicate.json();
    expect(duplicateBody.error_code).toBe('SUMMARY_ALREADY_SENT');
    save('duplicate-send.json', duplicateBody);
    const afterDuplicateResponse = await apis.officer.get('/api/operations/daily-submissions/' + summary.id + '/');
    expect(afterDuplicateResponse.status()).toBe(200);
    const afterDuplicate = await afterDuplicateResponse.json();
    expect(afterDuplicate).toEqual(afterSend);
    expect(afterDuplicate).toMatchObject({ id: summary.id, version: 1, is_current: true });
    const versionsResponse = await apis.officer.get('/api/ops/daily/daily-submissions/?business_date=' + businessDate);
    expect(versionsResponse.status()).toBe(200);
    const versions = await versionsResponse.json();
    expect(versions.results.map((item: { id: number }) => item.id).sort()).toEqual([submission.id, summary.id].sort());
    for (const version of versions.results) expect(version).toMatchObject({ version: 1, is_current: true });
    save('duplicate-preserved.json', { detail: afterDuplicate, versions: versions.results });
    checks.push({ check: 'department total is two; assembled version pins the confirmed child; saved composition displays two own names and distinct statuses', passed: true });
    checks.push({ check: 'explicit send records officer, preserves snapshot and version, and rejects duplicate send', passed: true });
    expect(errors).toEqual([]);
    expect(trace.filter(request => request.status >= 400)).toEqual([]);
    await officerPage.screenshot({ path: testInfo.outputPath('officer.png'), fullPage: true });
    save('receipt.json', { complete: true, phase: 'chief submission and department summary sent', businessDate, businessApisMocked: false, errors, checks, requests: trace });
    expect(writes).toHaveLength(4);
    expect(blockedWrites).toEqual([]);

  } finally {
    for (const [name, value] of Object.entries(saved)) {
      await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
    }
    await testInfo.attach('mutation-contract', { body: JSON.stringify({ errors, trace, writes, blockedWrites }), contentType: 'application/json' });
    for (const context of contexts.reverse()) await context.close();
  }
});
