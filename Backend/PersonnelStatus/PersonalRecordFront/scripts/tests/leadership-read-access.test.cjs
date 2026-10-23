const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

const cases = [
  ['absence summary', 'use-absence-statistics', 'useAbsenceStatistics', [true], 'status.view'],
  ['staff board', 'use-staff-units', 'useStaffUnits', [], 'orgstructure.view'],
  ['staff counts', 'use-staff-unit-statistics', 'useStaffUnitStatistics', [], 'orgstructure.view'],
  ['status reader counts', 'use-staff-unit-statistics', 'useStaffUnitStatistics', [], 'status.view'],
  ['all events', 'use-all-security-events', 'useAllSecurityEvents', [{ enabled: true }], 'event.view'],
  ['ops audit', 'use-ops-audit', 'useOpsAuditLogs', [], 'audit.view'],
  ['rating summary', 'use-ops-ratings', 'useOperationalRatings', [{ enabled: true }], 'rating.view_aggregate'],
  ['rating dynamics', 'use-ops-ratings', 'useRatingDynamics', ['person-12'], 'rating.view_aggregate'],
  ['rating detail', 'use-ops-ratings', 'useRatingEmployeeDetail', ['person-12'], 'rating.view_aggregate'],
  ['rating registry', 'use-ops-ratings', 'useEvaluationRegistry', [{ from: null, to: null, event: null, unit: null,
    employee: null, direction: null, method: null, correctedOnly: false, search: '', page: 1 }], 'rating.view_aggregate'],
  ['employee evaluations', 'use-ops-ratings', 'useAllEvaluationsOf', ['person-12'], 'rating.view_aggregate'],
  ['rating audit', 'use-ops-ratings', 'useRatingAudit', [2], 'rating.view_audit'],
  ['rating exports', 'use-ops-ratings', 'useRatingExports', [], 'rating.export'],
];

function fixture(t, permission) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const session = { user: { id: 'reader-a' } };
  const state = { options: null, status: 200, auth: 'authenticated', reads: [], marker: 'outside' };
  const permissions = Array.isArray(permission) ? permission : [permission];
  const grants = global => ({ permissions, global_permissions: global ? permissions : [],
    roles: [{ code: 'READER', scope_division_id: global ? null : 12 }] });
  client.setQueryData(['ops-me'], grants(true));
  const response = () => ({ marker: state.marker, results: [{ id: state.marker, marker: state.marker, state: state.jobState }],
    next: null, page: 1, pageCount: 1, total: 1, artifacts: [], unavailableViews: [] });
  const read = async (method, params) => {
    state.reads.push({ method, params });
    if (state.status !== 200) throw Object.assign(Error('Source failed'), { status: state.status });
    return method === 'staff' ? [{ marker: state.marker }] : response();
  };
  const overrides = {
    'next-auth/react': { useSession: () => ({ data: session, status: state.auth }) },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options = options; return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: current.status === 'pending', error: current.error,
        hasPermission: code => current.status === 'success' && current.data.permissions.includes(code) };
    } },
    '@/hooks/use-ops-mutation': { useOpsMutation: value => value },
    '@/hooks/use-ops-mock-worker': { useOpsMockWorker: () => true },
    '@/entities/security-event': { SECURITY_EVENTS_PATH: '/api/ops/security-events/' },
    '@/lib/ops-api': { opsApiClient: { get: url => read('ops', url) } },
    '@/lib/api': { ApiHttpError: Error, apiClient: {
      getAbsenceStatistics: () => read('absence'),
      getStaffUnits: (page, size, signal) => read('staff', { page, size, aborted: signal?.aborted }),
      getStaffUnitStatistics: () => read('counts'),
    } },
  };
  const modules = new Map();
  function load(id, importer) {
    if (id in overrides) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(__dirname, '../..', id.slice(2)) : path.resolve(path.dirname(importer), id);
    const file = [base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, require: name => load(name, file), URLSearchParams });
    return exports;
  }
  const authority = load('@/lib/ops-write-authority');
  t.after(authority.registerOpsWriteAuthority(() => state.auth === 'authenticated'
    ? authority.currentOpsAuthorityStamp(client, session.user.id) : null));
  return { client, state, session, grants, load,
    read: options => client.fetchQuery({ ...options, retry: false, staleTime: 0 }) };
}

