import type { Page } from '@playwright/test';
import { test, expect, signIn } from './ux-fixture';

const today = '2026-10-16';
const dutyPermissions = ['status.view', 'status.manage_root', 'service_summary.view', 'daily_report.generate'];

function event(id: string, businessDate: string, stage: 'FORCES' | 'CONDUCT' | 'CLOSED', requested: number, allocated: number, conflicts = 0) {
  return {
    id, code: `ОМ-ПРОВЕРКА-${id}`, title: `Проверка ${id}`, businessDate, businessDateEnd: null,
    objectId: null, objectName: `Учебный объект ${id}`, stage, readinessPercent: 45,
    forceNeed: requested, conflictsCount: conflicts, ownerName: 'Учебный оператор', visitObjects: [],
    forceRequests: [
      { id: `${id}-need`, group: 'Основная группа', requestedCount: requested, allocatedCount: allocated, status: 'SENT', comment: '' },
      { id: `${id}-surplus`, group: 'Группа с избытком', requestedCount: 2, allocatedCount: 9, status: 'SENT', comment: '' },
    ],
  };
}

/** Only auth reaches the stand; all business reads below use synthetic data. */
async function prepare(page: Page, permissions: string[], roleCodes = ['DUTY_OFFICER'], failSecondPage = false) {
  const state = { permissions, permissionReads: 0, reads: [] as string[], eventPages: [] as number[] };
  await page.clock.setFixedTime(new Date(`${today}T12:00:00+05:00`));
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.startsWith('/api/auth/') || request.method() !== 'GET') return route.fallback();
    state.reads.push(path);
    if (path === '/api/operations/my-permissions/') {
      state.permissionReads++;
      return route.fulfill({ json: {
        permissions: state.permissions, global_permissions: state.permissions,
        status_manage_division_ids: state.permissions.includes('*') ? null : [],
        roles: roleCodes.map(code => ({ code, name: code, scope_division_id: null, scope_division_name: null })),
      } });
    }
    if (path === '/api/staff_unit/staff-units/directorate/') return route.fulfill({ json: {
      division: null, staff_units: [], total_count: 0, matched_count: 0,
      page: Number(url.searchParams.get('page') ?? 1), page_size: Number(url.searchParams.get('page_size') ?? 50),
      has_next: false, summary: { employees: 0, without_status: 0, overdue: 0, scheduled: 0 },
    } });
    if (path === '/api/staff_unit/statistics/') return route.fulfill({ json: {
      scope_division: null, departments: [], directorates: [], divisions: [],
      summary: { departments_count: 0, directorates_count: 0, divisions_count: 0, staff_units_count: 0, employees_count: 0, vacancies_count: 0 },
    } });
    if (path === '/api/operations/strength-report/') {
      const totals = { staff_total: 12, list_total: 10, vacancies: 2, attached: 0, off_list: 0,
        columns: { IN_SERVICE: 8, VACATION: 2 }, event: { total: 0, group: 0, squad: 0 } };
      return route.fulfill({ json: { business_date: today, columns: ['IN_SERVICE', 'VACATION'],
        column_labels: { IN_SERVICE: 'В строю', VACATION: 'Отпуск' },
        rows: [{ division_id: 3, name: 'Учебный департамент', ancestors: [], ...totals }], totals, warnings: [] } });
    }
    if (path === '/api/ops/security-events/') {
      const number = Number(url.searchParams.get('page') ?? 1);
      state.eventPages.push(number);
      if (failSecondPage && number === 2) return route.fulfill({ status: 503, json: { message: 'Вторая страница временно недоступна' } });
      return route.fulfill({ json: { count: 3, owners: [], previous: number === 2 ? '/api/ops/security-events/?page=1' : null,
        next: number === 1 ? '/api/ops/security-events/?page=2' : null,
        results: number === 1
          ? [event('предстоящая', '2026-10-18', 'FORCES', 4, 1, 2)]
          : [event('прошедшая', '2026-10-12', 'CONDUCT', 5, 1), event('закрытая', '2026-10-11', 'CLOSED', 100, 0)],
      } });
    }
    if (path === '/api/operations/traffic-light/tree/') return route.fulfill({ json: { business_date: today, control_hour: '17:00:00', nodes: [] } });
    if (path === '/api/operations/status-types/') return route.fulfill({ json: { count: 2, next: null, results: [
      { id: 1, code: 'IN_SERVICE', name: 'В строю', is_active: true, report_column_code: 'IN_SERVICE' },
      { id: 2, code: 'VACATION', name: 'Отпуск', is_active: true, report_column_code: 'VACATION' },
    ] } });
    if (path === '/api/statuses/types/') return route.fulfill({ json: [{ code: 'in_service', label: 'В строю', color: '' }] });
    if (path === '/api/operations/tomorrow-block/') return route.fulfill({ json: { business_date: '2026-10-17', blocked: false, laggards: [] } });
    if (path === '/api/reports/reports/staffing/' || path === '/api/reports/reports/absences/') return route.fulfill({ json: {
      count: 0, page: 1, page_size: 50, next_page: null, previous_page: null, divisions: [], basis: 'current_staffing', as_of: today,
      date_from: '2026-10-01', date_to: today,
      totals: path.endsWith('/staffing/') ? { staff_total: 0, occupied: 0, vacancies: 0, dismissed_in_slot: 0 } : { person_days: 0, unique_people: 0 }, rows: [],
    } });
    if (path === '/api/ops/service-report-types/') return route.fulfill({ json: {
      results: [], retentionPolicy: { retentionDays: 30, policyVersion: 'fixture' }, maskedFields: [], unavailableFormats: [], unavailableArtifactFields: [], canExportSensitive: false,
    } });
    if (path === '/api/ops/service-report-jobs/') return route.fulfill({ json: {
      results: [], artifacts: [], actions: [], unavailableColumns: [], totalVisible: 0, serverTime: `${today}T12:00:00+05:00`,
    } });
    return route.fulfill({ json: { results: [], count: 0, next: null, previous: null, subdivisions: [], nodes: [] } });
  });
  await signIn(page);
  return state;
}

