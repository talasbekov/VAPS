import fs from 'node:fs';
import { test as base, expect, type Locator } from '@playwright/test';

const roles = ['scoped', 'scoped_om', 'no_status', 'global_om', 'summary', 'denied'] as const;
type Role = typeof roles[number];
type Person = 'own' | 'child' | 'foreign' | 'om';
interface WorkloadFixture {
  database: string;
  businessDate: string;
  today: string;
  users: Record<Role, { username: string }>;
  people: Record<Person, { name: string }>;
  sensitiveCanaries: string[];
}

function readFixture(): WorkloadFixture {
  const file = process.env.WORKLOAD_ACCEPTANCE_FIXTURE_PATH;
  if (!file) throw new Error('Synthetic workload fixture metadata is required.');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as WorkloadFixture;
  const validDay = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (typeof data?.database !== 'string' || !data.database.startsWith('sj_coverage_acceptance_') || !validDay(data.businessDate) || !validDay(data.today) ||
      !roles.every(role => typeof data.users?.[role]?.username === 'string' && data.users[role].username.startsWith('qa_coverage_')) ||
      !(['own', 'child', 'foreign', 'om'] as const).every(person => typeof data.people?.[person]?.name === 'string' && data.people[person].name.length > 0) ||
      !Array.isArray(data.sensitiveCanaries) || !data.sensitiveCanaries.every(value => typeof value === 'string')) {
    throw new Error('Expected metadata for the isolated sj_coverage_acceptance database, six qa_coverage accounts and four synthetic people.');
  }
  return data;
}

// Guard the read-only UI contract. Successful GETs reach the actual backend;
// unexpected business writes are aborted and fail the test, never fulfilled.
const test = base.extend<{ readProof: { loadRequests: number } }>({
  readProof: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const writes: { path: string; method: string }[] = [];
    const proof = { loadRequests: 0 };
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/ops/load-analytics/') proof.loadRequests += 1;
    });
    await page.route('**/api/**', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push({ path: url.pathname, method: request.method() });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await use(proof);
    await testInfo.attach('read-only-contract', { body: JSON.stringify({ errors, writes }), contentType: 'application/json' });
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  }, { auto: true }],
});

for (const role of roles) test(`real workload coverage: ${role}`, async ({ page, readProof }) => {
  const fixture = readFixture();
  const csrf = await (await page.request.get('/api/auth/csrf/')).json() as { csrfToken: string };
  const login = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: fixture.users[role].username,
      password: process.env.WORKLOAD_ACCEPTANCE_PASSWORD as string, json: 'true' },
  });
  expect(login.status()).toBe(200);
  expect((await login.json() as { url: string }).url).not.toContain('error=');
  const session = await (await page.request.get('/api/auth/session/')).json() as { user?: { name?: string }; error?: string };
  expect(session.error).toBeUndefined();
  expect(session.user?.name).toBe(fixture.users[role].username);
  await page.goto('/security-ops/analytics/');
  const coverage = page.getByRole('region', { name: 'Источники занятости', exact: true });
  if (role === 'denied') {
    await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
    await expect(coverage).toHaveCount(0);
    expect(readProof.loadRequests).toBe(0);
    return;
  }
  await expect(coverage).toBeVisible();
  const from = coverage.getByLabel('С даты', { exact: true });
  const to = coverage.getByLabel('По дату включительно', { exact: true });
  await from.fill(fixture.businessDate);
  await to.fill(fixture.businessDate);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/ops/load-analytics/' && url.searchParams.get('coverage_from') === fixture.businessDate &&
      url.searchParams.get('coverage_to') === fixture.businessDate;
  });
  await coverage.getByRole('button', { name: 'Показать период', exact: true }).click();
  const response = await loaded;
  expect(response.status()).toBe(200);
  const payload = JSON.stringify(await response.json());
  for (const canary of fixture.sensitiveCanaries) expect(payload).not.toContain(canary);
  if (role !== 'global_om') expect(payload).not.toContain(fixture.people.foreign.name);
  await expect(coverage).toContainText(`${fixture.businessDate} — ${fixture.businessDate}`);
  const person = (key: Person): Locator => coverage.locator('details').filter({ has: page.getByText(fixture.people[key].name, { exact: true }) });
  const visiblePeople: Person[] = role === 'summary' ? [] : role === 'global_om' ? ['own', 'foreign', 'om'] :
    role === 'no_status' ? ['own'] : ['own', 'child'];
  for (const key of ['own', 'child', 'foreign', 'om'] as const) {
    await expect(coverage.getByText(fixture.people[key].name, { exact: true })).toHaveCount(visiblePeople.includes(key) ? 1 : 0);
  }
  if (role !== 'global_om') {
    await expect(coverage.getByText(fixture.people.foreign.name, { exact: true })).toHaveCount(0);
    await expect(coverage.getByLabel('Не включённые источники', { exact: true })).toContainText('Участие в ОМ');
  }
  if (role === 'summary') {
    await expect(coverage).toContainText('Для сводки по людям нужны права просмотра аналитики и персональной детализации в одной области.');
    await expect(coverage.getByText(fixture.people.own.name, { exact: true })).toHaveCount(0);
  } else {
    const own = person('own');
    await expect(own).toContainText('План по точным интервалам: 3 ч 0 мин');
    await expect(own).toContainText('Подтверждённый факт: 2 ч 30 мин');
    await own.locator('summary').click();
    const table = own.getByRole('table', { name: `Источники занятости: ${fixture.people.own.name}`, exact: true });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table).toContainText('Отменено');
    await expect(table).toContainText('Не включён');
    if (role === 'scoped' || role === 'scoped_om') {
      const child = person('child');
      await expect(child).toContainText('План по точным интервалам: Неизвестно');
      await expect(child).toContainText('Подтверждённый факт: Неизвестно');
      await child.locator('summary').click();
      await expect(child).toContainText('В отпуске');
      await expect(child).toContainText('Время не задано');
    } else if (role === 'no_status') {
      await expect(person('child')).toHaveCount(0);
      await expect(coverage.getByLabel('Не включённые источники', { exact: true })).toContainText('Статусы');
    } else {
      const om = person('om');
      await expect(om).toContainText('План по точным интервалам: Неизвестно');
      await expect(om).toContainText('Подтверждённый факт: Неизвестно');
      await om.locator('summary').click();
      await expect(om).toContainText('Участие в ОМ');
      await expect(om).toContainText('Время не задано');
    }
  }
  for (const canary of fixture.sensitiveCanaries) expect(await coverage.innerText()).not.toContain(canary);
  if (role === 'scoped') {
    const requestsBeforeInvalid = readProof.loadRequests;
    const invalidEnd = new Date(fixture.businessDate + 'T00:00:00Z');
    invalidEnd.setUTCDate(invalidEnd.getUTCDate() + 31);
    await to.fill(invalidEnd.toISOString().slice(0, 10));
    await coverage.getByRole('button', { name: 'Показать период', exact: true }).click();
    await expect(coverage.getByRole('alert')).toHaveText('Укажите корректные даты сводки: от 1 до 31 дня.');
    expect(readProof.loadRequests).toBe(requestsBeforeInvalid);
    await from.fill(fixture.today);
    await to.fill(fixture.today);
    await coverage.getByRole('button', { name: 'Показать период', exact: true }).click();
    await expect(coverage).toContainText('За выбранный период в доступных источниках записей нет. Это не подтверждает свободное время сотрудников.');
  }
});
