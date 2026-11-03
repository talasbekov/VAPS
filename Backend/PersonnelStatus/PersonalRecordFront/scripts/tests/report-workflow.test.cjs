const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies, states = []) {
  let index = 0;
  let refIndex = 0;
  const refs = [];
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, URLSearchParams, require: name => {
    if (name === 'react') return { ...require('react'), useEffect: () => {}, useMemo: callback => callback(), useRef: initial => {
      const slot = refIndex++;
      return refs[slot] ??= { current: initial };
    }, useState: initial => {
      const slot = index++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
    } };
    return dependencies[name] ?? (name.startsWith('@/') || name.startsWith('./') || name === 'lucide-react'
      ? new Proxy({}, { get: (_, key) => key }) : require(name));
  } });
  return { exports, render: (name, props) => { index = 0; refIndex = 0; return exports[name](props); } };
}

function reportDependencies(access) {
  const mutation = { error: null, isPending: false };
  return {
    '@tanstack/react-query': { useQueryClient: () => ({ resetQueries() {} }) },
    'next/navigation': { useParams: () => ({ reportJobId: 'job-1' }), useRouter: () => ({}), usePathname: () => '/history', useSearchParams: () => new URLSearchParams() },
    '@/lib/utils': { cn: () => '' },
    '@/shared/hooks/use-toast': { useToast: () => ({ toast() {} }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/hooks/use-ops-protected-read': { useOpsReadAccess: () => ({ scope: 'test', allowed: !access.isLoading && !access.error && access.hasPermission('status.view') }) },
    '@/hooks/use-ops-read-snapshot': { useOpsReadSnapshot: () => ({ value: null, setValue() {}, isCurrent: () => true, canUseValue: () => true }) },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/security-ops/service-reports': 'report.generate' }, modulePermissionsOf: () => ['daily_report.generate'] },
    '@/hooks/use-ops-reports': {
      useReportTypes: () => ({ data: { results: [{ reportTypeCode: 'DAILY', safeTitle: 'Daily', unavailableReason: null, maxPeriodDays: 30 }], maskedFields: [], unavailableFormats: [], unavailableArtifactFields: [], retentionPolicy: { retentionDays: 30 } } }),
      useReportJobs: () => ({ isPending: true }),
      useReportJob: () => ({ error: null }),
      useCreateReportJob: () => mutation,
      useDownloadArtifact: () => mutation,
      useRerunReportJob: () => mutation,
      useEventDocumentKinds: () => ({ isPending: true }),
      useRenderEventDocument: () => mutation,
      useBulletinIssues: () => ({ isPending: true }),
      useIssueBulletin: () => mutation,
      useBulletinIssueFile: () => mutation,
    },
  };
}

for (const file of ['app/reports/page.tsx', 'app/security-ops/service-reports/page.tsx', 'app/security-ops/service-reports/[reportJobId]/page.tsx', 'app/security-ops/service-reports/history/page.tsx']) {
  const render = subject => {
    const page = subject.render('default');
    return nodes(file.includes('/history/') ? page.props.children.type() : page);
  };
  test(`${file} offers permission retry rather than using a cached grant after refresh failure`, () => {
    const subject = load(file, reportDependencies({ hasPermission: () => true, isLoading: false, error: Error('refresh failed') }));
    const tree = render(subject);
    assert.ok(tree.some(node => node.type === 'LoadFailure' && node.props.what === 'права доступа к отчётам'));
    assert.equal(tree.some(node => node.type === 'Button' || node.type === 'button'), false);
  });
  test(`${file} hides report controls while permissions load and after revocation`, () => {
    const access = { hasPermission: () => true, isLoading: true, error: null };
    const subject = load(file, reportDependencies(access));
    const loading = render(subject);
    assert.ok(loading.some(node => node.props?.role === 'status' && node.props.children === 'Проверяем доступ к отчётам…'));
    access.isLoading = false;
    access.hasPermission = () => false;
    assert.ok(render(subject).some(node => node.type === 'OpsAccessDenied'));
  });
}

test('service reports retain documents and history without the CSV generation form', () => {
  const subject = load('app/security-ops/service-reports/page.tsx', reportDependencies(
    { hasPermission: () => true, isLoading: false, error: null },
  ));
  const tree = nodes(subject.render('default'));
  assert.ok(tree.some(node => node.props?.['aria-label'] === 'Выгрузка документов ОМ'));
  assert.ok(tree.some(node => node.props?.href === '/security-ops/service-reports/history'));
  assert.equal(tree.some(node => node.props?.['aria-label'] === 'Форма запуска отчёта'), false);
  assert.equal(tree.some(node => node.type === 'button' && node.props.children === 'Скачать CSV'), false);
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('a blocked report job list offers its own fresh-read retry', () => {
  const deps = reportDependencies({ hasPermission: () => true, isLoading: false, error: null });
  let retried = 0;
  deps['@/hooks/use-ops-reports'].useReportJobs = () => ({ data: undefined, isError: false,
    readAccessBlocked: true, refetch: () => { retried++; } });
  const subject = load('app/security-ops/service-reports/page.tsx', deps);
  const retry = nodes(subject.render('default')).find(node => node.type === 'LoadFailure');
  assert.ok(retry, 'a success-state query with purged protected data still needs an actionable retry');
  retry.props.onRetry();
  assert.equal(retried, 1);
});

test('analytics refresh restores a purged period prerequisite before disabled snapshot reads', async t => {
  const { QueryClient, QueryObserver } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  t.after(() => client.clear());
  const reads = load('lib/query-read-access.ts', {}).exports;
  const refreshModel = load('features/service-analytics/model/refresh.ts', { '@/lib/query-read-access': reads }).exports;
  const calls = [];
  const presetKey = ['ops-analytics', 'presets', 'current'];
  const snapshotKey = ['ops-analytics', 'snapshot', 'current', 'TODAY'];
  let releasePresets;
  client.setQueryData(presetKey, { defaultPresetCode: 'TODAY', results: [] });
  const presets = new QueryObserver(client, { queryKey: presetKey, queryFn: ({ signal }) =>
    reads.readWithAccessCheck(client, presetKey, signal, async () => {
      calls.push('presets');
      await new Promise(resolve => { releasePresets = resolve; });
      return { defaultPresetCode: 'TODAY', results: [] };
    }) });
  const snapshotOptions = { queryKey: snapshotKey, enabled: false, queryFn: async () => {
    calls.push('snapshot'); return { snapshotId: 'fresh' };
  } };
  const snapshot = new QueryObserver(client, snapshotOptions);
  const stopPresets = presets.subscribe(() => {}), stopSnapshot = snapshot.subscribe(() => {});
  t.after(() => { stopPresets(); stopSnapshot(); });
  reads.blockReadAccess(client, presetKey, true);
  const empty = name => ({ data: undefined, error: null, dataUpdatedAt: 0, isFetching: false, isPending: false,
    isError: false, refetch: () => { calls.push(name); } });
  const subject = load('app/security-ops/analytics/page.tsx', {
    '@tanstack/react-query': { useQueryClient: () => client, useIsFetching: filters => client.isFetching(filters) },
    '@/features/service-analytics/model/refresh': refreshModel,
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/security-ops/analytics', useSearchParams: () => new URLSearchParams() },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true, isLoading: false }) },
    '@/hooks/use-ops-analytics': {
      useAnalyticsPresets: () => ({ ...presets.getCurrentResult(), readAccessBlocked: reads.isReadAccessBlocked(client, presetKey) }),
      useServiceAnalytics: period => {
        snapshot.setOptions({ ...snapshotOptions, enabled: period !== null });
        return snapshot.getCurrentResult();
      },
      useAttentionItems: () => empty('attention'), useAnalyticsDrilldown: () => empty('drilldown'),
    },
  });
  const page = subject.render('default');
  const tree = nodes(page.props.children.type());
  const header = tree.find(node => node.type === 'PageHeader');
  const refresh = nodes(header.props.actions).find(node => node.type === 'button');
  const refreshed = refresh.props.onClick();
  assert.deepEqual(calls, ['presets'], 'without a default period only its prerequisite can be fetched');
  const retry = tree.find(node => node.type === 'LoadFailure' && node.props.what === 'периоды аналитики');
  assert.ok(retry);
  releasePresets(); await refreshed;
  const restored = subject.render('default'); restored.props.children.type();
  await client.getQueryCache().find({ queryKey: snapshotKey, exact: true }).promise;
  assert.deepEqual(calls, ['presets', 'snapshot'], 'the recovered default period enables its snapshot on rerender');
  assert.equal(reads.isReadAccessBlocked(client, presetKey), false);
  assert.equal(client.getQueryData(snapshotKey).snapshotId, 'fresh');
});

test('row export uses the date of the displayed report after the date picker changes', async () => {
  let requested;
  const report = { business_date: '2026-10-08', rows: [
    { division_id: 12, name: 'Department', columns: {}, event: { total: 0 } },
  ], columns: [], column_labels: {} };
  const subject = load('app/reports/page.tsx', {
    '@tanstack/react-query': { useQueryClient: () => ({ resetQueries() {} }) },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true, isLoading: false }) },
    '@/hooks/use-ops-protected-read': { useOpsReadAccess: () => ({ scope: 'test', allowed: true }) },
    '@/hooks/use-ops-read-snapshot': { useOpsReadSnapshot: () => ({ value: report, setValue() {}, isCurrent: () => true, canUseValue: () => true }) },
    '@/entities/portal-access': { modulePermissionsOf: () => ['report.view'] },
    '@/shared/hooks/use-toast': { useToast: () => ({ toast() {} }) },
    '@/lib/api': { OpsApiError: Error, apiClient: {
      downloadStrengthReportExport: async args => { requested = args; throw Error('stop before browser download'); },
    } },
  }, [new Date('2026-10-09T12:00:00')]);
  const button = nodes(subject.render('default')).find(node => node.type === 'Button' && node.props.size === 'sm');
  await button.props.onClick();
  assert.equal(requested.businessDate, '2026-10-08');
});

test('incomplete summary has one send action beside its required reason', () => {
  const subject = load('features/daily-expense/ui/SummaryActionBar.tsx', {
    '@tanstack/react-query': { useQuery: () => ({ isSuccess: true, data: {} }) },
    '@/entities/daily-grid': { DAILY_SUBMISSIONS_PATH: '/daily', parseSubmissionList: () => [{ is_current: true, sent_at: null, version: 1 }] },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true, isLoading: false }) },
    '@/hooks/use-daily-summary-write': {
      useAssembleSummary: () => ({ error: null }), useSendSummary: () => ({ error: {}, isPending: false, isSuccess: false }),
    },
    './SummaryVersions': { assembleFailureText: () => null, sendFailureText: () => null, sendLaggardsOf: () => [12] },
  });
  const buttons = nodes(subject.render('SummaryActionBar', { businessDate: '2026-10-08', divisionId: 1, labelOfDivision: String }))
    .filter(node => node.type === 'Button');
  assert.equal(buttons.length, 2);
  const review = buttons.find(button => button.props.children === 'Проверить состав');
  assert.ok(review, 'the saved composition remains readable before sending');
  const confirmation = buttons.filter(button => button.props.children === 'Подтвердить отправку');
  assert.equal(confirmation.length, 1);
  assert.equal(confirmation[0].props.disabled, true);
});

