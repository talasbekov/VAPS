// Daily source authority is exercised through real readers and React Query cache.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const front = path.resolve(__dirname, '../..');
const localRequire = createRequire(path.join(front, 'package.json'));
const ts = localRequire('typescript');
const React = localRequire('react');
const { renderToStaticMarkup } = localRequire('react-dom/server');
const query = localRequire('@tanstack/react-query');
const date = '2026-10-27';
const pass = ({ children }) => React.createElement(React.Fragment, null, children);
const empty = () => null;

function fixture(t) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60000 } } });
  t.after(() => client.clear());
  const state = { options: [], mutations: [], scope: 2, status: 200, response: {}, report: { business_date: date, rows: [] } };
  const grants = scope => ({ permissions: ['status.view', 'daily_report.generate'], global_permissions: [],
    roles: [{ code: 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id: scope }] });
  const changeScope = scope => { state.scope = scope; client.setQueryData(['ops-me'], grants(scope)); };
  changeScope(2);
  const permissions = () => {
    const current = client.getQueryState(['ops-me']);
    const data = current.data;
    return { permissions: new Set(data.permissions), globalPermissions: new Set(data.global_permissions),
      roles: data.roles, isLoading: false, error: current.error,
      hasPermission: code => current.status === 'success' && data.permissions.includes(code) };
  };
  const mutation = () => ({ error: null, isPending: false, isSuccess: false, reset() {}, mutate() {} });
  const read = async () => {
    if (state.pending) await state.pending;
    if (state.status !== 200) throw Object.assign(new Error('Forbidden'), { status: state.status });
    return state.response;
  };
  const overrides = {
    'next-auth/react': { useSession: () => ({ data: { user: { id: 'same-actor' } }, status: 'authenticated' }) },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useIsFetching: filters => client.isFetching(filters),
      useMutation: options => { state.mutations.push(options); return mutation(); }, useQuery: options => {
      state.options.push(options); return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: permissions },
    '@/hooks/use-strength-report': { useStrengthReport: () => ({ data: state.report, isSuccess: true }), useTrafficLightTree: () => ({}) },
    '@/hooks/use-ops-status-types': { useOpsStatusTypes: () => ({ all: [] }) },
    '@/hooks/use-daily-summary-write': { SUMMARY_ASSEMBLE_PERMISSION: 'daily_report.generate', useAssembleSummary: mutation, useSendSummary: mutation },
    '@/hooks/use-ops-mutation': { useOpsMutation: mutation },
    '@/lib/api': { apiClient: { getTomorrowBlockState: read } },
    '@/lib/ops-api': { opsApiClient: { get: read } },
    '@/components/ui/badge': { Badge: pass }, '@/components/ui/button': { Button: pass },
    '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, pass])),
  };
  const cache = new Map();
  function load(id, importer) {
    if (id in overrides) return overrides[id];
    if (id === './SummaryCorrection') return { SummaryCorrection: empty };
    if (id === './StatusDetails') return { statusPeriod: () => '' };
    if (id === './business-date') return { useBusinessDate: () => ({ businessDate: date }) };
    if (!id.startsWith('@/') && !id.startsWith('.')) return localRequire(id);
    const base = id.startsWith('@/') ? path.join(front, id.slice(2)) : path.resolve(path.dirname(importer), id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw new Error('Missing ' + id);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: name => load(name, file), URLSearchParams, Intl, Date });
    return exports;
  }
  const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
  const fetch = options => client.fetchQuery({ ...options, staleTime: 0, retry: false });
  return { client, state, load, render, fetch, changeScope, useReal: id => { delete overrides[id]; } };
}

test('a late daily response is discarded when authority changes while it is in flight', async t => {
  const f = fixture(t);
  const { useDailyExpenseRead } = f.load('@/hooks/use-daily-expense-read');
  let finish;
  f.state.pending = new Promise(resolve => { finish = resolve; });
  const transport = () => f.state.pending.then(() => ({ marker: 'OLD_SCOPE' }));
  useDailyExpenseRead('late-source', [], transport);
  const options = f.state.options.at(-1);
  const pending = f.fetch(options);
  f.changeScope(18);
  finish();
  await assert.rejects(pending, error => error.status === 403);
  assert.equal(f.client.getQueryData(options.queryKey), undefined);
});

