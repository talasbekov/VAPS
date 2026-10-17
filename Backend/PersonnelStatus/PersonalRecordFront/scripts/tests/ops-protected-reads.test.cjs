const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

function fixture(t, { realTransport = false } = {}) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const session = { user: { id: 'actor-1' } };
  const permissions = { permissions: ['report.generate', 'analytics.view'], global_permissions: ['report.generate', 'analytics.view'], roles: [] };
  client.setQueryData(['ops-me'], permissions);
  const state = { status: 200, response: { results: [{ reportJobId: 'private-job', state: 'PROCESSING', parameters: { from: '2026-10-01' } }] }, reads: 0, writes: 0, options: null };
  const modules = new Map();
  const overrides = {
    '@/shared/config/env': { BACKEND_URL: '' },
    '@/lib/access-token': { getAccessToken: async () => state.token ?? 'synthetic-token' },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options = options;
      return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    'next-auth/react': { useSession: () => ({ data: session, status: 'authenticated' }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { permissions: current.status === 'success' ? new Set(current.data.permissions) : undefined,
        hasPermission: code => current.status === 'success' && current.data.permissions.includes(code),
        isLoading: current.status === 'pending', error: current.error, roles: current.data?.roles ?? [] };
    } },
    '@/hooks/use-ops-mutation': { useOpsMutation: options => options },
    '@/lib/ops-api': { opsApiClient: {
      get: async () => { state.reads++; if (state.status !== 200) throw Object.assign(Error('Read rejected'), { status: state.status }); return state.response; },
      post: async () => { state.writes++; return state.writeResponse ?? {}; },
    } },
  };
  if (realTransport) delete overrides['@/lib/ops-api'];
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (modules.has(name)) return modules.get(name);
    const base = path.join(__dirname, '../..', name.slice(2));
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    const exports = {}; modules.set(name, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, URLSearchParams, FormData, require: load, fetch: async (_url, options = {}) => {
      const write = options.method === 'POST';
      if (write) state.writes++; else state.reads++;
      return new Response(JSON.stringify(state.status === 200
        ? write ? state.writeResponse ?? {} : state.response
        : { error_code: 'SYNTHETIC_DENIAL', message: 'Read rejected', details: {} }), {
        status: state.status, headers: { 'Content-Type': 'application/json' },
      });
    } });
    return exports;
  }
  const reports = load('@/hooks/use-ops-reports');
  const analytics = load('@/hooks/use-ops-analytics');
  const read = options => client.fetchQuery({ ...options, staleTime: 0 });
  return { client, session, permissions, state, reports, analytics, read, authority: load('@/lib/ops-write-authority') };
}

for (const status of [401, 403, 404]) test(`report ${status} clears cached parameters and stays hidden through 503 until a successful read`, async t => {
  const f = fixture(t);
  f.reports.useReportJobs();
  const options = f.state.options;
  await f.read(options);
  assert.equal(f.reports.useReportJobs().data.results[0].reportJobId, 'private-job');
  f.state.status = status;
  await assert.rejects(f.read(options));
  assert.equal(f.reports.useReportJobs().data, undefined);
  assert.equal(f.client.getQueryData(options.queryKey), undefined, 'denied parameters are removed from cache');
  assert.equal(options.refetchInterval(f.client.getQueryCache().find({ queryKey: options.queryKey })), false);
  f.state.status = 503;
  await assert.rejects(f.read(options));
  assert.equal(f.reports.useReportJobs().data, undefined);
  f.state.status = 200;
  f.state.response = { results: [{ reportJobId: 'fresh-job', state: 'COMPLETED' }] };
  await f.read(options);
  assert.equal(f.reports.useReportJobs().data.results[0].reportJobId, 'fresh-job');
});

test('a temporary report error keeps a clearly read-only cache and stops polling', async t => {
  const f = fixture(t);
  f.reports.useReportJobs(); const options = f.state.options;
  await f.read(options);
  f.state.status = 503; await assert.rejects(f.read(options));
  const result = f.reports.useReportJobs();
  assert.equal(result.data.results[0].reportJobId, 'private-job');
  assert.equal(result.canAct, false);
  assert.equal(options.refetchInterval(f.client.getQueryCache().find({ queryKey: options.queryKey })), false);
});

test('report reads are disabled without current permission authority and never reuse another actor cache', async t => {
  const f = fixture(t);
  f.reports.useReportJobs(); const first = f.state.options;
  await f.read(first);
  f.session.user.id = 'actor-2';
  assert.equal(f.reports.useReportJobs().data, undefined);
  assert.notDeepEqual(f.state.options.queryKey, first.queryKey);
  f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Permission refresh failed') });
  f.reports.useReportJobs();
  assert.equal(f.state.options.enabled, false);
  const reads = f.state.reads;
  await assert.rejects(f.read(f.state.options));
  assert.equal(f.state.reads, reads);
});

