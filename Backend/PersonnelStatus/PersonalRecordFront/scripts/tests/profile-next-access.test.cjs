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
  const session = { user: { id: 'actor-1' } };
  const grants = { permissions: ['status.view'], roles: [{ code: 'EMPLOYEE', scope_division_id: null }] };
  client.setQueryData(['ops-me'], grants);
  const state = { status: 200, paths: [], options: [], effects: [], employeeId: '17', monotonicMs: 5000,
    writes: [], writeStatus: 200, ackPending: false, ackMode: false, refs: [], refIndex: 0,
    row: { id: 'STATUS:17:exit', source: 'STATUS', source_id: 17, source_state: 'PLANNED', business_date: '2026-10-20',
      date_start: '2026-10-20', date_end: '2026-10-20', planned_start: '2026-10-20T13:00:00+05:00', planned_end: '2026-10-20T15:00:00+05:00',
      actual_start: null, actual_end: null, acknowledged_at: null, object_label: 'Private object', post_label: 'Post',
      senior: null, instruction: null, readOnly: true, canAcknowledge: true, acknowledgementToken: 'a'.repeat(64) } };
  const modules = new Map();
  const override = {
    '@/hooks/use-ops-mutation': { useOpsMutation: options => !state.ackMode ? options : ({
      isPending: state.ackPending, data: state.ackData, error: state.ackError,
      reset() { state.ackData = undefined; state.ackError = null; },
      async mutateAsync(variables) {
        state.ackPending = true; state.ackError = null;
        try { const data = await options.mutationFn(variables); state.ackData = data; options.onSuccess?.(data, variables); return data; }
        catch (error) { state.ackError = error; throw error; }
        finally { state.ackPending = false; }
      },
    }) },
    'react': { ...require('react'), useEffect: fn => state.effects.push(fn), useRef: value => state.refs[state.refIndex++] ??= { current: value } },
    'next-auth/react': { useSession: () => ({ data: session, status: 'authenticated' }) },
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options.push(options);
      return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { permissions: current.status === 'success' ? new Set(current.data.permissions) : undefined,
        isLoading: current.status === 'pending', error: current.error };
    } },
    '@/lib/ops-api': { opsApiClient: { get: async (url, authorize) => {
      authorize?.();
      state.paths.push(url);
      if (state.wait) await state.wait;
      if (state.status !== 200) throw Object.assign(Error('Denied'), { status: state.status });
      return { employeeId: state.employeeId, unlinkedReason: null, time_zone: 'Asia/Almaty', generated_at: '2026-10-20T07:00:00Z',
        results: url.includes('personal-duty') ? [{ ...state.row }] : [{ id: 'private-om' }] };
    }, post: async (url, body, authorize) => {
      authorize?.();
      if (state.tokenWait) await state.tokenWait;
      authorize?.();
      state.writes.push({ url, body });
      const record = { ...state.row, canAcknowledge: false, acknowledged_at: '2026-10-20T07:00:00Z', source_state: 'ACKNOWLEDGED' };
      if (state.postWait) await state.postWait;
      if (state.writeStatus !== 200) throw Object.assign(Error('Write rejected'), { status: state.writeStatus });
      return { record, generated_at: '2026-10-20T07:00:00Z', time_zone: 'Asia/Almaty' };
    } } },
  };
  function load(name) {
    if (Object.hasOwn(override, name)) return override[name];
    if (!name.startsWith('@/')) return require(name);
    if (modules.has(name)) return modules.get(name);
    const base = path.join(__dirname, '../..', name.slice(2));
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    const exported = {};
    modules.set(name, exported);
    if (file) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports: exported, URLSearchParams, performance: { now: () => state.monotonicMs },
      require: id => id.startsWith('.')
        ? load('@/' + path.relative(path.join(__dirname, '../..'), path.resolve(path.dirname(file), id)).replaceAll('\\', '/'))
        : load(id) });
    return exported;
  }
  const authority = load('@/lib/ops-write-authority');
  t.after(authority.registerOpsWriteAuthority(() => authority.currentOpsAuthorityStamp(client, session.user.id)));
  const subject = load('@/hooks/use-profile-next-shift');
  const render = (employee = '17', enabled = true) => {
    assert.equal(typeof subject.useProfileNextShiftSources, 'function', 'protected personal sources must be implemented');
    state.options = []; state.effects = [];
    const result = subject.useProfileNextShiftSources(employee, enabled);
    state.effects.forEach(effect => effect());
    return result;
  };
  const read = options => client.fetchQuery({ ...options, staleTime: 0 });
  const ackRender = (employee = '17') => {
    const sources = render(employee), model = load('@/widgets/my-profile/model/profile-next-shift');
    const data = sources.duties.data;
    const now = model.profileServerNow(data?.generated_at, data?.receivedMonotonicMs, state.monotonicMs);
    const shift = now ? model.selectNextProfileShift(data?.results ?? [], [], now) : null;
    assert.equal(typeof subject.useAcknowledgePersonalDuty, 'function', 'self acknowledgement must be implemented');
    state.refIndex = 0; state.ackMode = true; state.effects = [];
    const result = subject.useAcknowledgePersonalDuty(employee, shift, sources);
    state.effects.forEach(effect => effect()); state.ackMode = false;
    return result;
  };
  return { client, session, grants, state, render, read, ackRender, actions: load('@/hooks/use-my-assignments') };
}

