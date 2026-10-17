import { expect, test, type Page } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3351';
async function signIn(page: Page) {
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect((await login.json()).url).not.toContain('error=');
}

test.describe('report and request UX safeguards', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated frontend; all tested writes use browser fixtures');

  test('loaded report cards fit mobile and desktop widths while tables scroll locally', async ({ page }) => {
    await page.route('**/api/**', route => {
      const request = route.request();
      return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
        ? route.abort('blockedbyclient') : route.continue();
    });
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${APP}/reports/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Показать расход', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Текущий расход на' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Штатное расписание', exact: true }).getByRole('table')).toBeVisible();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });

  test('cached report permission stops authorizing controls after refresh failure and retry restores them', async ({ page }) => {
    let failed = false;
    let reads = 0;
    await page.route('**/api/operations/my-permissions/**', route => {
      reads++;
      return failed
        ? route.fulfill({ status: 503, json: { detail: 'Temporary permission failure' } })
        : route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } });
    });
    await signIn(page);
    await page.goto(`${APP}/reports/`, { waitUntil: 'domcontentloaded' });
    const show = page.getByRole('button', { name: 'Показать расход', exact: true });
    await expect(show).toBeVisible();
    const initialReads = reads;
    failed = true;
    // TanStack Query v5 refetches permissions on visibility changes. This
    // preserves the successful cached response while the refresh fails.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => reads).toBeGreaterThan(initialReads);
    const failure = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить права доступа к отчётам.' });
    await expect(failure).toBeVisible({ timeout: 20_000 });
    await expect(show).toHaveCount(0);
    failed = false;
    await failure.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(show).toBeVisible();
  });

  test('headcount is not truncated; empty lists cannot be sent and partial lists can', async ({ page }) => {
    const id = 'ux-validation-fixture';
    const writes: { action: string; body: Record<string, unknown> }[] = [];
    const allocation = {
      id, departmentId: '91093', departmentName: 'Департамент проверки', need: 5,
      allocating: 5, status: 'NOTIFIED', comment: '', answerComment: '',
      notifiedAt: '2026-10-08T08:00:00Z', submittedAt: null as string | null, decidedAt: null,
      decisionComment: '', groupDemands: [], groupOffers: [], dueAt: null, overdue: false, submittedLate: false,
      directorates: [{ id: 'dir', divisionId: '91094', name: 'Управление проверки', need: 5, assigned: 0, notifiedAt: '2026-10-08T08:00:00Z', groupDemandIds: [] }],
      members: [] as { employeeId: string; name: string; divisionName: string; source: string }[],
    };
    const detail = { eventId: '91093', code: 'ОМ-UX', title: 'Проверка ответа департамента', businessDate: '2026-10-09', location: 'Площадка', eventTime: null };
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['forces.allocate', 'status.view'], roles: [{ code: 'FORCES_GATHERING_OFFICER', name: 'Ответственный', scope_division_id: 91093, scope_division_name: allocation.departmentName }],
    } }));
    await page.route(url => url.pathname.endsWith('/core/divisions/'), route => route.fulfill({ json: { results: [
      { id: 91093, name: allocation.departmentName, type_code: 'department', parent: null, is_active: true },
      { id: 91094, name: 'Управление проверки', type_code: 'directorate', parent: 91093, is_active: true },
    ] } }));
    await page.route(url => url.pathname.endsWith('/forces/requests/'), route => route.fulfill({ json: { results: [] } }));
    await page.route(url => url.pathname.endsWith(`/forces/requests/${id}/`), route => route.fulfill({ json: {
      ...detail, allocation, memberDirectorateById: { 'employee-1': '91094' },
    } }));
    await page.route(url => url.pathname.includes(`/forces/allocation/${id}/`), async route => {
      const action = route.request().url().split('/').filter(Boolean).at(-1)!;
      const body = route.request().postDataJSON() ?? {};
      writes.push({ action, body });
      if (action === 'respond') allocation.allocating = body.allocating;
      if (action === 'submit') { allocation.status = 'SUBMITTED'; allocation.submittedAt = '2026-10-08T09:00:00Z'; }
      await route.fulfill({ json: {} });
    });
    await signIn(page);
    await page.goto(`${APP}/employees?view=forces&request=${id}`, { waitUntil: 'domcontentloaded' });
    const count = page.getByLabel('Выделяем', { exact: true });
    const save = page.getByRole('button', { name: 'Сохранить ответ', exact: true });
    await expect(count).toBeVisible();
    await count.fill('2.5');
    await expect(save).toBeDisabled();
    await expect(count).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Укажите целое неотрицательное число сотрудников.', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    await count.fill('1e2');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => writes.find(row => row.action === 'respond')?.body.allocating).toBe(100);
    const send = page.getByRole('button', { name: 'Отправить список в штаб', exact: true });
    await expect(send).toBeDisabled();
    await expect(page.getByText('Сначала дождитесь хотя бы одного сотрудника от управлений. Пустой список отправить нельзя.', { exact: true })).toBeVisible();
    allocation.members = [{ employeeId: 'employee-1', name: 'Сотрудник проверки', divisionName: 'Управление проверки', source: 'STATUS' }];
    allocation.directorates[0].assigned = 1;
    await page.reload();
    await expect(send).toBeEnabled();
    await send.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Отправить 1 из 100?');
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => writes.filter(row => row.action === 'submit').length).toBe(1);
    await expect(dialog).toHaveCount(0);
  });
});
