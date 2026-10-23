const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, URLSearchParams, require: id => {
    if (id in dependencies) return dependencies[id];
    if (id === '@/components/analytics/analytics-navigation') return load('components/analytics/analytics-navigation.tsx', dependencies);
    if (id === '@/features/service-analytics/model/refresh') return load('features/service-analytics/model/refresh.ts', dependencies);
    if (id === '@/lib/query-read-access') return load('lib/query-read-access.ts', dependencies);
    if (id === '@/features/ops-ratings/rating-read-failure') return load('features/ops-ratings/rating-read-failure.tsx', dependencies);
    if (id === '@/features/ops-ratings/ratings-nav') return load('features/ops-ratings/ratings-nav.tsx', dependencies);
    if (id.startsWith('@/') || id === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
    return require(id);
  } });
  return exports;
}

function access(permissions, extra = {}) {
  return { isLoading: false, error: null, roles: [], permissions: new Set(permissions), ...extra,
    hasPermission: code => permissions.includes('*') || permissions.includes(code) };
}

const portal = load('entities/portal-access/index.ts');

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

function visibleText(tree) {
  if (Array.isArray(tree)) return tree.map(visibleText).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return visibleText(tree.props?.children);
}

function renderScreen(file, grants, { queryError = null, queryClient, mounted = false, snapshot, ratingData, readAccessBlocked = false,
  loading = false, onRefetch = () => {}, exportName = 'default', pathname = '/security-ops/analytics',
  trafficTree, onTrafficRead = () => {}, reusable = false } = {}) {
  const query = { data: undefined, error: queryError, readAccessBlocked, isPending: loading, isLoading: loading,
    isFetching: false, dataUpdatedAt: 0, refetch: onRefetch };
  const dependencies = {
    react: { ...require('react'), useEffect() {}, useMemo: fn => fn(), useState: initial => [mounted && typeof initial === 'boolean' ? true : initial, () => {}] },
    'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({}), usePathname: () => pathname,
      useSearchParams: () => new URLSearchParams(), useParams: () => ({ employeeId: 'person-12' }) },
    '@tanstack/react-query': { useQuery: () => query,
      useIsFetching: filters => queryClient?.isFetching(filters) ?? 0,
      useQueryClient: () => queryClient ?? { getQueryCache: () => ({ findAll: () => [] }) } },
    '@/entities/portal-access': portal,
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => typeof grants === 'function' ? grants() : grants },
    '@/entities/daily-grid': load('entities/daily-grid/index.ts'),
    '@/hooks/use-ops-analytics': Object.fromEntries(['useAnalyticsDrilldown', 'useAnalyticsPresets',
      'useAttentionItems', 'useLoadAnalytics', 'useServiceAnalytics', 'useOperationsAnalytics'].map(key => [key, () => ({
        ...query, data: key === 'useServiceAnalytics' ? snapshot : undefined,
      })])),
    '@/hooks/use-ops-ratings': { ...Object.fromEntries(['useRatingAnalytics', 'useOperationalRatings', 'useRatingDynamics',
      'useRatingEmployeeDetail', 'useEvaluationRegistry', 'useRatingExports', 'useEvaluationWorkspace', 'useRatingAudit']
      .map(key => [key, () => ({ ...query, data: ratingData })])),
      useCancelRatingExport: () => ({ isPending: false, error: null, mutate() {} }) },
    '@/entities/operational-rating': load('entities/operational-rating/index.ts'),
    '@/hooks/use-debounced-commit': { useDebouncedCommit: value => [value, () => {}] },
    '@/features/duty-register/model/workspace': load('features/duty-register/model/workspace.ts'),
    '@/hooks/use-strength-report': {
      useTrafficLightTree: enabled => { onTrafficRead(enabled); return trafficTree ?? { ...query, isError: false }; },
      useStrengthReport: () => ({ ...query, data: { business_date: '2026-10-21', columns: ['IN_SERVICE', 'VACATION'],
        rows: [], totals: { staff_total: 10, list_total: 8, vacancies: 2, off_list: 0, attached: 0,
          columns: { IN_SERVICE: 5, VACATION: 3 } } } }),
      useStrengthReportPeriod: () => query,
    },
  };
  const screenModule = load(file, dependencies);
  function render() {
  const page = screenModule[exportName]();
  const screen = nodes(page).find(node => typeof node.type === 'function' &&
    ['ServiceAnalyticsScreen', 'OperationsAnalyticsScreen', 'RatingEmployeeDetailScreen', 'EvaluationRegistryScreen',
      'EvaluationWorkspaceScreen'].includes(node.type.name));
  return screen ? screen.type(screen.props) : page;
  }
  return reusable ? render : render();
}

