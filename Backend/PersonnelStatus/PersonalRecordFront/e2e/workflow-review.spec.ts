import { expect, test, type Page } from '@playwright/test';
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials';

const date = '2026-10-12';
test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated frontend required; business writes are blocked');

async function setup(page: Page, head = false) {
  const state = { reads: [] as number[], failure: false, corrupt: false, revoked: false, large: false, writes: [] as string[] };
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) || new URL(route.request().url()).pathname.startsWith('/api/auth/')) return route.fallback();
    state.writes.push(route.request().url());
    return route.fulfill({ status: 403, json: { detail: 'Unexpected business write' } });
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: [...(state.revoked ? [] : ['status.view']), 'daily_report.mark_update', 'daily_report.correct', ...(head ? [] : ['forces.allocate', 'daily_report.generate'])],
    roles: [{ code: head ? 'DIRECTORATE_HEAD' : 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id: head ? 3 : 2, scope_division_name: head ? 'Управление А' : 'Департамент А' }],
  } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: date, blocked: false, laggards: [] } }));
  await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
    { id: '2', name: 'Департамент А', parent_id: null, division_type: 'department', without_status: 0 },
    { id: '3', name: 'Управление А', ancestors: ['Департамент А'], parent_id: '2', division_type: 'directorate', without_status: 0, can_submit: true, can_correct: true },
  ] } }));
  const figure = { division_id: 3, name: 'Управление А', list_total: 1, staff_total: 1, vacancies: 0, attached: 0, off_list: 0, columns: { IN_SERVICE: 1 }, event: { group: 0, squad: 0 } };
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: date, columns: ['IN_SERVICE'], column_labels: { IN_SERVICE: 'В строю' }, rows: [figure], totals: figure, warnings: [] } }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { results: [{ id: 1, code: 'IN_SERVICE', name: 'В строю', report_column_code: 'IN_SERVICE', is_active: true }] } }));
  await page.route('**/api/ops/daily/daily-submissions/**', route => {
    const division = new URL(route.request().url()).searchParams.get('division_id') ?? '3';
    return route.fulfill({ json: { results: [{ id: division === '2' ? 700 : 701, division_id: division, business_date: date, version: 3, is_current: true, event: 'CHANGED', submitted_by: 'Учебный автор', submitted_at: `${date}T05:00:00Z`, late: false, sent_at: null, sent_by: '', incomplete_reason: '' }] } });
  });
  await page.route('**/api/operations/daily-submissions/*/', route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').filter(Boolean).at(-1)); state.reads.push(id);
    if (state.failure) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    return route.fulfill({ json: { id, business_date: date, reason: '', sanction: '', snapshot: {
      division_title: id === 700 ? 'Департамент А на момент сдачи' : 'Управление А на момент сдачи',
      roster: state.large ? Array.from({ length: 23 }, (_, index) => ({ employee_id: 1000 + index, full_name: `Сохранённый сотрудник ${index + 1}`, rank: '', position_name: '' })) : [{ employee_id: id, full_name: id === 700 ? 'Начальник из сохранённой версии' : 'Сотрудник из сохранённой версии', rank: 'Капитан', position_name: 'Инспектор' }],
      rows: state.corrupt ? [{ employee_id: 999999, status_type_code: 'SICK' }] : id === 700 ? [] : [{ employee_id: id, status_type_code: 'SICK', date_start: date, date_end: '2026-10-15', destination: 'Место из снимка' }],
      catalog: [{ code: 'SICK', name: 'Больничный на момент сдачи' }],
      ...(id === 700 ? { sources: [{ division_id: 3, submission_id: 701, version: 3 }] } : {}),
    } } });
  });
  const csrf = await (await page.request.get('/api/auth/csrf/')).json();
  const login = await page.request.post('/api/auth/callback/credentials/', { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(head ? `/statuses/?businessDate=${date}` : `/employees/?view=daily&businessDate=${date}`);
  return state;
}

test('one authorized directorate needs no selector and explains where submitted data goes', async ({ page }) => {
  const state = await setup(page, true);
  const panel = page.getByRole('region', { name: 'Сдача дня за управление' });
  await expect(panel.getByText(/День сдан: v3/)).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Управление для сдачи дня' })).toHaveCount(0);
  await expect(panel.getByText('Департамент А / Управление А', { exact: true })).toBeVisible();
  await expect(panel.getByText('Данные доступны ответственному за расход департамента.', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('review next to sending reads frozen people and exact pinned versions lazily', async ({ page }) => {
  const state = await setup(page);
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
  await expect(summary.getByText(/Свод собран · v3/)).toBeVisible();
  expect(state.reads).toEqual([]);
  await summary.getByRole('button', { name: 'Проверить состав', exact: true }).click();
  await expect(summary.getByText('Начальник из сохранённой версии', { exact: true })).toBeVisible();
  expect(state.reads).toEqual([700]);
  await summary.getByRole('button', { name: 'Управление А · версия 3', exact: true }).click();
  await expect(summary.getByText('Сотрудник из сохранённой версии', { exact: true })).toBeVisible();
  await expect(summary.getByText('Больничный на момент сдачи', { exact: false })).toBeVisible();
  await expect(summary.getByText('Место из снимка', { exact: false })).toBeVisible();
  expect(state.reads).toEqual([700, 701]);
  expect(state.writes).toEqual([]);
});

test('snapshot failure stays distinct from empty and can be retried', async ({ page }) => {
  const state = await setup(page); state.failure = true;
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
  await summary.getByRole('button', { name: 'Проверить состав', exact: true }).click();
  await expect(summary.getByRole('alert').filter({ hasText: 'Не удалось открыть снимок версии' })).toBeVisible();
  await expect(summary.getByText('В сохранённом составе нет сотрудников.', { exact: true })).toHaveCount(0);
  state.failure = false;
  await summary.getByRole('button', { name: 'Повторить загрузку состава' }).click();
  await expect(summary.getByText('Начальник из сохранённой версии', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('inconsistent frozen facts cannot silently label everyone in service', async ({ page }) => {
  const state = await setup(page); state.corrupt = true;
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
  await summary.getByRole('button', { name: 'Проверить состав', exact: true }).click();
  await expect(summary.getByRole('alert').filter({ hasText: 'Не удалось показать состав этой версии' })).toBeVisible();
  await expect(summary.getByText('В строю', { exact: true })).toHaveCount(0);
});

test('saved roster is paginated and searchable without more snapshot requests', async ({ page }) => {
  const state = await setup(page); state.large = true;
  await page.setViewportSize({ width: 390, height: 844 });
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
  await summary.getByRole('button', { name: 'Проверить состав', exact: true }).click();
  const list = summary.getByRole('list', { name: 'Сохранённый состав' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await summary.getByRole('navigation', { name: 'Страницы сохранённого состава' }).getByRole('button', { name: 'Далее' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await summary.getByRole('textbox', { name: 'Поиск в сохранённом составе' }).fill('сотрудник 23');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('Сохранённый сотрудник 23', { exact: true })).toBeVisible();
  expect(state.reads).toEqual([700]);
  await page.screenshot({ path: test.info().outputPath('summary-mobile.png'), fullPage: true });
});

test('revoking status read removes an already open saved roster', async ({ page }) => {
  const state = await setup(page);
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true });
  await summary.getByRole('button', { name: 'Проверить состав', exact: true }).click();
  await expect(summary.getByText('Начальник из сохранённой версии', { exact: true })).toBeVisible();
  state.revoked = true;
  const reloaded = page.waitForResponse('**/api/operations/my-permissions/**');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await reloaded;
  await expect(page.getByText('Начальник из сохранённой версии', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