for (const scenario of ['permission revoked', 'permission refresh failed', 'permissions loading', 'summary read failed', 'summary sent elsewhere', 'summary removed']) {
  test(`incomplete-send confirmation closes when ${scenario}`, () => {
    const access = { hasPermission: () => true, isLoading: false, error: null };
    const query = { isSuccess: true, isError: false, data: {} };
    let rows = [{ is_current: true, sent_at: null, version: 1 }];
    let sends = 0;
    const subject = load('features/daily-expense/ui/SummaryActionBar.tsx', {
      '@tanstack/react-query': { useQuery: () => query },
      '@/entities/daily-grid': { DAILY_SUBMISSIONS_PATH: '/daily', parseSubmissionList: () => rows },
      '@/shared/lib/date': { formatIsoDateTime: value => value },
      '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
      '@/hooks/use-daily-summary-write': {
        useAssembleSummary: () => ({ error: null }),
        useSendSummary: () => ({ error: {}, isPending: false, isSuccess: false, mutate: () => sends++ }),
      },
      './SummaryVersions': { assembleFailureText: () => null, sendFailureText: () => null, sendLaggardsOf: () => [12] },
    }, ['Waiting for one directorate']);
    const render = () => nodes(subject.render('SummaryActionBar', { businessDate: '2026-10-08', divisionId: 1, labelOfDivision: String }));
    const confirmation = tree => tree.find(node => node.type === 'Button' && node.props.children === 'Подтвердить отправку');
    assert.equal(confirmation(render()).props.disabled, false, 'the incomplete-send state starts actionable');
    if (scenario === 'permission revoked') access.hasPermission = () => false;
    if (scenario === 'permission refresh failed') access.error = Error('permissions unavailable');
    if (scenario === 'permissions loading') access.isLoading = true;
    if (scenario === 'summary read failed') { query.isSuccess = false; query.isError = true; }
    if (scenario === 'summary sent elsewhere') rows[0].sent_at = '2026-10-08T08:00:00Z';
    if (scenario === 'summary removed') rows = [];
    assert.equal(confirmation(render()), undefined, 'stale incomplete-send error must not keep confirmation actionable');
    assert.equal(sends, 0);
  });
}