for (const status of [401, 403]) test(`personal duty ${status} clears both cached self sources through a later transient failure`, async t => {
  const f = fixture(t);
  f.render(); const options = f.state.options.slice();
  await Promise.all(options.map(f.read));
  assert.ok(f.render().duties.data);
  assert.ok(f.render().assignments.data);
  f.state.status = status;
  await assert.rejects(f.read(options[0]));
  const blocked = f.render();
  assert.equal(blocked.duties.data, undefined);
  assert.equal(blocked.assignments.data, undefined);
  assert.equal(f.client.getQueryData(options[0].queryKey), undefined);
  assert.equal(f.client.getQueryData(options[1].queryKey), undefined);
  f.state.status = 503;
  await assert.rejects(f.read(options[0]));
  assert.equal(f.render().duties.data, undefined);
  f.state.status = 200;
  await f.read(options[0]);
  assert.ok(f.render().duties.data);
});

test('employee identity changes isolate and discard both cached sources without an employee query override', async t => {
  const f = fixture(t);
  f.render(); const old = f.state.options.slice();
  await Promise.all(old.map(f.read));
  const changed = f.render('18');
  assert.equal(changed.duties.data, undefined);
  assert.equal(changed.assignments.data, undefined);
  assert.equal(f.client.getQueryData(old[0].queryKey), undefined);
  assert.equal(f.client.getQueryData(old[1].queryKey), undefined);
  assert.deepEqual(f.state.paths.sort(), ['/api/ops/personal-duty/', '/api/ops/security-events/my-assignments/']);
});

test('rights and actor changes cannot display previously authorized private rows', async t => {
  const f = fixture(t);
  f.render(); const old = f.state.options.slice();
  await Promise.all(old.map(f.read));
  f.client.setQueryData(['ops-me'], { ...f.grants, permissions: [] });
  assert.equal(f.render().duties.data, undefined);
  assert.equal(f.client.getQueryData(old[0].queryKey), undefined);
  f.client.setQueryData(['ops-me'], f.grants);
  assert.equal(f.render().duties.data, undefined, 'restoring grants cannot revive the old payload');
  f.session.user.id = 'actor-2';
  assert.equal(f.render().assignments.data, undefined);
});

test('a mismatched employee response is refused and purged from the self cache', async t => {
  const f = fixture(t);
  f.render(); const options = f.state.options[0];
  await f.read(options);
  f.state.employeeId = 'other-person';
  await assert.rejects(f.read(options));
  assert.equal(f.render().duties.data, undefined);
  assert.equal(f.client.getQueryData(options.queryKey), undefined);
});

test('foreign profiles and failed permission authority issue no self read even on a manual refetch', async t => {
  const f = fixture(t);
  f.render('17', false);
  for (const options of f.state.options) {
    assert.equal(options.enabled, false);
    await assert.rejects(f.read(options));
  }
  f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('Unavailable') });
  f.render();
  for (const options of f.state.options) {
    assert.equal(options.enabled, false);
    await assert.rejects(f.read(options));
  }
  assert.equal(f.state.paths.length, 0);
});

test('a late successful response after a session change never enters the new actor cache', async t => {
  const f = fixture(t);
  let release;
  f.state.wait = new Promise(resolve => { release = resolve; });
  f.render(); const options = f.state.options[0];
  const oldRead = f.read(options);
  f.session.user.id = 'actor-2';
  release();
  await assert.rejects(oldRead);
  assert.equal(f.render().duties.data, undefined);
  assert.equal(f.client.getQueryData(options.queryKey), undefined);
});