test('a report read denial blocks rerun/download mutations even while cached permissions still grant access', async t => {
  const f = fixture(t);
  f.reports.useReportJobs(); const options = f.state.options;
  await f.read(options);
  const rerun = f.reports.useRerunReportJob(() => {});
  const download = f.reports.useDownloadArtifact(() => {});
  f.state.status = 403; await assert.rejects(f.read(options));
  await assert.rejects(rerun.mutationFn({ reportJobId: 'private-job', mode: 'RETRY' }));
  await assert.rejects(download.mutationFn({ artifactId: 'private-file' }));
  assert.equal(f.state.writes, 0);
});

test('a fresh list restores its own actions after a different cached detail was denied', async t => {
  const f = fixture(t);
  f.reports.useReportJobs(); const list = f.state.options;
  await f.read(list);
  f.reports.useReportJob('deleted-job'); const detail = f.state.options;
  f.state.status = 404; await assert.rejects(f.read(detail));
  f.state.status = 200;
  f.state.response = { results: [{ reportJobId: 'private-job', state: 'FAILED' }], artifacts: [],
    actions: [{ reportJobId: 'private-job', actions: [{ code: 'RETRY', available: true, reason: null }] }] };
  await f.read(list);
  const rerun = f.reports.useRerunReportJob(() => {}, list.queryKey);
  await rerun.mutationFn({ reportJobId: 'private-job', mode: 'RETRY' });
  assert.equal(f.state.writes, 1);
  f.state.response = { results: [], artifacts: [], actions: [] };
  await f.read(list);
  await assert.rejects(rerun.mutationFn({ reportJobId: 'private-job', mode: 'RETRY' }));
  assert.equal(f.state.writes, 1, 'an old callback cannot reuse an action removed from the fresh manifest');
});

test('fresh required report/document sources recover all metadata actions after an unrelated deleted job', async t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['report.generate', 'event.view', 'event.bulletin'],
    global_permissions: ['report.generate', 'event.view', 'event.bulletin'], roles: [] });
  f.reports.useReportJob('deleted-job');
  f.state.status = 404; await assert.rejects(f.read(f.state.options));
  f.state.status = 200;
  async function source(hook, response) {
    f.state.response = response; hook(); const options = f.state.options; await f.read(options); return options.queryKey;
  }
  const types = await source(() => f.reports.useReportTypes(), { results: [{ reportTypeCode: 'DAILY', safeTitle: 'Daily', description: '',
    formats: ['CSV'], maxPeriodDays: 30, unavailableReason: null }], retentionPolicy: { retentionDays: 30, policyVersion: '1' },
    maskedFields: [], unavailableFormats: [], unavailableArtifactFields: [], canExportSensitive: false });
  const jobs = await source(() => f.reports.useReportJobs(), { results: [], artifacts: [], actions: [], unavailableColumns: [], totalVisible: 0, serverTime: '2026-10-16T10:00:00Z' });
  const kinds = await source(() => f.reports.useEventDocumentKinds(), { results: [{ kind: 'bulletin', label: 'Бюллетень', needsEvent: false, needsAsOf: true }], formats: [{ format: 'pdf', label: 'PDF' }] });
  const issues = await source(() => f.reports.useBulletinIssues(), { results: [{ id: 'issue-1', asOf: '2026-10-16T08:00:00Z', issuedBy: 'Synthetic operator',
    issuedAt: '2026-10-16T09:00:00Z', eventCount: 1, fileName: 'bulletin.pdf' }] });
  await f.reports.useCreateReportJob([types, jobs]).mutationFn({ reportTypeCode: 'DAILY', format: 'CSV', from: '2026-10-01', to: '2026-10-02', sensitive: false, idempotencyKey: 'memory-only' });
  await f.reports.useRenderEventDocument(() => {}, kinds).mutationFn({ kind: 'bulletin', format: 'pdf' });
  await f.reports.useIssueBulletin(() => {}, [kinds, issues]).mutationFn({ asOf: '2026-10-16T08:00:00Z' });
  await f.reports.useBulletinIssueFile(() => {}, issues).mutationFn({ id: 'issue-1' });
  assert.equal(f.state.writes, 2, 'only create and issue are writes; both use successful required sources');
});

test('fixed-kind event downloads preserve event.view-only access and suppress late files after permission failure', async t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['event.view'], global_permissions: ['event.view'], roles: [] });
  let downloaded = 0;
  const mutation = f.reports.useRenderEventDocument(() => { downloaded++; });
  f.state.response = { fileName: 'placement.pdf', contentBase64: 'JVBERg==', contentType: 'application/pdf' };
  const file = await mutation.mutationFn({ kind: 'placement', eventCode: 'SYNTHETIC-EVENT', format: 'pdf' });
  mutation.onSuccess(file);
  assert.equal(downloaded, 1, 'a fixed-kind event/visit button does not need report.generate or a catalogue preload');
  const reads = f.state.reads;
  f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Temporary permission outage') });
  mutation.onSuccess(file);
  assert.equal(downloaded, 1, 'a late file cannot escape failed authority');
  await assert.rejects(mutation.mutationFn({ kind: 'placement', eventCode: 'SYNTHETIC-EVENT', format: 'pdf' }));
  assert.equal(f.state.reads, reads);
});