function statusReads(reads: string[]) {
  return reads.filter(path => path === '/api/staff_unit/staff-units/directorate/' || path.startsWith('/api/statuses/statuses/') || path === '/api/operations/statuses/');
}

test('the duty role keeps summary reads but cannot enter or prefetch the employee status workspace', async ({ page, businessWrites }) => {
  const state = await prepare(page, dutyPermissions);
  await page.goto('/statuses/');
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Статусы сотрудников', exact: true })).toHaveCount(0);
  expect(statusReads(state.reads)).toEqual([]);
  await expect(page.getByRole('navigation', { name: 'Хлебные крошки' }).getByRole('link', { name: 'Smart Жоспарлау', exact: true })).toHaveAttribute('href', '/security-ops/service-summary/');
  expect(businessWrites).toEqual([]);
});

for (const persona of [
  { name: 'an explicit duty workspace grant', permissions: [...dutyPermissions, 'status.workspace'], roles: ['DUTY_OFFICER'] },
  { name: 'a second custom role alongside duty', permissions: [...dutyPermissions, 'status.workspace'], roles: ['DUTY_OFFICER', 'CUSTOM_STATUS_READER'] },
  { name: 'the administrator wildcard', permissions: ['*'], roles: ['ADMIN'] },
]) test(`${persona.name} opens the status workspace without a role-name prohibition`, async ({ page, businessWrites }) => {
  const state = await prepare(page, persona.permissions, persona.roles);
  await page.goto('/statuses/');
  await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Статусы сотрудников', exact: true })).toBeVisible();
  await expect.poll(() => statusReads(state.reads).length).toBeGreaterThan(0);
  expect(businessWrites).toEqual([]);
});

test('a workspace grant alone does not authorize status data', async ({ page, businessWrites }) => {
  const state = await prepare(page, ['status.workspace'], ['CUSTOM_STATUS_READER']);
  await page.goto('/statuses/');
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  expect(statusReads(state.reads)).toEqual([]);
  expect(businessWrites).toEqual([]);
});