test('acknowledgement and refusal refresh the compact personal card immediately', t => {
  const f = fixture(t);
  const key = ['ops-profile-next', 'assignments', 'self-scope', '17'];
  for (const action of [f.actions.useAcknowledgeMyAssignment, f.actions.useDeclineMyAssignment]) {
    f.client.setQueryData(key, { results: ['old'] });
    action().onSuccess();
    assert.equal(f.client.getQueryState(key).isInvalidated, true);
  }
});

for (const heldIndex of [0, 1]) test(`a pre-denial ${heldIndex === 0 ? 'duty' : 'OM'} response cannot restore either source after its sibling is denied`, async t => {
  const f = fixture(t);
  f.render(); const options = f.state.options.slice();
  await Promise.all(options.map(f.read));
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const heldPath = heldIndex === 0 ? 'personal-duty' : 'my-assignments';
  Object.defineProperty(f.state, 'wait', { get: () => f.state.paths.at(-1)?.includes(heldPath) ? wait : undefined });
  const oldRead = f.read(options[heldIndex]).then(() => ({ accepted: true }), error => ({ error }));
  f.state.status = 403;
  await assert.rejects(f.read(options[1 - heldIndex]));
  assert.equal(f.render().duties.data, undefined);
  assert.equal(f.render().assignments.data, undefined);
  f.state.status = 200;
  // An explicit, authorized read made after the denial may recover its own source.
  await f.read(options[1 - heldIndex]);
  release();
  const oldResult = await oldRead;
  const after = f.render();
  assert.equal((heldIndex === 0 ? after.duties : after.assignments).data, undefined, 'the pre-denial private payload must stay hidden');
  assert.equal(f.client.getQueryData(options[heldIndex].queryKey), undefined, 'the pre-denial cache must stay cleared');
  assert.equal(oldResult.error?.status, 503, 'a stale read is rejected without denying the newly authorized source again');
  assert.ok((heldIndex === 0 ? after.assignments : after.duties).data);
  await f.read(options[heldIndex]);
  assert.ok((heldIndex === 0 ? f.render().duties : f.render().assignments).data);
});

test('the personal response records a monotonic receipt anchor alongside server time', async t => {
  const f = fixture(t);
  f.render();
  await f.read(f.state.options[0]);
  const data = f.render().duties.data;
  assert.equal(data.generated_at, '2026-10-20T07:00:00Z');
  assert.equal(data.receivedMonotonicMs, 5000);
});

async function ackFixture(t) {
  const f = fixture(t); f.render();
  const options = f.state.options.slice();
  await Promise.all(options.map(f.read));
  f.options = options;
  return f;
}

test('self acknowledgement posts exactly the seen key and token once and refreshes only its duty source', async t => {
  const f = await ackFixture(t), action = f.ackRender();
  let release; f.state.postWait = new Promise(resolve => { release = resolve; });
  const first = action.submit(), repeated = action.submit();
  assert.equal(first, repeated, 'rapid repeated clicks share the same operation');
  await Promise.resolve();
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].url, '/api/ops/personal-duty/STATUS%3A17%3Aexit/acknowledge/');
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.writes[0].body)), { token: 'a'.repeat(64) });
  release(); await first;
  assert.equal(f.client.getQueryState(f.options[0].queryKey).isInvalidated, true);
  assert.equal(f.client.getQueryState(f.options[1].queryKey).isInvalidated, false);
  assert.equal(f.client.getQueryData(f.options[0].queryKey).results[0].actual_start, null);
});

for (const change of ['actor', 'employee', 'key', 'token', 'permission', 'expired']) test(`self acknowledgement cannot escape a ${change} change while awaiting its token`, async t => {
  const f = await ackFixture(t), action = f.ackRender();
  let release; f.state.tokenWait = new Promise(resolve => { release = resolve; });
  const pending = action.submit();
  const rejected = assert.rejects(pending);
  if (change === 'actor') f.session.user.id = 'actor-2';
  if (change === 'permission') f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('No authority') });
  if (change === 'expired') f.state.monotonicMs += 4 * 60 * 60 * 1000;
  if (change === 'key' || change === 'token') {
    f.client.setQueryData(f.options[0].queryKey, previous => ({ ...previous, results: [{ ...previous.results[0],
      ...(change === 'key' ? { id: 'LOG:changed' } : { acknowledgementToken: 'b'.repeat(64) }) }] }));
  }
  if (change !== 'actor' && change !== 'permission') f.ackRender(change === 'employee' ? '18' : '17');
  release(); await rejected;
  assert.equal(f.state.writes.length, 0);
});

