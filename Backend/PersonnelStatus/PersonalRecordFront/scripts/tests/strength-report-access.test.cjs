const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

function fixture(t) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const session = { user: { id: 'same-actor' } };
  const state = { options: null, status: 200, reads: [], data: { marker: 'wide-source', rows: [{ name: 'Other department' }] } };
  const wide = { permissions: ['status.view'], global_permissions: ['status.view'],
    roles: [{ code: 'STATUS_READER', scope_division_id: null }] };
  const narrow = { permissions: ['status.view'], global_permissions: [],
    roles: [{ code: 'STATUS_READER', scope_division_id: 12 }] };
  client.setQueryData(['ops-me'], wide);
  const modules = new Map();
  const readApi = method => async params => {
    state.reads.push({ method, params });
    if (state.status !== 200) throw Object.assign(Error('Rejected'), { status: state.status });
    return state.data;
  };
  const overrides = {
    'next-auth/react': { useSession: () => ({ data: session, status: 'authenticated' }) },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options = options;
      return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: current.status === 'pending', error: current.error,
        hasPermission: code => current.status === 'success' && current.data.permissions.includes(code) };
    } },
    '@/lib/api': { apiClient: {
      getStrengthReport: readApi('live'), getStrengthReportPeriod: readApi('period'), getTrafficLightTree: readApi('traffic'),
    } },
  };
  function load(id) {
    if (id in overrides) return overrides[id];
    if (!id.startsWith('@/')) return require(id);
    if (modules.has(id)) return modules.get(id);
    const file = path.join(__dirname, '../..', id.slice(2) + '.ts');
    const exports = {}; modules.set(id, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, require: load });
    return exports;
  }
  return { client, state, narrow, subject: load('@/hooks/use-strength-report'),
    read: options => client.fetchQuery({ ...options, staleTime: 0 }) };
}

const cases = [
  ['live', subject => subject.useStrengthReport(true, '2026-10-21'), { businessDate: '2026-10-21' }],
  ['period', subject => subject.useStrengthReportPeriod({ from: '2026-10-22', to: '2026-10-23' }, true, 'PLAN'),
    { dateFrom: '2026-10-22', dateTo: '2026-10-23', mode: 'PLAN' }],
  ['traffic', subject => subject.useTrafficLightTree(true, '2026-10-21'), { businessDate: '2026-10-21' }],
];

for (const [kind, render, params] of cases) {
  test(`${kind}: a successful grant narrowing hides the wider source immediately in the same session`, async t => {
    const f = fixture(t);
    render(f.subject); const previous = f.state.options;
    await f.read(previous);
    assert.equal(render(f.subject).data.marker, 'wide-source');
    f.client.setQueryData(['ops-me'], f.narrow);
    const next = render(f.subject);
    assert.equal(next.data, undefined, 'a cached wider department list cannot survive a new authority stamp');
    assert.notDeepEqual(f.state.options.queryKey, previous.queryKey);
    const current = f.state.options;
    const before = f.state.reads.length;
    await assert.rejects(f.read(previous));
    assert.equal(f.state.reads.length, before, 'a retained old callback cannot fetch after narrowing');
    f.state.data = { marker: 'narrow-source', rows: [{ name: 'Own department' }] };
    await f.read(current);
    assert.equal(render(f.subject).data.marker, 'narrow-source');
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.reads.at(-1))), { method: kind, params });
  });

  test(`${kind}: revocation and unavailable permissions hide previously loaded data`, async t => {
    const f = fixture(t);
    render(f.subject); await f.read(f.state.options);
    f.client.setQueryData(['ops-me'], { permissions: [], global_permissions: [], roles: [] });
    assert.equal(render(f.subject).data, undefined);
    assert.equal(f.state.options.enabled, false);
    f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Permissions unavailable') });
    assert.equal(render(f.subject).data, undefined);
    assert.equal(f.state.options.enabled, false);
  });

  test(`${kind}: read denial is not restored by a later temporary error`, async t => {
    const f = fixture(t);
    render(f.subject); const options = f.state.options; await f.read(options);
    f.state.status = 403; await assert.rejects(f.read(options));
    assert.equal(render(f.subject).data, undefined);
    f.state.status = 503; await assert.rejects(f.read(options));
    assert.equal(render(f.subject).data, undefined);
    f.state.status = 200; f.state.data = { marker: 'fresh-source', rows: [] };
    await f.read(options);
    assert.equal(render(f.subject).data.marker, 'fresh-source');
  });
}

test('explicitly disabled and incomplete period sources cannot be manually refetched', async t => {
  const f = fixture(t);
  for (const render of [() => f.subject.useStrengthReport(false),
    () => f.subject.useTrafficLightTree(false), () => f.subject.useStrengthReportPeriod(null, true)]) {
    render();
    assert.equal(f.state.options.enabled, false);
    await assert.rejects(f.read(f.state.options));
  }
  assert.equal(f.state.reads.length, 0);
});

test('a disabled source cannot report a successful result while its cached data is hidden', async t => {
  const f = fixture(t);
  f.subject.useStrengthReport(true, '2026-10-21');
  await f.read(f.state.options);
  const hidden = f.subject.useStrengthReport(false, '2026-10-21');
  assert.equal(hidden.data, undefined);
  assert.equal(hidden.isSuccess, false, 'success must continue to guarantee a readable data payload to existing consumers');
  assert.equal(hidden.status, 'pending');
  assert.equal(hidden.isPending, true);
});