const ratingDestinations = [
  '/security-ops/ratings', '/security-ops/ratings/workspace', '/security-ops/ratings/evaluations',
  '/security-ops/ratings/export', '/security-ops/ratings/audit', '/security-ops/ratings/analytics',
];
const ratingAnchors = tree => nodes(tree).filter(node => node.type === 'a').map(node => node.props.href);
function renderRatingsNavigation(grants) {
  const { RatingsNav } = load('features/ops-ratings/ratings-nav.tsx', {
    'next/link': { default: 'a' },
    'next/navigation': { usePathname: () => '/security-ops/ratings/export/' },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => grants },
    '@/entities/portal-access': portal,
  });
  return RatingsNav();
}

for (const [permissions, expected] of [
  [['rating.view_aggregate'], [ratingDestinations[0], ratingDestinations[2]]],
  [['rating.evaluate'], [ratingDestinations[1]]],
  [['rating.export'], [ratingDestinations[3]]],
  [['rating.view_audit'], [ratingDestinations[4]]],
  [['analytics.view'], [ratingDestinations[5]]],
  [['analytics.operations'], []],
  [[], []],
  [['rating.export', 'rating.view_audit', 'analytics.view'], ratingDestinations.slice(3)],
  [['rating.view_aggregate', 'rating.evaluate'], ratingDestinations.slice(0, 3)],
  [['*'], ratingDestinations],
]) test(`real RatingsNav anchors preserve independent destinations for ${permissions.join('+') || 'no grants'}`, () => {
  assert.deepEqual(ratingAnchors(renderRatingsNavigation(access(permissions))), expected);
});

test('real RatingsNav never offers cached destinations while authority is pending, failed or undefined', () => {
  for (const state of [{ isLoading: true }, { error: Error('offline') }, { permissions: undefined }]) {
    assert.deepEqual(ratingAnchors(renderRatingsNavigation(access(['*'], state))), []);
  }
});

test('real RatingsNav applies shared optional role constraints without inferring permission from role names', t => {
  portal.MODULE_ROLE['/security-ops/ratings/export'] = 'EXPORT_NAV_READER';
  t.after(() => { delete portal.MODULE_ROLE['/security-ops/ratings/export']; });
  assert.deepEqual(ratingAnchors(renderRatingsNavigation(access(['rating.export']))), []);
  assert.deepEqual(ratingAnchors(renderRatingsNavigation(access(['rating.export'], { roles: [{ code: 'EXPORT_NAV_READER' }] }))), [ratingDestinations[3]]);
  assert.deepEqual(ratingAnchors(renderRatingsNavigation(access([], { roles: [{ code: 'EXPORT_NAV_READER' }] }))), []);
  assert.deepEqual(ratingAnchors(renderRatingsNavigation(access(['*']))), ratingDestinations);
});

for (const [file, permission, expected] of [
  ['app/security-ops/ratings/export/page.tsx', 'rating.export', [ratingDestinations[3]]],
  ['app/security-ops/ratings/audit/page.tsx', 'rating.view_audit', [ratingDestinations[4]]],
  ['app/security-ops/ratings/workspace/page.tsx', 'rating.evaluate', [ratingDestinations[1]]],
]) test(`${file}: own permitted screen remains mounted without aggregate access and uses the actual filtered nav`, () => {
  const tree = renderScreen(file, access([permission]));
  assert.ok(nodes(tree).some(node => node.type === 'DashboardLayout'), 'do not turn an independent permitted host into aggregate access denial');
  const nav = nodes(tree).find(node => node.type?.name === 'RatingsNav');
  assert.ok(nav, 'the page fixture must execute the real navigation rather than a feature marker');
  assert.deepEqual(ratingAnchors(nav.type(nav.props)), expected);
});

