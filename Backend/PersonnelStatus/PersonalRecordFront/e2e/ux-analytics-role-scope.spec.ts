import { test, expect, signIn } from './ux-fixture';

const path = '/security-ops/analytics/operations/';
const endpoint = '/api/ops/operations-analytics/';
const day = '2026-10-21';

test('operations-only grant loads its snapshot and shows only its analytics tab', async ({ page, businessWrites }) => {
  const permission = 'analytics.operations';
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: [permission], global_permissions: [permission], roles: [],
  } }));
  await page.route('**/api/ops/operations-analytics/**', route => route.fulfill({ json: {
    snapshotId: 'operations-only-snapshot', businessDate: day, timezone: 'Asia/Qyzylorda',
    period: { from: day, to: day, presetCode: null },
    scope: { scopeType: 'ORGANIZATION', scopeId: 'organization', safeLabel: 'Вся организация' },
    generatedAt: day + 'T10:00:00+05:00', sourceUpdatedAt: null, sourceWatermark: null,
    freshnessState: 'CURRENT', completenessState: 'COMPLETE', calculationVersion: '1', policyVersion: '1',
    data: { level: 'ALL', breadcrumb: [], columns: [{ code: 'EVENTS', safeLabel: 'Мероприятий' }],
      rows: [{ rowId: 'object-analytics', safeLabel: 'Объект из доступного снимка', childLevel: 'OBJECT',
        cells: [{ code: 'EVENTS', value: 3, unavailableReason: null }] }],
      lifecycleDistribution: [], unknownLifecycleCodes: [], eventCard: null, funnel: null,
      funnelUnavailableReason: 'Переходов пока нет.', unavailableMeasures: [] },
  } }));
  await signIn(page);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.status() === 200);
  await page.goto(path);
  await loaded;
  const navigation = page.getByRole('navigation', { name: 'Разделы аналитики', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(1);
  await expect(navigation.getByRole('link', { name: 'Аналитика мероприятий', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Объект из доступного снимка', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

test('refresh reloads all service sources while current personnel date stays separate from the historical period', async ({ page, businessWrites }) => {
  const counts = new Map<string, number>();
  let version = 1;
  const sources = [
    '/api/ops/service-analytics-presets/', '/api/ops/service-analytics/', '/api/ops/service-analytics-attention/',
    '/api/ops/load-analytics/', '/api/operations/strength-report/', '/api/operations/strength-report/period/',
    '/api/operations/traffic-light/tree/', '/api/operations/notifications/', '/api/ops/daily/divisions/',
  ];
  const envelope = {
    snapshotId: 'service-multi-source', businessDate: day, timezone: 'Asia/Qyzylorda',
    period: { from: '2026-10-01', to: '2026-10-03', presetCode: null },
    scope: { scopeType: 'ORGANIZATION', scopeId: 'organization', safeLabel: 'Вся организация' },
    generatedAt: day + 'T10:00:00+05:00', sourceUpdatedAt: null, sourceWatermark: null,
    freshnessState: 'CURRENT', completenessState: 'COMPLETE', calculationVersion: '1', policyVersion: '1',
  };
  await page.route('**/api/**', async route => {
    const currentPath = new URL(route.request().url()).pathname;
    if (currentPath === '/api/operations/my-permissions/') return route.fulfill({ json: {
      permissions: ['analytics.view', 'status.view'], global_permissions: ['analytics.view', 'status.view'], roles: [],
    } });
    if (!sources.includes(currentPath)) return route.fallback();
    counts.set(currentPath, (counts.get(currentPath) ?? 0) + 1);
    const people = version === 1 ? 8 : 7;
    const totals = { staff_total: 10, list_total: people, vacancies: 10 - people, attached: 0, off_list: 0,
      columns: { IN_SERVICE: people - 2, VACATION: 2 }, event: { total: 0, group: 0, squad: 0 } };
    const row = { division_id: 12, name: 'Доступное управление', ...totals };
    const responses: Record<string, unknown> = {
      '/api/ops/service-analytics-presets/': { defaultPresetCode: 'TODAY',
        results: [{ presetCode: 'TODAY', safeLabel: 'Сегодня', offsetDays: 0, lengthDays: 1 }],
        maxCustomPeriodDays: 31, limitPolicyVersion: '1', customPeriodUnavailableReason: null },
      '/api/ops/service-analytics/': { ...envelope, data: { metrics: [], unavailableMetrics: [] },
        unavailableHeaderBlocks: [], drilldownAllowed: false, drilldownDeniedReason: null },
      '/api/ops/service-analytics-attention/': { ...envelope,
        data: { items: [], detectionState: 'AVAILABLE', detectionUnavailableReason: null, unavailableDetectors: [] } },
      '/api/ops/load-analytics/': { businessDate: day, generatedAt: envelope.generatedAt, unavailable: [],
        view: { units: [], employees: [], unlinkedShiftsCount: 0, policy: {
          periodDays: 7, policyVersion: '1', warningMinutes: 2400, overloadMinutes: 3600 },
          personalDetailSuppressed: true, personalDetailReason: 'Доступны итоги подразделений.' } },
      '/api/operations/strength-report/': { business_date: day, columns: ['IN_SERVICE', 'VACATION'],
        column_labels: { IN_SERVICE: 'В строю', VACATION: 'Отпуск' }, rows: [row], totals, warnings: [] },
      '/api/operations/strength-report/period/': { pages: ['2026-10-01', '2026-10-02', '2026-10-03'].map(date => ({
        business_date: date, rows: [row], totals,
      })) },
      '/api/operations/traffic-light/tree/': { business_date: day, control_hour: '17:00:00', nodes: [] },
      '/api/operations/notifications/': { count: 0, next: null, previous: null, results: [] },
      '/api/ops/daily/divisions/': { results: [{ id: '12', name: 'Доступное управление', ancestors: [] }] },
    };
    return route.fulfill({ json: responses[currentPath] });
  });
  await signIn(page);
  await page.goto('/security-ops/analytics/?period=CUSTOM&from=2026-10-01&to=2026-10-03');
  await expect(page.getByRole('heading', { name: 'Кадровый расход на 2026-10-21', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Шапка аналитики', exact: true })).toContainText('2026-10-01 — 2026-10-03');
  const refresh = page.getByRole('button', { name: 'Обновить все данные', exact: true });
  await expect(refresh).toBeEnabled();
  await expect.poll(() => sources.filter(source => (counts.get(source) ?? 0) > 0).length).toBe(sources.length);
  const before = new Map(counts);
  version = 2;
  await refresh.click();
  await expect.poll(() => sources.filter(source => (counts.get(source) ?? 0) > (before.get(source) ?? 0)).length).toBe(sources.length);
  const list = page.getByRole('group', { name: 'Численность личного состава', exact: true })
    .getByText('Списочная численность', { exact: true }).locator('..');
  await expect(list.locator('p.tabular-nums')).toHaveText('7');
  await expect(refresh).toBeEnabled();
  expect(businessWrites).toEqual([]);
});

test('scoped operations grant gets an honest scope explanation instead of a retry failure', async ({ page, businessWrites }) => {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['analytics.operations'], global_permissions: [],
    roles: [{ code: 'HEAD_OPS_UNIT', name: 'Начальник подразделения', scope_division_id: 2, scope_division_name: 'Доступный департамент' }],
  } }));
  await page.route('**/api/ops/operations-analytics/**', route => route.fulfill({ status: 403, json: {
    error_code: 'ANALYTICS_SCOPE_UNAVAILABLE', message: 'Аналитика ограниченной области недоступна.',
    details: {}, request_id: 'analytics-role-scope', timestamp: day + 'T10:00:00+05:00',
  } }));
  await signIn(page);
  const denied = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.status() === 403);
  await page.goto(path);
  await denied;
  await expect(page.getByRole('heading', { name: 'Аналитика ограниченной области пока недоступна', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы аналитики', exact: true }).getByRole('link')).toHaveCount(1);
  await expect(page.getByText('Не удалось загрузить аналитику по подразделениям', { exact: false })).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