test('summary 403 hides sent author and incomplete reason through retry failure until a fresh read', async t => {
  const f = fixture(t);
  const { SummaryVersions } = f.load('@/features/daily-expense/ui/SummaryVersions');
  const props = { businessDate: date, boardDivisionIds: [2], scopeDivisionId: 2, labelOfDivision: () => 'Old department' };
  f.render(SummaryVersions, props);
  const options = f.state.options.find(item => item.queryKey[1] === 'summaries');
  f.state.response = { results: [{ id: 77, division_id: '2', business_date: date, version: 1,
    is_current: true, event: 'SUBMITTED', submitted_by: 'submitter', submitted_at: date + 'T08:00:00Z', late: false,
    sent_at: date + 'T08:00:00Z', sent_by: 'PRIVATE_OLD_AUTHOR', incomplete_reason: 'PRIVATE_OLD_REASON' }] };
  // Use an event accepted by the real parser.
  f.state.response.results[0].event = 'CHANGED';
  await f.fetch(options);
  assert.match(f.render(SummaryVersions, props), /PRIVATE_OLD_AUTHOR/);
  f.state.status = 403;
  await assert.rejects(f.fetch(options));
  const html = f.render(SummaryVersions, props);
  assert.match(html, /Не удалось узнать, собирался ли свод/);
  assert.doesNotMatch(html, /PRIVATE_OLD_AUTHOR|PRIVATE_OLD_REASON/);
  f.state.status = 503;
  await assert.rejects(f.fetch(options));
  assert.doesNotMatch(f.render(SummaryVersions, props), /PRIVATE_OLD_AUTHOR|PRIVATE_OLD_REASON/);
  f.state.status = 200;
  f.state.response.results[0] = { ...f.state.response.results[0], sent_by: 'FRESH_AUTHOR', incomplete_reason: '' };
  await f.fetch(options);
  assert.match(f.render(SummaryVersions, props), /FRESH_AUTHOR/);
});

test('same actor new scope cannot reuse a personnel snapshot and can load its own fresh response', async t => {
  const f = fixture(t);
  const { VersionSnapshot } = f.load('@/features/daily-expense/ui/VersionSnapshot');
  f.render(VersionSnapshot, { id: 77 });
  const first = f.state.options.at(-1);
  f.state.response = { snapshot: { roster: [{ employee_id: 123, full_name: 'PRIVATE_OLD_PERSON' }], rows: [], sources: [] } };
  await f.fetch(first);
  assert.match(f.render(VersionSnapshot, { id: 77 }), /PRIVATE_OLD_PERSON/);
  f.changeScope(18);
  const html = f.render(VersionSnapshot, { id: 77 });
  const current = f.state.options.at(-1);
  assert.notDeepEqual(current.queryKey, first.queryKey);
  assert.doesNotMatch(html, /PRIVATE_OLD_PERSON/);
  await assert.rejects(f.fetch(first), error => error.status === 403);
  f.state.response = { snapshot: { roster: [{ employee_id: 456, full_name: 'FRESH_OWN_PERSON' }], rows: [], sources: [] } };
  await f.fetch(current);
  assert.match(f.render(VersionSnapshot, { id: 77 }), /FRESH_OWN_PERSON/);
  f.state.status = 403;
  await assert.rejects(f.fetch(current));
  assert.doesNotMatch(f.render(VersionSnapshot, { id: 77 }), /PRIVATE_OLD_PERSON|FRESH_OWN_PERSON/);
});

test('responsible department scope change waits for the new structure and refetches it without a false error', async t => {
  const f = fixture(t);
  const { useResponsibleDaily } = f.load('@/features/daily-expense/model/directorate-summary');
  useResponsibleDaily(date);
  const first = f.state.options.find(item => item.queryKey[1] === 'responsible-divisions');
  f.state.response = { results: [{ id: '2', parent_id: null, division_type: 'department', name: 'Old department', without_status: 0 }] };
  await f.fetch(first);
  assert.equal(useResponsibleDaily(date).data.scope.id, '2');
  f.changeScope(18);
  const result = useResponsibleDaily(date);
  const current = f.state.options.filter(item => item.queryKey[1] === 'responsible-divisions').at(-1);
  assert.notDeepEqual(current.queryKey, first.queryKey);
  assert.equal(result.data, null);
  assert.equal(result.structureError, null);
  f.state.response = { results: [{ id: '18', parent_id: null, division_type: 'department', name: 'Own department', without_status: 0 }] };
  await f.fetch(current);
  const fresh = useResponsibleDaily(date);
  assert.equal(fresh.data.scope.id, '18');
  assert.equal(fresh.structureError, null);
});