for (const status of [401, 403, 404]) test(`self acknowledgement ${status} clears and blocks both personal read caches`, async t => {
  const f = await ackFixture(t), action = f.ackRender();
  f.state.writeStatus = status;
  await assert.rejects(action.submit());
  const result = f.render();
  assert.equal(result.duties.data, undefined);
  assert.equal(result.assignments.data, undefined);
  assert.equal(f.client.getQueryData(f.options[0].queryKey), undefined);
  assert.equal(f.client.getQueryData(f.options[1].queryKey), undefined);
});

test('a stale assignment token409 asks for refresh without marking acknowledgement or attendance', async t => {
  const f = await ackFixture(t), action = f.ackRender();
  f.state.writeStatus = 409;
  await assert.rejects(action.submit());
  const current = f.ackRender();
  assert.match(current.errorMessage, /Обновите/);
  assert.equal(current.canSubmit, false);
  const row = f.client.getQueryData(f.options[0].queryKey).results[0];
  assert.equal(row.acknowledged_at, null); assert.equal(row.actual_start, null);
});

test('a late successful acknowledgement cannot attach its feedback or refresh to a newly selected exit', async t => {
  const f = await ackFixture(t), action = f.ackRender();
  let release; f.state.postWait = new Promise(resolve => { release = resolve; });
  const pending = action.submit(), rejected = assert.rejects(pending);
  f.client.setQueryData(f.options[0].queryKey, previous => ({ ...previous, results: [{ ...previous.results[0], id: 'LOG:new', acknowledgementToken: 'b'.repeat(64) }] }));
  f.ackRender(); release(); await rejected;
  const current = f.ackRender();
  assert.equal(current.succeeded, false); assert.equal(current.errorMessage, null);
  assert.equal(f.client.getQueryState(f.options[0].queryKey).isInvalidated, false);
});

test('a row without an explicit acknowledgement action or token never sends a self write', async t => {
  const f = await ackFixture(t);
  f.client.setQueryData(f.options[0].queryKey, previous => ({ ...previous, results: [{ ...previous.results[0], canAcknowledge: false, acknowledgementToken: null }] }));
  const action = f.ackRender();
  assert.equal(action.canSubmit, false);
  await assert.rejects(action.submit());
  assert.equal(f.state.writes.length, 0);
});

test('an authorized fresh same-token read clears a local409 gate while a failed refresh cannot', async t => {
  const f = await ackFixture(t), action = f.ackRender();
  let release; f.state.tokenWait = new Promise(resolve => { release = resolve; });
  const pending = action.submit(), rejected = assert.rejects(pending);
  const query = f.client.getQueryCache().find({ queryKey: f.options[0].queryKey, exact: true });
  query.setState({ fetchStatus: 'fetching' });
  release(); await rejected;
  query.setState({ fetchStatus: 'idle' });
  assert.equal(f.ackRender().canSubmit, false);
  assert.equal(f.state.writes.length, 0);
  f.state.status = 503;
  await assert.rejects(f.read(f.options[0]));
  assert.equal(f.ackRender().canSubmit, false);
  f.state.status = 200;
  await f.read(f.options[0]);
  const recovered = f.ackRender();
  assert.equal(recovered.canSubmit, true, 'an unchanged but freshly authorized assignment can be confirmed again');
  assert.equal(recovered.errorMessage, null);
  await recovered.submit();
  assert.equal(f.state.writes.length, 1);
});

test('old acknowledgement success never revives after a plan resets and returns to the same token', async t => {
  const f = await ackFixture(t);
  await f.ackRender().submit();
  const replace = (token, acknowledged_at, canAcknowledge) => f.client.setQueryData(f.options[0].queryKey, previous => ({ ...previous,
    results: [{ ...previous.results[0], acknowledgementToken: token, acknowledged_at, canAcknowledge }] }));
  replace('a'.repeat(64), '2026-10-20T07:00:00Z', false);
  assert.equal(f.ackRender().succeeded, true, 'a current matching accepted fact can confirm the completed action');
  replace('b'.repeat(64), null, true); f.ackRender();
  replace('a'.repeat(64), null, true);
  const reset = f.ackRender();
  assert.equal(reset.canSubmit, true);
  assert.equal(reset.succeeded, false, 'the former mutation is not acknowledgement of the current reset plan');
  replace('a'.repeat(64), '2026-10-21T07:00:00Z', false);
  assert.equal(f.ackRender().succeeded, false, 'a future acknowledgement cannot supply current success feedback');
});