function analyticTabs(tree) {
  let nav = nodes(tree).find(node => node.type?.name === 'AnalyticsNavigation');
  if (nav) nav = nav.type(nav.props);
  else nav = nodes(tree).find(node => node.props?.['aria-label'] === 'Разделы аналитики');
  return nodes(nav).filter(node => node.props?.href).map(node => ({
    href: node.props.href, label: visibleText(node), current: node.props['aria-current'],
  }));
}

test('operations-only authority loads operations analytics without service analytics rights', async () => {
  const requests = [];
  const hooks = load('hooks/use-ops-analytics.ts', {
    '@/hooks/use-ops-protected-read': {
      useOpsReadAccess: permission => ({ allowed: access(['analytics.operations']).hasPermission(permission) }),
      useOpsProtectedRead: (_prefix, _parts, authority, read) => ({
        fetch: async () => authority.allowed ? read() : undefined,
      }),
    },
    '@/lib/ops-api': { opsApiClient: { get: async url => { requests.push(url); return { data: { rows: [] } }; } } },
    '@/entities/service-analytics': { OPERATIONS_ANALYTICS_PATH: '/api/ops/operations-analytics/' },
  });
  const result = await hooks.useOperationsAnalytics({ level: 'EVENT', eventId: 'own-event' }).fetch();
  assert.ok(result, 'analytics.operations must be sufficient to request its own endpoint');
  assert.deepEqual(requests, ['/api/ops/operations-analytics/?level=EVENT&event_id=own-event']);
});

test('service-only authority cannot issue an operations analytics request', async () => {
  const requests = [];
  const hooks = load('hooks/use-ops-analytics.ts', {
    '@/hooks/use-ops-protected-read': {
      useOpsReadAccess: permission => ({ allowed: access(['analytics.view']).hasPermission(permission) }),
      useOpsProtectedRead: (_prefix, _parts, authority, read) => ({
        fetch: async () => authority.allowed ? read() : undefined,
      }),
    },
    '@/lib/ops-api': { opsApiClient: { get: async url => { requests.push(url); return {}; } } },
    '@/entities/service-analytics': { OPERATIONS_ANALYTICS_PATH: '/api/ops/operations-analytics/' },
  });
  await hooks.useOperationsAnalytics({ level: 'ALL' }).fetch();
  assert.deepEqual(requests, []);
});

const service = 'app/security-ops/analytics/page.tsx';
const operations = 'app/security-ops/analytics/operations/page.tsx';
const rating = 'app/security-ops/ratings/analytics/page.tsx';