test('revoking workspace access removes a warmed status screen and stops roster reads', async ({ page, businessWrites }) => {
  const state = await prepare(page, [...dutyPermissions, 'status.workspace']);
  await page.goto('/statuses/');
  await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible();
  await expect.poll(() => statusReads(state.reads).length).toBeGreaterThan(0);
  // Settle initial permission refreshes before invalidating the grant. The
  // focus subscription reuses an in-flight query instead of issuing another.
  await page.waitForLoadState('networkidle');
  state.permissions = dutyPermissions;
  const before = state.permissionReads;
  const rosterBefore = statusReads(state.reads).length;
  await page.evaluate(() => {
    // Headless bringToFront need not emit visibilitychange. Exercise the
    // installed focusManager's actual window subscription with visible state.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.permissionReads).toBeGreaterThan(before);
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toHaveCount(0);
  expect(statusReads(state.reads)).toHaveLength(rosterBefore);
  expect(businessWrites).toEqual([]);
});

test('adding the read-only workspace grant preserves the ordinary employee personal landing', async ({ page, businessWrites }) => {
  await prepare(page, ['catalog.view', 'document.view', 'feedback.create', 'feedback.view', 'object.view', 'status.view', 'status.workspace'], ['EMPLOYEE']);
  await page.goto('/');
  await expect(page).toHaveURL(/\/security-ops\/profile\/?$/);
  expect(businessWrites).toEqual([]);
});

for (const access of [
  { name: 'both report rights', permissions: ['status.view', 'orgstructure.view', 'daily_report.generate', 'report.generate'], href: '/reports', daily: true, service: true },
  { name: 'daily report only', permissions: ['status.view', 'orgstructure.view', 'daily_report.generate'], href: '/reports', daily: true, service: false },
  { name: 'service report only', permissions: ['report.generate'], href: '/security-ops/service-reports', daily: false, service: true },
  { name: 'no report rights', permissions: [], href: '', daily: false, service: false },
]) test(`one reports entry preserves the available sources for ${access.name}`, async ({ page, businessWrites }) => {
  const state = await prepare(page, access.permissions, ['CUSTOM_REPORT_READER']);
  await page.goto('/reports/');
  const menu = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(menu).toBeVisible();
  await expect.poll(() => state.permissionReads).toBeGreaterThan(0);
  const reports = menu.getByRole('link', { name: 'Отчёты', exact: true });
  await expect(reports).toHaveCount(access.href ? 1 : 0);
  await expect(menu.getByRole('link', { name: /^(Ежедневный отчет|Отчёты по Службе)$/ })).toHaveCount(0);
  if (access.href) {
    await expect(reports).toHaveAttribute('href', `${access.href}/`);
    await reports.click();
    await expect(page).toHaveURL(new RegExp(access.href.replaceAll('/', '\\/') + '\\/?$'));
    await expect(reports).toHaveAttribute('aria-current', 'page');
    const sources = page.getByRole('navigation', { name: 'Источники отчётов' });
    await expect(sources).toBeVisible();
    await expect(sources.getByRole('link', { name: 'Расход и кадровые отчёты', exact: true })).toHaveCount(access.daily ? 1 : 0);
    await expect(sources.getByRole('link', { name: 'Дежурства и документы ОМ', exact: true })).toHaveCount(access.service ? 1 : 0);
    if (access.daily && access.service) {
      await sources.getByRole('link', { name: 'Дежурства и документы ОМ', exact: true }).click();
      await expect(page).toHaveURL(/\/security-ops\/service-reports\/?$/);
      await expect(reports).toHaveAttribute('aria-current', 'page');
      await page.getByRole('link', { name: 'История отчётов', exact: true }).click();
      await expect(page).toHaveURL(/\/security-ops\/service-reports\/history\/?$/);
      await expect(reports).toHaveAttribute('aria-current', 'page');
    }
    if (!access.daily) expect(state.reads.some(path => path.startsWith('/api/operations/strength-report/') || path.startsWith('/api/reports/reports/'))).toBe(false);
  } else {
    await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Источники отчётов' })).toHaveCount(0);
  }
  expect(businessWrites).toEqual([]);
});

test('operational control explains real gaps across every page and separates unfinished past events', async ({ page, businessWrites }) => {
  const state = await prepare(page, ['event.view', 'status.view', 'service_summary.view']);
  await page.goto('/security-ops/command-center/');
  await expect(page.getByRole('heading', { name: 'Оперативный контроль', exact: true })).toBeVisible();
  const main = page.getByRole('main');
  const deficit = main.locator('[data-slot="card"]', { hasText: 'Недобор по заявкам' }).first();
  await expect(deficit.getByText('7', { exact: true })).toBeVisible();
  await expect(deficit).toContainText('запрошено − выделено');
  const active = main.locator('[data-slot="card"]', { hasText: 'Незавершённые ОМ' }).first();
  await expect(active.getByText('2', { exact: true })).toBeVisible();
  const positions = main.locator('[data-slot="card"]', { hasText: 'Штатных единиц' }).first();
  await expect(positions.getByText('12', { exact: true })).toBeVisible();
  await expect(positions).toContainText('10 по списку');
  const upcoming = main.getByRole('region', { name: 'Предстоящие мероприятия' });
  const overdue = main.getByRole('region', { name: 'Прошедшие незавершённые мероприятия' });
  await expect(upcoming.getByRole('link', { name: /Проверка предстоящая/ })).toBeVisible();
  await expect(upcoming.getByRole('link', { name: /Проверка предстоящая/ })).toContainText('Запрос сил');
  await expect(overdue.getByRole('link', { name: /Проверка прошедшая/ })).toBeVisible();
  await expect(upcoming.getByRole('link', { name: /Проверка прошедшая/ })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Проверка закрытая/ })).toHaveCount(0);
  await expect(main.getByText(/средняя готовность/i)).toHaveCount(0);
  await expect(upcoming.getByText(/\d+%/)).toHaveCount(0);
  await expect(overdue.getByText(/\d+%/)).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Свод по Службе на сегодня', exact: true })).toHaveAttribute('href', `/security-ops/service-summary/?dateFrom=${today}`);
  expect(state.eventPages).toContain(2);
  expect(businessWrites).toEqual([]);
});

test('a failed second registry page shows an error instead of a partial gap or a false empty state', async ({ page, businessWrites }) => {
  const state = await prepare(page, ['event.view', 'status.view'], ['DUTY_OFFICER'], true);
  await page.goto('/security-ops/command-center/');
  await expect(page.getByRole('heading', { name: 'Оперативный контроль', exact: true })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('alert').filter({ hasText: /мероприяти/ })).toBeVisible();
  await expect(main.locator('[data-slot="card"]', { hasText: 'Недобор по заявкам' })).toHaveCount(0);
  await expect(main.locator('[data-slot="card"]', { hasText: 'Незавершённые ОМ' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /Проверка предстоящая/ })).toHaveCount(0);
  await expect(main.getByText(/нет незавершённых|незавершённых мероприятий нет/i)).toHaveCount(0);
  expect(state.eventPages).toContain(2);
  expect(businessWrites).toEqual([]);
});