test('a successful download is delivered while its unchanged source list is polling', async t => {
  const f = fixture(t);
  f.state.response = { results: [{ reportJobId: 'private-job', state: 'COMPLETED' }],
    artifacts: [{ artifactId: 'artifact-1', reportJobId: 'private-job', available: true }],
    actions: [{ reportJobId: 'private-job', actions: [{ code: 'DOWNLOAD', available: true, reason: null }] }] };
  f.reports.useReportJobs(); const options = f.state.options;
  await f.read(options);
  let delivered = 0;
  const download = f.reports.useDownloadArtifact(() => { delivered++; }, options.queryKey);
  f.state.writeResponse = { fileName: 'report.csv', content: 'synthetic,data' };
  const file = await download.mutationFn({ artifactId: 'artifact-1' });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const refreshing = f.client.fetchQuery({ ...options, queryFn: () => held });
  assert.equal(f.client.getQueryState(options.queryKey).fetchStatus, 'fetching');
  download.onSuccess(file, { artifactId: 'artifact-1' });
  assert.equal(delivered, 1, 'an authorized successful file must not be silently lost because polling overlaps its response');
  release(f.state.response); await refreshing;
});

test('a report source denial during token refresh prevents the actual download POST', async t => {
  const f = fixture(t, { realTransport: true });
  f.state.response = { results: [{ reportJobId: 'private-job', state: 'COMPLETED' }],
    artifacts: [{ artifactId: 'artifact-1', reportJobId: 'private-job', available: true }],
    actions: [{ reportJobId: 'private-job', actions: [{ code: 'DOWNLOAD', available: true, reason: null }] }] };
  f.reports.useReportJobs(); const options = f.state.options;
  await f.read(options);
  let release;
  f.state.token = new Promise(resolve => { release = resolve; });
  const download = f.reports.useDownloadArtifact(() => {}, options.queryKey);
  const pending = download.mutationFn({ artifactId: 'artifact-1' });
  f.state.token = 'synthetic-token';
  f.state.status = 403;
  await assert.rejects(f.read(options));
  assert.equal(f.client.getQueryState(['ops-me']).status, 'success', 'permissions themselves still grant report.generate');
  f.state.status = 200;
  release('synthetic-token');
  await assert.rejects(pending);
  assert.equal(f.state.writes, 0, 'no POST may escape a denied source while waiting for the token');
});

test('a late event file is suppressed as soon as the live session changes before cached query cleanup', async t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['event.view'], global_permissions: ['event.view'], roles: [] });
  let current = f.authority.currentOpsAuthorityStamp(f.client, 'actor-1');
  f.authority.registerOpsWriteAuthority(() => current);
  let downloaded = 0;
  const mutation = f.reports.useRenderEventDocument(() => { downloaded++; });
  const file = await mutation.mutationFn({ kind: 'placement', eventCode: 'SYNTHETIC-EVENT', format: 'pdf' });
  // SessionProvider has changed; AuthProvider's cache-clear effect has not run.
  current = null;
  assert.equal(f.client.getQueryState(['ops-me']).status, 'success');
  mutation.onSuccess(file);
  assert.equal(downloaded, 0);
  const reads = f.state.reads;
  await assert.rejects(mutation.mutationFn({ kind: 'placement', eventCode: 'SYNTHETIC-EVENT', format: 'pdf' }));
  assert.equal(f.state.reads, reads);
});

test('analytics snapshots hide denied KPIs through a later temporary failure and isolate actor scopes', async t => {
  const f = fixture(t);
  const period = { presetCode: null, from: '2026-10-01', to: '2026-10-07' };
  f.state.response = { snapshotId: 'private-snapshot', metrics: [{ value: 42 }] };
  f.analytics.useServiceAnalytics(period); const options = f.state.options;
  await f.read(options);
  assert.equal(f.analytics.useServiceAnalytics(period).data.snapshotId, 'private-snapshot');
  f.state.status = 403; await assert.rejects(f.read(options));
  assert.equal(f.analytics.useServiceAnalytics(period).data, undefined);
  f.state.status = 503; await assert.rejects(f.read(options));
  assert.equal(f.analytics.useServiceAnalytics(period).data, undefined);
  f.session.user.id = 'actor-2';
  assert.equal(f.analytics.useServiceAnalytics(period).data, undefined);
});
