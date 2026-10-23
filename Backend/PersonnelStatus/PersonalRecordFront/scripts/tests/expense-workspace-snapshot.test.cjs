const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');
const root = path.join(__dirname, '../..');

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, URLSearchParams, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const grid = load('entities/daily-grid/index.ts');
const workspace = load('features/forces-workspace/model/workspace.ts');
const grouping = load('features/daily-expense/model/directorate-summary.ts', {
  '@tanstack/react-query': {}, '@/lib/api': {}, '@/lib/ops-api': {}, '@/hooks/use-ops-permissions': {},
  '@/hooks/use-strength-report': {}, '@/hooks/use-ops-status-types': {}, '@/entities/daily-grid': grid,
  './business-date': {}, '@/features/forces-workspace/model/workspace': workspace,
});
const role = id => ({ code: 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id: id });
function access(roles = [role(2)], permissions = ['status.view', 'forces.allocate'], global = []) {
  return { roles, permissions: new Set(permissions), globalPermissions: new Set(global), isLoading: false, error: null,
    hasPermission: code => permissions.includes('*') || permissions.includes(code) };
}
const date = '2026-10-20';
const row = (division_id, count) => ({ division_id, list_total: count, off_list: 0, staff_total: count,
  vacancies: 0, attached: 0, columns: {} });
function fixture() {
  return {
    businessDate: date, actor: 'actor-1', access: access(),
    report: { business_date: date, rows: [row(2, 1), row(3, 2), row(18, 1), row(19, 3)] },
    divisions: { results: [
      { id: '2', name: 'Департамент А', parent_id: null, division_type: 'department', without_status: 0, notify_recipient_name: null },
      { id: '3', name: 'Управление А', parent_id: '2', division_type: 'directorate', without_status: 0, notify_recipient_name: 'Получатель А' },
      { id: '18', name: 'Департамент Б', parent_id: null, division_type: 'department', without_status: 0, notify_recipient_name: null },
      { id: '19', name: 'Управление Б', parent_id: '18', division_type: 'directorate', without_status: 0, notify_recipient_name: 'Получатель Б' },
    ] },
    submissions: { results: [] },
  };
}
function capture(state) {
  let options;
  const hook = load('features/forces-workspace/model/daily-action-queue.ts', {
    '@tanstack/react-query': { useQuery: value => { options = value; return { isPending: true }; } },
    '@/lib/api': { apiClient: { getStrengthReport: async args => {
      assert.equal(args.businessDate, state.businessDate);
      return state.report;
    } } },
    '@/lib/ops-api': { opsApiClient: { get: async endpoint => {
      const url = new URL(endpoint, 'http://localhost');
      assert.equal(url.searchParams.get('business_date'), state.businessDate);
      if (url.pathname === grid.DAILY_DIVISIONS_PATH) return state.divisions;
      if (url.pathname === grid.DAILY_SUBMISSIONS_PATH) return state.submissions;
      throw new Error(`Unexpected read: ${endpoint}`);
    } } },
    '@/lib/auth': { useAuth: () => ({ user: state.actor ? { id: state.actor } : null }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => state.access },
    '@/entities/daily-grid': grid,
    '@/features/daily-expense/model/business-date': { useBusinessDate: () => ({ businessDate: state.businessDate, dateError: false }) },
    '@/features/daily-expense/model/directorate-summary': grouping,
    './workspace': workspace,
  });
  const result = hook.useDailyActionQueue(state.businessDate);
  return { options, result };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });

test('changing only the responsible scope fetches a different snapshot without reusing source identities', async () => {
  const state = fixture(); const cache = client();
  try {
    const first = await cache.fetchQuery(capture(state).options);
    assert.equal(first.sources[0].division.name, 'Управление А');
    state.access = access([role(18)]);
    const nextOptions = capture(state).options;
    assert.equal(cache.getQueryData(nextOptions.queryKey), undefined);
    const next = await cache.fetchQuery(nextOptions);
    assert.equal(next.scope.id, '18');
    assert.equal(next.sources.length, 1);
    assert.equal(next.sources[0].division.name, 'Управление Б');
  } finally { cache.clear(); }
});

test('actor, authority and date changes cannot reuse a cached authorized snapshot', async () => {
  const initial = fixture(); const cache = client();
  try {
    await cache.fetchQuery(capture(initial).options);
    for (const next of [
      { ...initial, actor: 'actor-2' },
      { ...initial, businessDate: '2026-10-21' },
      { ...initial, access: access([role(2)], ['status.view', 'forces.allocate', 'report.generate']) },
      { ...initial, access: access([role(2)], ['status.view', 'forces.allocate'], ['status.view']) },
    ]) assert.equal(cache.getQueryData(capture(next).options.queryKey), undefined);
  } finally { cache.clear(); }
});

test('missing rights, unresolved permissions and ambiguous/global scope keep snapshot reads disabled', () => {
  const initial = fixture();
  for (const next of [
    { ...initial, actor: null },
    { ...initial, access: { ...access(), isLoading: true } },
    { ...initial, access: { ...access(), error: new Error('offline') } },
    { ...initial, access: access([role(2)], ['forces.allocate']) },
    { ...initial, access: access([role(2)], ['status.view']) },
    { ...initial, access: access([role(2), role(18)]) },
    { ...initial, access: access([role(null), role(2)]) },
    { ...initial, access: access([role(2)], ['*'], ['*']) },
  ]) assert.equal(capture(next).options.enabled, false);
});

test('a snapshot never succeeds when any required read fails', async () => {
  const state = fixture();
  state.submissions = Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
  // The rejection is consumed by the actual combined snapshot, not a mocked success flag.
  await assert.rejects(capture(state).options.queryFn(), error => error.status === 403);
});

test('wrong-date submissions cannot make an already-submitted source appear missing', async () => {
  const state = fixture();
  state.submissions.results = [{ id: 44, division_id: '3', business_date: '2026-10-19', version: 1,
    is_current: true, submitted_at: '2026-10-19T08:00:00Z', submitted_by: 'Начальник', late: false,
    event: 'CHANGED', sent_at: null, sent_by: '', incomplete_reason: '' }];
  await assert.rejects(capture(state).options.queryFn(), /другую дату/);
});

test('wrong-date strength and incomplete submission payloads are unavailable rather than a missing-source count', async () => {
  const state = fixture(); state.report.business_date = '2026-10-19';
  await assert.rejects(capture(state).options.queryFn(), /другую дату/);
  state.report.business_date = date; state.submissions.results = [{ division_id: '3' }];
  await assert.rejects(capture(state).options.queryFn(), /Некорректный ответ/);
});