const submissionTree = { business_date: '2026-10-21', control_hour: '10:00:00', nodes: [
  { division_id: 21, name: 'Submitted division', parent_id: null, status: 'GREEN', late: false },
  { division_id: 22, name: 'Missing division', parent_id: null, status: 'RED', late: false },
] };
const successfulTree = { data: submissionTree, isPending: false, isError: false };
function submissionContent(page) {
  const section = nodes(page).find(node => node.type?.name === 'DaySubmissionSection');
  assert.ok(section, 'execute the real child mounted by the real analytics host');
  return section.type(section.props);
}
const reportLinks = tree => nodes(tree).filter(node => node.type === 'a' && node.props.href === '/reports');
function assertSubmissionSummary(tree) {
  const text = visibleText(tree);
  assert.match(text, /2026-10-21/);
  assert.match(text, /подразделений 2/);
  assert.match(text, /сдали 1/);
  assert.match(text, /не сдали 1/);
  assert.match(text, /10:00/);
  assert.equal(nodes(tree).filter(node => node.type?.name === 'DivisionTreeRow').length, 2);
}
for (const [name,grants,linked,summary] of [
  ['source-only reader',access(['analytics.view','status.view']),false,true],
  ['reports destination grant',access(['analytics.view','status.view','daily_report.generate']),true,true],
  ['wildcard',access(['*']),true,true],
  ['unknown authority despite cached checker',access(['*'],{permissions:undefined}),false,true],
  ['loading cached reports grant',access(['analytics.view','status.view','daily_report.generate'],{isLoading:true}),false,false],
  ['failed cached reports grant',access(['analytics.view','status.view','daily_report.generate'],{error:Error('permissions unavailable')}),false,true],
]) test('successful day submission reports destination: '+name, () => {
  const content = submissionContent(renderScreen(service,grants,{trafficTree:successfulTree}));
  assert.equal(reportLinks(content).length,linked?1:0);
  if(summary)assertSubmissionSummary(content);
});
test('same successful day summary drops only the reports anchor after destination revocation', () => {
  let grants = access(['analytics.view','status.view','daily_report.generate']);
  const render = renderScreen(service,()=>grants,{trafficTree:successfulTree,reusable:true});
  const before = submissionContent(render());
  assert.equal(reportLinks(before).length,1);
  assertSubmissionSummary(before);
  const summary = visibleText(before).replace('Открыть расход','');
  grants = access(['analytics.view','status.view']);
  const after = submissionContent(render());
  assert.equal(reportLinks(after).length,0);
  assertSubmissionSummary(after);
  assert.equal(visibleText(after),summary);
});
for(const [name,grants,tree,enabled] of [
  ['status read denied',access(['analytics.view','daily_report.generate']),successfulTree,false],
  ['tree pending',access(['analytics.view','status.view','daily_report.generate']),{...successfulTree,isPending:true},true],
  ['tree error with old data',access(['analytics.view','status.view','daily_report.generate']),{...successfulTree,isError:true},true],
  ['tree missing',access(['analytics.view','status.view','daily_report.generate']),{isPending:false,isError:false,data:undefined},true],
]) test('day submission early state does not offer reports: '+name,()=>{
  const reads=[];
  const content=submissionContent(renderScreen(service,grants,{trafficTree:tree,onTrafficRead:value=>reads.push(value)}));
  assert.equal(reportLinks(content).length,0);
  assert.deepEqual(reads,[enabled]);
  assert.doesNotMatch(visibleText(content),/подразделений 2/);
});

for (const [file, current] of [[service, '/security-ops/analytics'], [operations, '/security-ops/analytics/operations'],
  [rating, '/security-ops/ratings/analytics']]) {
  for (const [permissions, expected] of [
    [['analytics.view'], ['/security-ops/analytics', '/security-ops/ratings/analytics']],
    [['analytics.operations'], ['/security-ops/analytics/operations']],
    [['analytics.view', 'analytics.operations'], ['/security-ops/analytics', '/security-ops/analytics/operations', '/security-ops/ratings/analytics']],
    [['*'], ['/security-ops/analytics', '/security-ops/analytics/operations', '/security-ops/ratings/analytics']],
  ]) {
    // Test only screens the actor can enter; the route guard has its own tests.
    if (!permissions.includes('*') && !permissions.includes(file === operations ? 'analytics.operations' : 'analytics.view')) continue;
    test(`${file}: tabs show only authorized destinations for ${permissions.join('+')}`, () => {
      const tabs = analyticTabs(renderScreen(file, access(permissions)));
      assert.deepEqual(tabs.map(tab => tab.href), expected);
      assert.equal(tabs.find(tab => tab.href === current)?.current, 'page');
    });
  }
  for (const state of [{ isLoading: true }, { error: new Error('permissions unavailable'), isLoading: true }]) {
    test(`${file}: unresolved authority does not advertise analytics destinations (${state.error ? 'failure' : 'loading'})`, () => {
      assert.deepEqual(analyticTabs(renderScreen(file, access([], state))), []);
    });
  }
}