for (const [name, file, hook, args, permission] of cases) {
  const render = f => f.load('@/hooks/' + file)[hook](...args);
  test(`${name}: scope narrowing hides wider data and accepts the new own-scope response`, async t => {
    const f = fixture(t, permission); render(f); const old = f.state.options; await f.read(old);
    assert.match(JSON.stringify(render(f).data), /outside/);
    f.client.setQueryData(['ops-me'], f.grants(false));
    assert.equal(render(f).data, undefined, 'same permission in a narrower scope must not reveal wider cached data');
    const current = f.state.options;
    assert.notDeepEqual(current.queryKey, old.queryKey);
    const count = f.state.reads.length;
    await assert.rejects(f.read(old));
    assert.equal(f.state.reads.length, count, 'old authority callback must not reach the transport');
    f.state.marker = 'own'; await f.read(current);
    assert.match(JSON.stringify(render(f).data), /own/, 'do not blanket-deny authorized scoped content');
  });

  test(`${name}: source403 clears protected data through503 until a successful retry`, async t => {
    const f = fixture(t, permission); render(f); const options = f.state.options; await f.read(options);
    f.state.status = 403; await assert.rejects(f.read(options));
    assert.equal(render(f).data, undefined);
    assert.equal(f.client.getQueryData(options.queryKey), undefined);
    f.state.status = 503; await assert.rejects(f.read(options));
    assert.equal(render(f).data, undefined);
    f.state.status = 200; f.state.marker = 'fresh'; await f.read(options);
    assert.match(JSON.stringify(render(f).data), /fresh/);
  });

  test(`${name}: revoked or unverified grants cannot authorize a retained read`, async t => {
    const f = fixture(t, permission); render(f); await f.read(f.state.options);
    f.client.setQueryData(['ops-me'], { permissions: [], global_permissions: [], roles: [] });
    assert.equal(render(f).data, undefined);
    assert.equal(f.state.options.enabled, false);
    const before = f.state.reads.length;
    await assert.rejects(f.read(f.state.options));
    assert.equal(f.state.reads.length, before);
    f.client.setQueryData(['ops-me'], f.grants(false));
    f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Authority unavailable') });
    assert.equal(render(f).data, undefined);
    assert.equal(f.state.options.enabled, false);
  });
}

test('explicitly disabled leadership reads and missing person IDs cannot be manually fetched', async t => {
  const f = fixture(t, 'rating.view_aggregate');
  const ratings = f.load('@/hooks/use-ops-ratings');
  for (const render of [() => ratings.useOperationalRatings({ enabled: false }),
    () => ratings.useEvaluationRegistry(cases[9][3][0], { enabled: false }),
    () => ratings.useRatingEmployeeDetail(null), () => ratings.useAllEvaluationsOf(''),
    () => f.load('@/hooks/use-all-security-events').useAllSecurityEvents({ enabled: false }),
    () => f.load('@/hooks/use-absence-statistics').useAbsenceStatistics(false)]) {
    render(); assert.equal(f.state.options.enabled, false);
    await assert.rejects(f.read(f.state.options));
  }
  assert.equal(f.state.reads.length, 0);
});

test('protected rating exports preserve active polling but stop after source denial', async t => {
  const f = fixture(t, 'rating.export'); f.load('@/hooks/use-ops-ratings').useRatingExports();
  const options = f.state.options;
  assert.equal(options.refetchIntervalInBackground, false);
  assert.equal(options.refetchInterval({ state: { status: 'success', data: { results: [{ state: 'QUEUED' }] } } }), 700);
  await f.read(options); f.state.status = 403; await assert.rejects(f.read(options));
  assert.equal(options.refetchInterval({ state: { status: 'error', data: undefined } }), false);
});

test('rating registry keeps filters and complete employee pagination in the transport contract', async t => {
  const f = fixture(t, 'rating.view_aggregate'); const ratings = f.load('@/hooks/use-ops-ratings');
  ratings.useEvaluationRegistry({ ...cases[9][3][0], from: '2026-10-01', employee: 'id/12', correctedOnly: true, page: 2 });
  await f.read(f.state.options);
  assert.match(f.state.reads[0].params, /from=2026-10-01&employee=id%2F12&corrected=true&page=2/);
  ratings.useAllEvaluationsOf('id/12'); await f.read(f.state.options);
  assert.match(f.state.reads.at(-1).params, /employee=id%2F12$/);
});

const ratingPermissions = ['rating.view_aggregate', 'rating.export', 'rating.view_audit', 'analytics.view'];

async function cacheRatingRead(f, render) {
  render(); const options = f.state.options; await f.read(options);
  return { render, options };
}

function assertRatingAvailable(f, source, label) {
  const result = source.render();
  assert.match(JSON.stringify(result.data) ?? '', /outside/, `${label} must retain its authorized data`);
  assert.equal(result.readAccessBlocked, false, `${label} did not deny access`);
  assert.equal(result.error, null, `${label} did not fail`);
  assert.notEqual(f.client.getQueryData(source.options.queryKey), undefined, `${label} cache must remain available`);
}

function assertRatingBlocked(f, source, label) {
  const result = source.render();
  assert.equal(result.data, undefined, `${label} must hide its denied payload`);
  assert.equal(result.readAccessBlocked, true, `${label} denial must persist`);
  assert.equal(result.canAct, false);
  assert.equal(f.client.getQueryData(source.options.queryKey), undefined, `${label} cache must be cleared`);
}

