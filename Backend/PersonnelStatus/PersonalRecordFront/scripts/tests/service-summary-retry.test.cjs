const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

// Exercise the real service hooks, protected read, cache and authority checks;
// only React's renderer and the HTTP boundary are replaced in this node suite.
function fixture(t) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const state = { actor: 'reader-a', ready: true, root: 1, reads: [], options: [], statuses: {}, gates: {},
    submissions: [], report: { rows: [], totals: { list_total: 12, columns: { IN_SERVICE: 10, OTHER: 2 } } } };
  client.setQueryData(['ops-me'], { permissions: ['status.view', 'service_summary.view'], global_permissions: [], roles: [] });
  let slot = 0;
  const refs = [], cleanups = [], modules = new Map();
  const rootContext = {}, readyContext = {};
  const react = { useRef: value => refs[slot++] ?? (refs[slot - 1] = { current: value }),
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
    useContext: context => context === rootContext ? state.root : state.ready };
  async function read(kind, params) {
    state.reads.push({ kind, params });
    if (state.gates[kind]) await state.gates[kind];
    if (state.statuses[kind]) throw Object.assign(Error('Read unavailable'), { status: state.statuses[kind] });
    if (kind === 'tree') return { nodes: [{ division_id: 1, parent_id: null, name: 'Служба' },
      { division_id: 2, parent_id: 1, name: 'Департамент А' }] };
    return kind === 'submissions' ? { results: state.submissions } : state.report;
  }
  const overrides = {
    react,
    'next-auth/react': { useSession: () => ({ data: { user: { id: state.actor } }, status: 'authenticated' }) },
    '@tanstack/react-query': { ...query, useMutation: () => ({}), useQueryClient: () => client, useQuery: options => {
      state.options.push(options);
      return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: current.status === 'pending', error: current.error,
        hasPermission: code => current.status === 'success' && current.data.permissions.includes(code) };
    } },
    '@/hooks/use-ops-status-types': { useOpsStatusTypes: () => ({ all: [{ code: 'IN_SERVICE', report_column_code: 'IN_SERVICE' }], labelOf: x => x }) },
    '@/lib/api': { apiClient: { getTrafficLightTree: params => read('tree', params), getStrengthReport: params => read('report', params) } },
    '@/lib/ops-api': { opsApiClient: { get: url => read('submissions', url), post: () => { throw Error('Retry attempted a write'); } } },
    '@/entities/daily-grid': { DAILY_SUBMISSIONS_PATH: '/api/ops/daily/daily-submissions/',
      parseSubmissionList: value => value?.results ?? [], buildDivisionForest: nodes => ({
        childrenOf: new Map([[1, nodes.filter(node => node.parent_id === 1)]]) }) },
    './workspace-context': { ServiceSummaryRootContext: rootContext, ServiceSummaryWorkspaceReadyContext: readyContext },
    '../model/workspace-context': { ServiceSummaryRootContext: rootContext, ServiceSummaryWorkspaceReadyContext: readyContext },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/badge': { Badge: 'span' },
    '@/hooks/use-daily-summary-write': { SUMMARY_ASSEMBLE_PERMISSION: 'daily_report.generate', useAssembleSummary: () => ({}) },
    '@/shared/lib/date': { formatIsoDate: x => x, formatIsoDateTime: x => x },
    '@/features/daily-expense/ui/SummaryVersions': { SummaryVersions: () => null },
    '@/features/daily-expense/ui/SummaryCorrection': { SummaryCorrection: 'correction' },
    './DivisionRow': { DivisionRow: () => null, FiguresCells: () => null, COLUMN_COUNT: 5 },
  };
  function load(id, base = '') {
    if (id in overrides) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    let file = id.startsWith('@/') ? path.join(__dirname, '../..', id.slice(2) + '.ts') : path.resolve(base, id + '.ts');
    if (!fs.existsSync(file)) file += 'x';
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(compiled, { exports, require: name => load(name, path.dirname(file)) });
    return exports;
  }
  const tree = load('@/features/service-summary/model/use-service-tree');
  const day = load('@/features/service-summary/model/use-service-day');
  const render = (date = '2026-10-23', kind = 'tree') => { slot = 0; state.options = [];
    return kind === 'tree' ? tree.useServiceTree(date) : day.useServiceDay(date); };
  const fetch = async kind => {
    const options = state.options.find(item => item.queryKey[1] === kind || (kind === 'report' && item.queryKey[0] === 'strength-report'));
    assert.ok(options, `missing ${kind} query`);
    return client.fetchQuery({ ...options, staleTime: 0 });
  };
  let sectionMode = false;
  const renderSection = value => {
    if (!sectionMode) { refs.length = 0; sectionMode = true; }
    day.useServiceDay = () => value;
    slot = 0;
    return load('@/features/service-summary/ui/DaySummarySection').DaySummarySection({ businessDate: '2026-10-23' });
  };
  return { client, state, render, fetch, renderSection, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test('submissions-only failure retries both current-day reads and recovers current submission state', async t => {
  const f = fixture(t); f.state.statuses.submissions = 503;
  f.render(); await f.fetch('tree'); await assert.rejects(f.fetch('submissions'));
  const failed = f.render();
  assert.equal(failed.isError, true); assert.equal(failed.readBlocked, false);
  assert.equal(failed.canRetry, true);
  f.state.statuses.submissions = 0;
  f.state.submissions = [{ division_id: '2', business_date: '2026-10-23', is_current: true, version: 3 }];
  await failed.retry();
  const recovered = f.render();
  assert.equal(recovered.isError, false); assert.equal(recovered.submissionByDivision.get('2').version, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.reads.slice(-2))), [
    { kind: 'tree', params: { businessDate: '2026-10-23' } },
    { kind: 'submissions', params: '/api/ops/daily/daily-submissions/?business_date=2026-10-23' },
  ]);
});