test('personnel KPI distinguishes ten staff positions from eight people on the list', () => {
  const page = renderScreen(service, access(['analytics.view', 'status.view']));
  const personnel = nodes(page).find(node => node.type?.name === 'PersonnelSection');
  const content = personnel.type(personnel.props);
  const kpi = nodes(content).find(node => node.type?.name === 'PersonnelKpi');
  const tiles = nodes(kpi.type(kpi.props)).filter(node => node.type === 'div')
    .map(node => nodes(node).filter(child => child.type === 'p').map(visibleText));
  assert.deepEqual(tiles.find(tile => tile[0] === 'Штатная численность'), ['Штатная численность', '10', 'по штатному расписанию']);
  assert.deepEqual(tiles.find(tile => tile[0] === 'Списочная численность'), ['Списочная численность', '8', '80,0% от штатной']);
  assert.deepEqual(tiles.find(tile => tile[0] === 'В строю'), ['В строю', '5', '62,5% списочной']);
});

test('scoped operations denial explains the unavailable scope instead of retrying a transport failure', () => {
  const page = renderScreen(operations, access(['analytics.operations']), {
    queryError: { errorCode: 'ANALYTICS_SCOPE_UNAVAILABLE', status: 403, message: 'server detail' },
  });
  const status = nodes(page).find(node => node.props?.role === 'status' &&
    visibleText(node).includes('Аналитика ограниченной области пока недоступна'));
  assert.ok(status, 'the authorized actor needs a specific explanation for the unavailable scope');
  assert.ok(visibleText(status).includes('подразделение'));
  assert.equal(nodes(page).filter(node => node.type === 'LoadFailure').length, 0);
});

test('transient operations load failure keeps its retry action', () => {
  const page = renderScreen(operations, access(['analytics.operations']), {
    queryError: { errorCode: 'SERVER_ERROR', status: 503, message: 'internal stack' },
  });
  const failure = nodes(page).find(node => node.type === 'LoadFailure');
  assert.equal(typeof failure?.props.onRetry, 'function');
  assert.equal(visibleText(page).includes('internal stack'), false);
});

const ratingFigures = { unpublishedReason: null, figures: { ratedParticipants: 100, coveredParticipants: 100,
  totalParticipants: 120, withoutAggregate: 20, correctedEvaluations: 2, distribution: [], groups: [] },
  policy: {}, unavailableViews: [] };

test('scoped rating analytics explains its unavailable scope and hides cached global figures', () => {
  const page = renderScreen(rating, access(['analytics.view']), { ratingData: ratingFigures,
    queryError: { errorCode: 'ANALYTICS_SCOPE_UNAVAILABLE', status: 403, message: 'internal detail' } });
  const status = nodes(page).find(node => node.props?.role === 'status' &&
    visibleText(node).includes('Аналитика рейтинга для вашей области пока недоступна'));
  assert.ok(status);
  assert.match(visibleText(status), /подразделени/);
  assert.equal(nodes(page).some(node => node.type === 'LoadFailure'), false);
  assert.equal(nodes(page).some(node => node.props?.['aria-label'] === 'Количественные показатели'), false);
  assert.doesNotMatch(visibleText(page), /internal detail/);
});

for (const state of [{ queryError: { status: 503 } }, { readAccessBlocked: true }]) {
  test(`rating figures stay hidden while their read ${state.readAccessBlocked ? 'is blocked' : 'fails temporarily'}`, () => {
    const page = renderScreen(rating, access(['analytics.view']), { ratingData: ratingFigures, ...state });
    assert.equal(nodes(page).some(node => node.props?.['aria-label'] === 'Количественные показатели'), false);
    assert.equal(typeof nodes(page).find(node => node.type === 'LoadFailure')?.props.onRetry, 'function');
  });
}

test('rating figures wait for resolved permissions and render after a successful authorized read', () => {
  const pending = renderScreen(rating, access(['analytics.view'], { isLoading: true }), { ratingData: ratingFigures });
  assert.equal(nodes(pending).some(node => node.props?.['aria-label'] === 'Количественные показатели'), false);
  const loaded = renderScreen(rating, access(['analytics.view']), { ratingData: ratingFigures });
  assert.equal(nodes(loaded).some(node => node.props?.['aria-label'] === 'Количественные показатели'), true);
});