test('nested day history denial hides retained submitted metadata instead of presenting a successful day', async t => {
  const f = fixture(t);
  const { DaySubmissionPanel } = f.load('@/features/ops-daily/day-submission-panel');
  const submission = { id: 77, division_id: '2', business_date: date, version: 1,
    is_current: true, event: 'CHANGED', submitted_by: 'PRIVATE_SUBMITTER', submitted_at: date + 'T08:00:00Z',
    late: false, sent_at: null, sent_by: '', incomplete_reason: '' };
  const props = { divisionId: '2', businessDate: date, dateValid: true, rowCount: 1, dirtyCount: 0,
    localDrift: [], submission, submissions: [submission], isLoading: false, isError: false, canCorrect: false };
  f.render(DaySubmissionPanel, props);
  const history = f.state.options.find(option => ['division-submissions', 'division-history'].includes(option.queryKey[1]));
  f.state.response = { results: [] };
  await f.fetch(history);
  assert.match(f.render(DaySubmissionPanel, props), /PRIVATE_SUBMITTER/);
  f.state.status = 403;
  await assert.rejects(f.fetch(history));
  const denied = f.render(DaySubmissionPanel, props);
  assert.doesNotMatch(denied, /PRIVATE_SUBMITTER/);
  assert.match(denied, /Повторить/);
});

test('a sibling denial clears daily data and exposes a retry error rather than success or endless loading', async t => {
  const f = fixture(t);
  const { useDailyExpenseRead } = f.load('@/hooks/use-daily-expense-read');
  const divisions = () => useDailyExpenseRead('divisions', [date], async () => ({ marker: 'OWN_STRUCTURE' }));
  const summaries = () => useDailyExpenseRead('summaries', [date, 2], async () => {
    if (f.state.status === 403) throw Object.assign(Error('Forbidden'), { status: 403 });
    return { results: [] };
  });
  divisions(); const divisionOptions = f.state.options.at(-1);
  summaries(); const summaryOptions = f.state.options.at(-1);
  await f.fetch(divisionOptions); await f.fetch(summaryOptions);
  f.state.status = 403;
  await assert.rejects(f.fetch(summaryOptions));
  const denied = divisions();
  assert.equal(denied.data, undefined);
  assert.equal(denied.isError, true);
  assert.equal(denied.isSuccess, false);
  assert.equal(denied.isPending, false);
  f.state.status = 200;
  await f.fetch(summaryOptions);
  assert.equal(divisions().data, undefined, 'rereading one source cannot revive another source');
  await denied.refetch();
  assert.equal(divisions().data.marker, 'OWN_STRUCTURE');
});

test('summary correction freshness belongs to the current authority and cannot retain an old scope status', async t => {
  const f = fixture(t);
  const { SummaryCorrection } = f.load('@/features/daily-expense/ui/SummaryCorrection');
  const props = { divisionId: 2, businessDate: date };
  f.render(SummaryCorrection, props);
  const first = f.state.options.at(-1);
  f.state.response = { status: 'STALE', can_rebuild: true };
  await f.fetch(first);
  assert.match(f.render(SummaryCorrection, props), /Свод устарел/);
  f.changeScope(18);
  assert.doesNotMatch(f.render(SummaryCorrection, props), /Свод устарел/);
  assert.notDeepEqual(f.state.options.at(-1).queryKey, first.queryKey);
});

test('existing assemble and send mutations invalidate the new daily authority keys', async t => {
  const f = fixture(t);
  f.useReal('@/hooks/use-daily-summary-write');
  const writes = f.load('@/hooks/use-daily-summary-write');
  writes.useAssembleSummary(); writes.useSendSummary();
  const { useDailyExpenseRead } = f.load('@/hooks/use-daily-expense-read');
  useDailyExpenseRead('summaries', [date, 2], async () => ({}));
  const key = f.state.options.at(-1).queryKey;
  for (const mutation of f.state.mutations) {
    f.client.setQueryData(key, { results: [] });
    f.client.setQueryData(['unrelated-reader'], { marker: 'unchanged' });
    await mutation.onSuccess();
    assert.equal(f.client.getQueryState(key).isInvalidated, true);
    assert.equal(f.client.getQueryState(['unrelated-reader']).isInvalidated, false);
  }
});