for (const kind of ['server', 'network', 'forbidden', 'no grant']) {
  test(`shared access gate distinguishes ${kind} from permission denial`, async () => {
    // Load the real classes and classifier together so instanceof remains meaningful.
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../lib/ops-errors.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const classes = {}; vm.runInNewContext(code, { exports: classes });
    const init = { status: kind === 'forbidden' ? 403 : 503, message: 'Failure', errorCode: null, details: {}, requestId: null };
    const error = kind === 'server' ? new classes.OpsServerError(init) : kind === 'network' ? new classes.OpsNetworkError('Offline') : kind === 'forbidden' ? new classes.OpsApiError(init) : null;
    const helper = load('components/ops-permissions-unavailable.tsx', { '@/lib/ops-errors': classes });
    let finish;
    const calls = [];
    const subject = load('components/ops-access-denied.tsx', {
      '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ error, isLoading: false }) },
      '@tanstack/react-query': { useQueryClient: () => ({ refetchQueries: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); } }) },
      '@/components/ops-permissions-unavailable': {
        isPermissionsCheckFailure: value => helper.render('isPermissionsCheckFailure', value),
        OpsPermissionsUnavailable: 'OpsPermissionsUnavailable',
      },
    });
    const render = () => subject.render('OpsAccessDenied', { what: 'обзора' });
    const tree = render();
    if (kind === 'server' || kind === 'network') {
      assert.equal(tree.type, 'OpsPermissionsUnavailable');
      tree.props.onRetry();
      assert.equal(render().props.isRetrying, true);
      assert.equal(JSON.stringify(calls), '[{"queryKey":["ops-me"]}]');
      finish(); await Promise.resolve(); await Promise.resolve();
      assert.equal(render().props.isRetrying, false);
    } else {
      assert.equal(tree.type, 'DashboardLayout');
      assert.equal(calls.length, 0);
    }
  });
}