test('strength-only retry preserves the day sources and restores unavailable figures', async t => {
  const f = fixture(t); f.state.statuses.report = 503;
  f.render(undefined, 'day'); await f.fetch('tree'); await f.fetch('submissions'); await assert.rejects(f.fetch('report'));
  const failed = f.render(undefined, 'day');
  assert.equal(failed.reportError, true); assert.equal(failed.canRetryReport, true);
  const before = f.state.reads.length; f.state.statuses.report = 0;
  await failed.retryReport();
  const recovered = f.render(undefined, 'day');
  assert.equal(recovered.reportError, false); assert.equal(recovered.totals.listTotal, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.reads.slice(before))), [{ kind: 'report', params: { businessDate: '2026-10-23' } }]);
});

for (const changed of ['date', 'root', 'actor', 'permission', 'loading', 'context']) {
  test(`retained retry callbacks cannot read after ${changed} changes`, async t => {
    const f = fixture(t); const old = f.render(undefined, 'day');
    if (changed === 'root') f.state.root = 2;
    if (changed === 'actor') f.state.actor = 'reader-b';
    if (changed === 'context') f.state.ready = false;
    if (changed === 'permission') f.client.setQueryData(['ops-me'], { permissions: ['status.view'], roles: [] });
    if (changed === 'loading') f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'pending', data: undefined });
    f.render(changed === 'date' ? '2026-10-24' : undefined, 'day');
    await old.retry(); await old.retryReport();
    assert.equal(f.state.reads.length, 0);
  });
}

test('a protected source denial is not offered as a transient retry', async t => {
  const f = fixture(t); f.state.statuses.submissions = 403;
  f.render(); await f.fetch('tree'); await assert.rejects(f.fetch('submissions'));
  const failed = f.render();
  assert.equal(failed.readBlocked, true); assert.equal(failed.canRetry, false);
  const before = f.state.reads.length; await failed.retry(); assert.equal(f.state.reads.length, before);
});

test('repeated recovery clicks issue one pair of reads and expose pending state', async t => {
  const f = fixture(t); const day = f.render();
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.state.gates.tree = gate; f.state.gates.submissions = gate;
  const first = day.retry(); const second = day.retry();
  assert.equal(f.render().retryPending, true);
  assert.equal(f.state.reads.length, 2);
  release(); await Promise.all([first, second]);
  assert.equal(f.render().retryPending, false);
});