function sourceFixture(t) {
  const { QueryClient, QueryObserver } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  const counts = new Map(), observers = [];
  t.after(() => { observers.forEach(unsubscribe => unsubscribe()); client.clear(); });
  function add(key, { enabled = true, active = true } = {}) {
    const name = key.join('/');
    counts.set(name, 0);
    client.setQueryData(key, { version: 'old' });
    const observer = new QueryObserver(client, { queryKey: key, enabled, queryFn: async () => {
      counts.set(name, counts.get(name) + 1); return { version: 'fresh' };
    } });
    if (active) observers.push(observer.subscribe(() => {}));
    return name;
  }
  return { client, counts, add };
}

test('header refresh reloads every mounted source and skips disabled, inactive and unrelated queries', async t => {
  const f = sourceFixture(t);
  const refreshed = [
    ['ops-analytics', 'presets', 'current'], ['ops-analytics', 'snapshot', 'current', 'TODAY'],
    ['ops-analytics', 'attention', 'current', 'TODAY'], ['ops-analytics', 'load', 'current'],
    ['strength-report', 'live', 'current', 'today'], ['strength-report', 'period', 'current', '2026-10-01', '2026-10-21', 'FACT'],
    ['traffic-light', 'tree', 'current', 'today'], ['traffic-light', 'division', 'current', 12],
    ['ops-notifications', 'feed'], ['ops-daily', 'divisions', 'paths'],
  ].map(key => f.add(key));
  const ignored = [f.add(['strength-report', 'live', 'old-authority', 'today'], { active: false }),
    f.add(['traffic-light', 'division', 99], { enabled: false }), f.add(['unrelated', 'screen'])];
  const page = renderScreen(service, access(['analytics.view', 'status.view']), { queryClient: f.client });
  const header = nodes(page).find(node => node.type === 'PageHeader');
  const refresh = nodes(header.props.actions).find(node => node.type === 'button');
  await refresh.props.onClick();
  for (const name of refreshed) assert.equal(f.counts.get(name), 1, name + ' must refresh');
  for (const name of ignored) assert.equal(f.counts.get(name), 0, name + ' must stay untouched');
});

test('header freshness cannot claim an updated screen after one personnel source failed', t => {
  const f = sourceFixture(t);
  f.add(['ops-analytics', 'snapshot', 'current', 'TODAY']);
  const key = ['strength-report', 'live', 'current', 'today']; f.add(key);
  f.client.getQueryCache().find({ queryKey: key, exact: true }).setState({ status: 'error', error: Error('Temporary report failure') });
  const page = renderScreen(service, access(['analytics.view', 'status.view']), { queryClient: f.client, mounted: true });
  const header = nodes(page).find(node => node.type === 'PageHeader');
  assert.match(visibleText(header.props.actions), /Часть источников не обновлена/);
});

test('a historical shift period is separate from the current personnel source date', () => {
  const snapshot = { snapshotId: 'historical', businessDate: '2026-10-20', timezone: 'Asia/Qyzylorda',
    period: { from: '2026-10-01', to: '2026-10-03', presetCode: null },
    scope: { safeLabel: 'Доступные подразделения' }, generatedAt: '2026-10-20T10:00:00+05:00',
    sourceUpdatedAt: null, freshnessState: 'CURRENT', completenessState: 'COMPLETE',
    calculationVersion: '1', policyVersion: '1', data: { metrics: [], unavailableMetrics: [] },
    unavailableHeaderBlocks: [], drilldownAllowed: false, drilldownDeniedReason: null };
  const page = renderScreen(service, access(['analytics.view', 'status.view']), { snapshot });
  const personnel = nodes(page).find(node => node.type?.name === 'PersonnelSection');
  const current = visibleText(personnel.type(personnel.props));
  assert.match(current, /Кадровый расход на 2026-10-21/);
  const period = nodes(page).find(node => node.props?.['aria-label'] === 'Шапка аналитики');
  assert.match(visibleText(period), /Период смен и динамики/);
  assert.match(visibleText(period), /2026-10-01 — 2026-10-03/);
  assert.doesNotMatch(current, /Кадровый расход на 2026-10-20/);
});

