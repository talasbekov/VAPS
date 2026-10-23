const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const query = require('@tanstack/react-query');

function fixture(t, { analytics = false } = {}) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const session = { user: { id: 'actor-a' } };
  client.setQueryData(['ops-me'], { permissions: analytics ? ['analytics.view'] : [],
    global_permissions: analytics ? ['analytics.view'] : [], roles: [] });
  const state = { options: null, status: 200, auth: 'authenticated', ready: true, reads: 0, rated: 100 };
  const overrides = {
    'next-auth/react': { useSession: () => ({ data: session, status: state.auth }) },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options = options; return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: current.status === 'pending', error: current.error,
        hasPermission: code => current.data?.permissions.includes(code) ?? false };
    } },
    '@/hooks/use-ops-mutation': { useOpsMutation: options => options },
    '@/hooks/use-ops-mock-worker': { useOpsMockWorker: () => state.ready },
    '@/lib/ops-api': { opsApiClient: { get: async () => {
      state.reads++;
      if (state.status !== 200) throw Object.assign(Error('Source rejected'), { status: state.status,
        errorCode: state.status === 403 ? 'ANALYTICS_SCOPE_UNAVAILABLE' : 'SERVER_ERROR' });
      if (analytics) return { figures: { ratedParticipants: state.rated }, unpublishedReason: null };
      return { results: [{ id: 'event-' + session.user.id, recipientUserId: session.user.id,
        createdAt: '2026-10-21T08:00:00Z', code: 'EVALUATION_AVAILABLE', deepLink: '', securityEventId: null }], unavailableViews: [] };
    } } },
  };
  const modules = new Map();
  function load(id) {
    if (id in overrides) return overrides[id];
    if (!id.startsWith('@/')) return require(id);
    if (modules.has(id)) return modules.get(id);
    const base = path.join(__dirname, '../..', id.slice(2));
    const filename = [base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
    const exports = {}; modules.set(id, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, require: load, URLSearchParams });
    return exports;
  }
  const authority = load('@/lib/ops-write-authority');
  t.after(authority.registerOpsWriteAuthority(() => state.auth === 'authenticated'
    ? authority.currentOpsAuthorityStamp(client, session.user.id) : null));
  return { client, session, state, hook: load('@/hooks/use-ops-ratings')[analytics ? 'useRatingAnalytics' : 'useRatingNotifications'],
    read: options => client.fetchQuery({ ...options, staleTime: 0 }) };
}

test('authenticated people without rating grants can load their own events', async t => {
  const f = fixture(t); f.hook(); await f.read(f.state.options);
  assert.equal(f.hook().data.results[0].recipientUserId, 'actor-a');
});

test('personal rating cache cannot appear for another authenticated actor', async t => {
  const f = fixture(t); f.hook(); const old = f.state.options; await f.read(old);
  f.session.user.id = 'actor-b';
  assert.equal(f.hook().data, undefined);
  assert.notDeepEqual(f.state.options.queryKey, old.queryKey);
  const count = f.state.reads;
  await assert.rejects(f.read(old));
  assert.equal(f.state.reads, count);
  await f.read(f.state.options);
  assert.equal(f.hook().data.results[0].recipientUserId, 'actor-b');
});

test('a personal source denial stays hidden through a later temporary error', async t => {
  const f = fixture(t); f.hook(); const options = f.state.options; await f.read(options);
  f.state.status = 403; await assert.rejects(f.read(options));
  assert.equal(f.hook().data, undefined);
  f.state.status = 503; await assert.rejects(f.read(options));
  assert.equal(f.hook().data, undefined);
  f.state.status = 200; await f.read(options);
  assert.equal(f.hook().data.results[0].recipientUserId, 'actor-a');
});

test('sign-out and unavailable authority cannot authorize a personal feed request', async t => {
  const f = fixture(t); f.hook(); await f.read(f.state.options);
  f.state.auth = 'unauthenticated';
  assert.equal(f.hook().data, undefined);
  assert.equal(f.state.options.enabled, false);
  const count = f.state.reads;
  await assert.rejects(f.read(f.state.options));
  assert.equal(f.state.reads, count);
  f.state.auth = 'authenticated';
  f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Permissions unavailable') });
  const hidden = f.hook();
  assert.equal(hidden.data, undefined);
  assert.equal(f.state.options.enabled, false);
  assert.equal(typeof hidden.retryNotifications, 'function');
});

test('a header outside the operations segment waits for mock readiness before requesting personal events', async t => {
  const f = fixture(t); f.state.ready = false; f.hook();
  assert.equal(f.state.options.enabled, false);
  await assert.rejects(f.read(f.state.options));
  assert.equal(f.state.reads, 0);
  f.state.ready = true; f.hook(); await f.read(f.state.options);
  assert.equal(f.hook().data.results[0].recipientUserId, 'actor-a');
});

test('rating analytics cannot reuse global figures after analytics.view narrows to a department', async t => {
  const f = fixture(t, { analytics: true }); f.hook(); const global = f.state.options; await f.read(global);
  assert.equal(f.hook().data.figures.ratedParticipants, 100);
  f.client.setQueryData(['ops-me'], { permissions: ['analytics.view'], global_permissions: [],
    roles: [{ code: 'HEAD_DEPARTMENT_LINE', scope_division_id: 12 }] });
  assert.equal(f.hook().data, undefined, 'same permission with a narrower scope must hide global figures immediately');
  const scoped = f.state.options;
  assert.notDeepEqual(scoped.queryKey, global.queryKey);
  const count = f.state.reads;
  await assert.rejects(f.read(global));
  assert.equal(f.state.reads, count, 'an old callback must not issue an authorized global read');
  f.state.status = 403; await assert.rejects(f.read(scoped));
  assert.equal(f.hook().data, undefined);
  f.state.status = 503; await assert.rejects(f.read(scoped));
  assert.equal(f.hook().data, undefined, 'a temporary failure must not restore denied global figures');
  f.state.status = 200; f.state.rated = 8; await f.read(scoped);
  assert.equal(f.hook().data.figures.ratedParticipants, 8);
});

test('a rating analytics source denial purges cached figures until a new successful read', async t => {
  const f = fixture(t, { analytics: true }); f.hook(); const options = f.state.options; await f.read(options);
  f.state.status = 403; await assert.rejects(f.read(options));
  assert.equal(f.hook().data, undefined);
  assert.equal(f.client.getQueryData(options.queryKey), undefined, 'the denied payload must be removed from the query');
  f.state.status = 503; await assert.rejects(f.read(options));
  assert.equal(f.hook().data, undefined);
  f.state.status = 200; await f.read(options);
  assert.equal(f.hook().data.figures.ratedParticipants, 100);
});

test('rating analytics waits for current analytics.view authority before requesting figures', async t => {
  const f = fixture(t, { analytics: true });
  f.client.setQueryData(['ops-me'], { permissions: [], global_permissions: [], roles: [] });
  f.hook(); assert.equal(f.state.options.enabled, false);
  await assert.rejects(f.read(f.state.options)); assert.equal(f.state.reads, 0);
  f.client.setQueryData(['ops-me'], { permissions: ['analytics.view'], global_permissions: [], roles: [] });
  f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Authority unavailable') });
  f.hook(); assert.equal(f.state.options.enabled, false);
  await assert.rejects(f.read(f.state.options)); assert.equal(f.state.reads, 0);
});