test('workspace suspension enables no business reads, including strength figures', async t => {
  const f = fixture(t); f.state.ready = false; const day = f.render(undefined, 'day');
  assert.ok(f.state.options.every(options => options.enabled === false));
  await day.retry(); await day.retryReport(); assert.equal(f.state.reads.length, 0);
});

test('unmounted day callbacks cannot start protected recovery requests', async t => {
  const f = fixture(t); const day = f.render(undefined, 'day'); f.unmount();
  await day.retry(); await day.retryReport(); assert.equal(f.state.reads.length, 0);
});

for (const change of ['date', 'actor']) test(`an in-flight recovery never delivers its result to a changed ${change}`, async t => {
  const f = fixture(t); const day = f.render(undefined, 'day');
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.state.gates.tree = gate; f.state.gates.submissions = gate; f.state.gates.report = gate;
  const retry = day.retry(), report = day.retryReport();
  if (change === 'actor') f.state.actor = 'reader-b';
  const date = change === 'date' ? '2026-10-24' : undefined;
  f.render(date, 'day'); release();
  assert.equal(await retry, undefined); assert.equal(await report, undefined);
  const current = f.render(date, 'day');
  assert.equal(current.rootId, null); assert.equal(current.submissionByDivision.size, 0); assert.equal(current.totals, null);
});

function elements(element) {
  if (Array.isArray(element)) return element.flatMap(elements);
  if (!element || typeof element !== 'object') return [];
  return [element, ...elements(element.props?.children)];
}
function textOf(element) {
  if (Array.isArray(element)) return element.map(textOf).join('');
  return element && typeof element === 'object' ? textOf(element.props?.children) : String(element ?? '');
}

test('day source failure names both reads, exposes accessible recovery and retains the correction component', async t => {
  const f = fixture(t); const value = f.render(undefined, 'day');
  Object.assign(value, { isPending: false, isError: false, readBlocked: false, rootId: 1,
    rootSubmission: { version: 2 }, retryPending: false, canRetry: true });
  f.renderSection(value);
  value.isError = true;
  let retries = 0; value.retry = async () => { retries++; };
  const content = f.renderSection(value), nodes = elements(content);
  assert.ok(textOf(content).includes('Не удалось прочитать структуру и состояние сдачи'));
  const retry = nodes.find(node => node.type === 'button' && textOf(node) === 'Повторить загрузку свода');
  assert.ok(retry, 'source failure must have a named button'); assert.equal(retry.props.disabled, false);
  await retry.props.onClick(); assert.equal(retries, 1);
  const correction = nodes.find(node => node.type === 'correction');
  assert.ok(correction); assert.equal(correction.key, '2026-10-23:1'); assert.equal(correction.props.dataReady, false);
});

test('context suspension keeps the same-authority correction owner mounted with actions disabled', async t => {
  const f = fixture(t); const value = f.render(undefined, 'day');
  Object.assign(value, { isPending: false, isError: false, rootId: 1, rootSubmission: { version: 2 } });
  const before = elements(f.renderSection(value)).find(node => node.type === 'correction');
  Object.assign(value, { readAllowed: false, isPending: true, rootId: null, rootSubmission: undefined });
  const after = elements(f.renderSection(value)).find(node => node.type === 'correction');
  assert.ok(after, 'temporary context refresh must not discard the correction owner');
  assert.equal(after.key, before.key); assert.equal(after.props.dataReady, false);
});

test('figure failure has independent accessible recovery and disables it during loading', async t => {
  const f = fixture(t); const value = f.render(undefined, 'day');
  Object.assign(value, { isPending: false, isError: false, rootId: 1, rootSubmission: undefined,
    reportError: true, reportReadBlocked: false, canRetryReport: true, reportRetryPending: false });
  let retries = 0; value.retryReport = async () => { retries++; };
  let nodes = elements(f.renderSection(value));
  const retry = nodes.find(node => node.type === 'button' && textOf(node) === 'Повторить загрузку чисел');
  assert.ok(retry); await retry.props.onClick(); assert.equal(retries, 1);
  value.reportRetryPending = true; value.canRetryReport = false;
  nodes = elements(f.renderSection(value));
  assert.equal(nodes.find(node => node.type === 'button' && textOf(node) === 'Загрузка чисел…').props.disabled, true);
});