async function independentRatingSources(f) {
  const ratings = f.load('@/hooks/use-ops-ratings');
  f.state.jobState = 'QUEUED';
  const sources = {};
  for (const [name, render] of Object.entries({
    personal: () => ratings.useRatingNotifications(),
    exports: () => ratings.useRatingExports(),
    audit: () => ratings.useRatingAudit(1),
    auditPage2: () => ratings.useRatingAudit(2),
    analytics: () => ratings.useRatingAnalytics(),
    aggregate: () => ratings.useOperationalRatings(),
  })) sources[name] = await cacheRatingRead(f, render);
  return sources;
}

test('scoped aggregate403 preserves the personal feed but denies all cached aggregate filter variants through503', async t => {
  const f = fixture(t, 'rating.view_aggregate'); f.client.setQueryData(['ops-me'], f.grants(false));
  const ratings = f.load('@/hooks/use-ops-ratings');
  const personal = await cacheRatingRead(f, () => ratings.useRatingNotifications());
  const sources = [];
  for (const render of [() => ratings.useOperationalRatings(),
    () => ratings.useRatingDynamics('person-12'), () => ratings.useRatingDynamics('person-13'),
    () => ratings.useRatingEmployeeDetail('person-12'), () => ratings.useRatingEmployeeDetail('person-13'),
    () => ratings.useEvaluationRegistry(cases[9][3][0]),
    () => ratings.useEvaluationRegistry({ ...cases[9][3][0], search: 'other', page: 2 }),
    () => ratings.useAllEvaluationsOf('person-12')]) sources.push(await cacheRatingRead(f, render));
  f.state.status = 403; await assert.rejects(f.read(sources[0].options));
  assertRatingAvailable(f, personal, 'personal feed after aggregate403');
  for (const source of sources) assertRatingBlocked(f, source, 'aggregate variant after403');
  f.state.status = 503; await assert.rejects(f.read(sources[0].options));
  for (const source of sources) assertRatingBlocked(f, source, 'aggregate variant after503');
  assertRatingAvailable(f, personal, 'personal feed after aggregate503');
  f.state.status = 200; f.state.marker = 'fresh'; await f.read(sources[0].options);
  assert.match(JSON.stringify(sources[0].render().data), /fresh/);
  for (const source of sources.slice(1)) assertRatingBlocked(f, source, 'a sibling requires its own successful read');
});

test('aggregate403 preserves independent rating audit, analytics and running export polling', async t => {
  const f = fixture(t, ratingPermissions); f.client.setQueryData(['ops-me'], f.grants(false));
  const sources = await independentRatingSources(f);
  const exporting = f.client.getQueryCache().find({ queryKey: sources.exports.options.queryKey, exact: true });
  assert.equal(sources.exports.options.refetchInterval(exporting), 700);
  f.state.status = 403; await assert.rejects(f.read(sources.aggregate.options));
  assert.equal(sources.exports.options.refetchInterval(exporting), 700, 'unrelated denial must not stop an active export');
  for (const name of ['personal', 'exports', 'audit', 'auditPage2', 'analytics']) assertRatingAvailable(f, sources[name], name);
});

for (const denied of ['exports', 'audit', 'personal', 'analytics']) {
  test(`${denied}403 only blocks its own rating source variants and survives503`, async t => {
    const f = fixture(t, ratingPermissions); const sources = await independentRatingSources(f);
    f.state.status = 403; await assert.rejects(f.read(sources[denied].options));
    const sameSource = name => name === denied || denied === 'audit' && name === 'auditPage2';
    for (const [name, source] of Object.entries(sources)) {
      if (sameSource(name)) assertRatingBlocked(f, source, name);
      else assertRatingAvailable(f, source, name);
    }
    f.state.status = 503; await assert.rejects(f.read(sources[denied].options));
    for (const [name, source] of Object.entries(sources)) {
      if (sameSource(name)) assertRatingBlocked(f, source, `${name} through503`);
      else assertRatingAvailable(f, source, `${name} through unrelated503`);
    }
  });
}

test('independent rating denial domains still hide every wider source after a genuine authority change', async t => {
  const f = fixture(t, ratingPermissions); const sources = await independentRatingSources(f);
  f.client.setQueryData(['ops-me'], f.grants(false));
  for (const [name, source] of Object.entries(sources)) {
    assert.equal(source.render().data, undefined, `${name} must not reuse a wider authority`);
    assert.notDeepEqual(f.state.options.queryKey, source.options.queryKey);
    const reads = f.state.reads.length;
    await assert.rejects(f.read(source.options));
    assert.equal(f.state.reads.length, reads, `${name} old callback must not reach transport`);
    source.render(); const current = f.state.options; f.state.marker = 'own';
    await f.read(current);
    assert.match(JSON.stringify(source.render().data), /own/, `${name} retains authorized own-scope reads`);
  }
});