function ratingFailureDom(page) {
  let failure = nodes(page).find(node => node.type === 'LoadFailure' || node.type?.name === 'RatingReadFailure');
  if (failure?.type?.name === 'RatingReadFailure') failure = failure.type(failure.props);
  return failure?.type === 'LoadFailure' ? load('components/load-failure.tsx').LoadFailure(failure.props) : failure;
}

const aggregate = { employeeId: 'outside', safeLabel: 'outside-scope-person', aggregateRating: 9,
  evaluationsCount: 3, periodStartsAt: '2026-10-01', periodEndsAt: '2026-10-20', dataState: 'READY' };
const ratingsCapabilities = { operationalRatings: true };
const ratingScopeScreens = [
  ['summary', 'app/security-ops/ratings/page.tsx', 'default', {
    capabilities: ratingsCapabilities, policy: null, results: [aggregate], unavailableFactors: [], unavailableViews: [],
  }, data => ({ ...data, results: [] }), /Участников рейтинга пока нет/],
  ['dynamics', 'features/ops-ratings/rating-dynamics-section.tsx', 'RatingDynamicsSection', {
    capabilities: ratingsCapabilities, employeeId: 'outside', safeLabel: 'outside-scope-person',
    employees: [{ employeeId: 'outside', safeLabel: 'outside-scope-person' }], points: [], boundaries: [],
  }, data => data, /Закрытых периодов ещё нет/],
  ['employee detail', 'app/security-ops/ratings/employees/[employeeId]/page.tsx', 'default', {
    safeLabel: 'outside-scope-person', unitSafeLabel: 'outside-division', summary: aggregate, points: [], unavailableViews: [],
  }, data => data, /Закрытых периодов ещё нет/],
  ['registry', 'app/security-ops/ratings/evaluations/page.tsx', 'default', {
    capabilities: ratingsCapabilities, options: { events: [], units: [], employees: [] }, page: 1, pageCount: 1, total: 1,
    results: [{ rowId: 'outside', employeeSafeLabel: 'outside-scope-person', employeeId: null, unitSafeLabel: 'outside-division',
      aggregateRating: 9, aggregateState: 'READY' }], unavailableViews: [],
  }, data => ({ ...data, results: [], total: 0 }), /По выбранным условиям оценки не найдены/],
];

for (const [name, file, exportName, cached, empty, emptyLabel] of ratingScopeScreens) {
  test(`${name}: scoped rating limitation replaces retry and cached rows while ordinary states remain usable`, () => {
    let retries = 0;
    const render = options => renderScreen(file, access(['rating.view_aggregate']), { exportName,
      onRefetch: () => { retries++; }, ...options });
    const scoped = render({ ratingData: cached,
      queryError: { status: 403, errorCode: 'ANALYTICS_SCOPE_UNAVAILABLE', message: 'internal ownership detail' } });
    const scopeNotice = ratingFailureDom(scoped);
    assert.equal(scopeNotice?.props.role, 'status', 'known scope limitation must have an explicit business explanation');
    assert.match(visibleText(scopeNotice), /области доступа|подразделени/);
    assert.equal(nodes(scopeNotice).some(node => node.type === 'button'), false, 'retry cannot create a supported scope');
    assert.doesNotMatch(visibleText(scoped), /outside-scope-person|outside-division|internal ownership detail/);
    assert.equal(retries, 0);

    const failure = ratingFailureDom(render({ queryError: { status: 503, errorCode: 'SERVER_ERROR' } }));
    const retry = nodes(failure).find(node => node.type === 'button');
    assert.ok(retry, 'transient errors retain the existing retry'); retry.props.onClick(); assert.equal(retries, 1);
    assert.match(visibleText(render({ loading: true })), /Загрузка/);
    assert.match(visibleText(render({ ratingData: empty(cached) })), emptyLabel);
  });
}

