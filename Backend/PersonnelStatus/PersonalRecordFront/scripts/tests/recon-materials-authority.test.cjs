// Actual hook/component/AuthProvider with native query/mutation clients and synthetic I/O only.
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const front = path.resolve(__dirname, '../..');
const req = createRequire(path.join(front, 'package.json'));
const ts = req('typescript');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const query = req('@tanstack/react-query');
const turn = () => new Promise(setImmediate);

function slots() {
  const values = []; let index = 0; let effects = [];
  const changed = (old, deps) => !old || !deps || old.length !== deps.length || old.some((v, i) => !Object.is(v, deps[i]));
  const react = { ...React,
    useRef(initial) { const id = index++; return values[id] ??= { current: initial }; },
    useState(initial) { const id = index++; if (!(id in values)) values[id] = typeof initial === 'function' ? initial() : initial;
      return [values[id], value => { values[id] = typeof value === 'function' ? value(values[id]) : value; }]; },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const id = index++; if (changed(values[id]?.deps, deps)) {
      const old = values[id]; values[id] = { deps }; effects.push(() => { old?.cleanup?.(); values[id].cleanup = fn(); });
    } },
  };
  return { react, render(fn) { index = 0; effects = []; const tree = fn(); effects.forEach(fn => fn()); return tree; },
    unmount() { values.forEach(value => value?.cleanup?.()); } };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)]; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree); }

function fixture() {
  const client = new query.QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false, gcTime: Infinity, refetchOnWindowFocus: false }, mutations: { retry: false, gcTime: Infinity } } });
  const state = { session: { user: { id: 'actor-a' } }, status: 'authenticated', readStatus: 200, reads: [], downloads: [], writes: [], saved: [], pending: [], writePending: [], blobs: [], clearCount: 0 };
  const reconSlots = slots(); const authSlots = slots(); let activeReact = reconSlots.react;
  const rawClear = client.clear.bind(client);
  client.clear = () => { state.clearCount++; rawClear(); };
  const grants = wide => ({ permissions: ['event.view'], global_permissions: wide ? ['event.view'] : [], roles: [{ code: 'PATROL_LEAD', scope_division_id: wide ? null : 12 }] });
  const row = { id: '700', eventId: '50', visitObjectId: '34', checklistItemId: null, name: 'synthetic-wide-material.pdf', contentType: 'application/pdf', size: 64, uploadedAt: '2026-10-21T10:00:00Z', uploadedBy: 'synthetic-owner' };
  const subscriptions = []; const modules = new Map();
  let readOptions;
  const queryOverrides = { ...query, useQueryClient: () => client,
    useQuery(options) { readOptions = options; return new query.QueryObserver(client, options).getOptimisticResult(options); },
    useMutation(options) {
      const ref = activeReact.useRef(null);
      if (!ref.current) {
        const observer = new query.MutationObserver(client, options);
        subscriptions.push(observer.subscribe(() => {}));
        ref.current = { observer, reset: () => observer.reset(), mutate: variables => observer.mutate(variables).catch(() => {}),
          mutateAsync: variables => observer.mutate(variables) };
      }
      ref.current.observer.setOptions(options);
      return { ...ref.current.observer.getCurrentResult(), reset: ref.current.reset, mutate: ref.current.mutate, mutateAsync: ref.current.mutateAsync };
    },
  };
  const overrides = {
    '@tanstack/react-query': queryOverrides,
    react: new Proxy({}, { get: (_, key) => activeReact[key] }),
    'next-auth/react': { useSession: () => ({ data: state.session, status: state.status }), signIn: async () => ({ ok: true }), signOut: async () => {} },
    'next/navigation': { useRouter: () => ({ replace() {} }), usePathname: () => '/security-ops/events/50/' },
    '@/lib/access-token': { resetAccessToken() {} },
    '@/lib/expired-redirect': { expiredLoginUrl: () => '/' },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: !current || current.status === 'pending', error: current?.error,
        hasPermission: code => current?.status === 'success' && current.data.permissions.includes(code) };
    } },
    '@/lib/ops-api': { opsApiClient: {
      get: async url => { state.reads.push(url); if (state.readStatus !== 200) throw Object.assign(Error(state.readStatus === 403 ? 'PERMISSION_DENIED' : 'Temporary failure'), { status: state.readStatus }); const match = /security-events\/([^/]+)\/visit-objects\/([^/]+)/.exec(url); return { results: Array.from({ length: state.materialCount ?? 1 }, (_, index) => ({ ...row, id: String(700 + index), eventId: match[1], visitObjectId: match[2] })) }; },
      download: url => { state.downloads.push(url); return new Promise((resolve, reject) => state.pending.push({ resolve, reject })); },
      postForm: async (url, form) => { state.writes.push({ method: 'POST', url, form }); if (state.deferWrites) return new Promise((resolve, reject) => state.writePending.push({ resolve, reject })); return { ...row, id: '701' }; },
      del: async url => { state.writes.push({ method: 'DELETE', url }); if (state.deferWrites) return new Promise((resolve, reject) => state.writePending.push({ resolve, reject })); },
    } },
  };
  const browser = { body: { appendChild() {} }, createElement: () => ({ href: '', download: '', click() { state.saved.push({ href: this.href, filename: this.download }); }, remove() {} }) };
  function load(id, importer) {
    if (id in overrides) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return req(id);
    const base = id.startsWith('@/') ? path.join(front, id.slice(2)) : path.resolve(path.dirname(importer), id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw Error('Cannot resolve ' + id);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      { exports, require: name => load(name, file), document: browser, URL: { createObjectURL: blob => { state.blobs.push(blob); return 'blob:synthetic-' + state.blobs.length; }, revokeObjectURL() {} },
        setTimeout() { return 1; }, window: { location: { href: '/synthetic-audit' } }, Blob, FormData, console });
    return exports;
  }
  const { AuthProvider } = load('@/lib/auth');
  const { ReconMaterials } = load('@/features/security-event-stages/ui/ReconMaterials');
  const authority = load('@/lib/ops-write-authority');
  const unregister = authority.registerOpsWriteAuthority(() => authority.currentOpsAuthorityStamp(client, state.session?.user.id ?? null));
  const renderAuth = () => { activeReact = authSlots.react; return authSlots.render(() => AuthProvider({ children: React.createElement('span', null, 'protected-child') })); };
  renderAuth(); renderAuth();
  client.setQueryData(['ops-me'], grants(true));
  let props = { eventId: '50', visitObjectId: '34', checklist: [], canManage: false };
  const render = patch => { props = { ...props, ...patch }; activeReact = reconSlots.react; return reconSlots.render(() => ReconMaterials(props)); };
  const inspect = () => { const tree = render(); const html = renderToStaticMarkup(tree); return { tree, html, rowVisible: html.includes(row.name),
    downloadButtons: nodes(tree).filter(node => node.type === 'button' && text(node).includes('Скачать')).map(node => ({ disabled: Boolean(node.props.disabled) })),
    retry: nodes(tree).some(node => node.type === 'button' && text(node).includes('Повторить')), status: client.getQueryState(readOptions.queryKey)?.status,
    cachedRows: client.getQueryData(readOptions.queryKey)?.results?.length ?? 0, key: [...readOptions.queryKey] }; };
  const fetch = async () => { render(); return client.fetchQuery({ ...readOptions, staleTime: 0, retry: false }); };
  const startDownload = async () => { const button = nodes(render()).find(node => node.type === 'button' && text(node).includes('Скачать')); assert.ok(button); button.props.onClick(); await turn(); assert.equal(state.pending.length, 1); };
  const finishDownload = async () => { state.pending.shift().resolve({ blob: new Blob(['synthetic-private-bytes']), filename: row.name }); await turn(); await turn(); };
  return { client, state, grants, row, load, get readOptions() { return readOptions; }, render, renderAuth, inspect, fetch, startDownload, finishDownload,
    logout: () => renderAuth().props.value.logout(),
    authority: () => authority.currentOpsAuthorityStamp(client, state.session?.user.id ?? null),
    unmount() { reconSlots.unmount(); subscriptions.splice(0).forEach(fn => fn()); },
    close() { unregister(); reconSlots.unmount(); authSlots.unmount(); subscriptions.splice(0).forEach(fn => fn()); [...state.pending.splice(0), ...state.writePending.splice(0)].forEach(item => item.reject(Error('Fixture closed'))); rawClear(); } };
}

const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label);
const fileInput = tree => nodes(tree).find(node => node.type === 'input' && node.props.type === 'file');
const ownFixture = t => { const f = fixture(); t.after(f.close); return f; };

test('same event.view scope narrowing hides wider names immediately and rejects a retained list callback', async t => {
  const f = ownFixture(t); await f.fetch(); const old = f.readOptions;
  assert.equal(f.inspect().rowVisible, true);
  f.client.setQueryData(['ops-me'], f.grants(false)); f.renderAuth();
  assert.equal(f.inspect().rowVisible, false);
  assert.notDeepEqual(f.readOptions.queryKey, old.queryKey);
  const before = f.state.reads.length;
  await assert.rejects(f.client.fetchQuery({ ...old, staleTime: 0 }));
  assert.equal(f.state.reads.length, before);
  f.row.name = 'synthetic-own-scope.pdf'; await f.fetch();
  assert.equal(f.inspect().rowVisible, true, 'a legitimate own-scope successful list stays usable');
});

test('source403 hides names, count and actions without a false download promise;503 can retry and recover', async t => {
  const f = ownFixture(t); await f.fetch();
  f.state.readStatus = 403; await assert.rejects(f.fetch());
  const denied = f.inspect();
  assert.equal(denied.rowVisible, false);
  assert.equal(denied.downloadButtons.length, 0);
  assert.equal(denied.cachedRows, 0);
  assert.equal(denied.retry, false, 'a known object access restriction is not a transient retry');
  assert.doesNotMatch(denied.html, /0 из 30|Материалы доступны для скачивания/);
  assert.ok(nodes(denied.tree).some(node => node.props?.role === 'status' && /доступ/i.test(text(node))));
  f.state.readStatus = 503; await assert.rejects(f.fetch());
  const unavailable = f.inspect();
  assert.equal(unavailable.rowVisible, false); assert.equal(unavailable.retry, true);
  assert.doesNotMatch(unavailable.html, /0 из 30/);
  f.state.readStatus = 200; await f.fetch(); assert.equal(f.inspect().rowVisible, true);
  await f.startDownload(); await f.finishDownload(); assert.equal(f.state.saved.length, 1);
});

test('denial of one event/visit never evicts another authorized material target', async t => {
  const f = ownFixture(t); await f.fetch();
  f.render({ eventId: '51', visitObjectId: '35' }); await f.fetch(); const other = f.readOptions.queryKey;
  f.render({ eventId: '50', visitObjectId: '34' }); f.state.readStatus = 403; await assert.rejects(f.fetch());
  f.render({ eventId: '51', visitObjectId: '35' });
  assert.equal(f.inspect().rowVisible, true);
  assert.equal(f.client.getQueryData(other).results.length, 1);
  await f.startDownload(); await f.finishDownload(); assert.equal(f.state.saved.length, 1);
});

test('transient503 keeps recovery available and fresh own data can download', async t => {
  const f = ownFixture(t); f.client.setQueryData(['ops-me'], f.grants(false));
  f.state.readStatus = 503; await assert.rejects(f.fetch());
  assert.equal(f.inspect().retry, true);
  f.state.readStatus = 200; await f.fetch(); await f.startDownload(); await f.finishDownload();
  assert.equal(f.state.saved.length, 1); assert.equal(f.state.saved[0].filename, f.row.name);
});

for (const change of ['scope-without-rerender', 'target', 'unmount', 'source403-then503', 'source403-then-recovered', 'source-replaced', 'actor-with-provider-clear']) {
  test(`a pending binary never creates an URL or anchor after ${change}`, async t => {
    const f = ownFixture(t); await f.fetch(); await f.startDownload();
    if (change === 'scope-without-rerender') f.client.setQueryData(['ops-me'], f.grants(false));
    if (change === 'target') f.render({ eventId: '51', visitObjectId: '35' });
    if (change === 'unmount') f.unmount();
    if (change === 'source403-then503') { f.state.readStatus = 403; await assert.rejects(f.fetch()); f.state.readStatus = 503; await assert.rejects(f.fetch()); }
    if (change === 'source403-then-recovered') { f.state.readStatus = 403; await assert.rejects(f.fetch()); f.state.readStatus = 200; await f.fetch(); }
    if (change === 'source-replaced') { f.row.name = 'new-source-version.pdf'; await f.fetch(); }
    if (change === 'actor-with-provider-clear') { f.state.session = { user: { id: 'actor-b' } }; f.renderAuth(); f.unmount(); }
    await f.finishDownload();
    assert.equal(f.state.blobs.length, 0, 'not even an object URL may be published');
    assert.equal(f.state.saved.length, 0);
  });
}

test('a download403 blocks its target source and does not promise another download', async t => {
  const f = ownFixture(t); await f.fetch(); await f.startDownload();
  f.state.pending.shift().reject(Object.assign(Error('PERMISSION_DENIED'), { status: 403 })); await turn();
  const denied = f.inspect(); assert.equal(denied.rowVisible, false); assert.equal(denied.downloadButtons.length, 0);
  assert.equal(denied.retry, false); assert.doesNotMatch(denied.html, /0 из 30|Материалы доступны для скачивания/);
});

for (const change of ['scope', 'target']) {
  test(`retained JSX download/remove callbacks cannot act after ${change}`, async t => {
    const f = ownFixture(t); f.render({ canManage: true }); await f.fetch(); const old = f.render();
    if (change === 'scope') f.client.setQueryData(['ops-me'], f.grants(false));
    else f.render({ eventId: '51', visitObjectId: '35' });
    button(old, 'Скачать').props.onClick(); button(old, 'Удалить').props.onClick(); await turn();
    assert.equal(f.state.downloads.length, 0); assert.equal(f.state.writes.length, 0);
  });
}

for (const change of ['scope', 'target']) test(`selected upload/checklist state does not cross ${change}; retained upload is rejected`, async t => {
  const f = ownFixture(t); f.render({ canManage: true, checklist: [{ id: 'photo', label: 'Photo' }] }); await f.fetch();
  let tree = f.render(); nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'photo' } });
  fileInput(f.render()).props.onChange({ target: { files: [new File(['owned'], 'owned.png', { type: 'image/png' })] } });
  const old = f.render(); assert.equal(button(old, 'Загрузить').props.disabled, false);
  if (change === 'scope') f.client.setQueryData(['ops-me'], f.grants(false));
  else f.render({ eventId: '51', visitObjectId: '35' });
  tree = f.render(); assert.equal(nodes(tree).find(node => node.type === 'select').props.value, '');
  button(old, 'Загрузить').props.onClick(); await turn(); assert.equal(f.state.writes.length, 0);
  await f.fetch(); assert.equal(button(f.render(), 'Загрузить').props.disabled, true, 'old selected file must not enable a new-scope upload');
});

test('missing target and unverified grants cannot authorize manual reads or retained actions', async t => {
  const f = ownFixture(t); f.render({ visitObjectId: null }); const before = f.state.reads.length;
  await assert.rejects(f.fetch()); assert.equal(f.state.reads.length, before);
  f.render({ visitObjectId: '34' }); await f.fetch(); const old = f.render();
  f.client.getQueryCache().find({ queryKey: ['ops-me'], exact: true }).setState({ status: 'error', error: Error('Authority unavailable') });
  assert.equal(f.inspect().rowVisible, false);
  button(old, 'Скачать').props.onClick(); await turn(); assert.equal(f.state.downloads.length, 0);
  const reads = f.state.reads.length; await assert.rejects(f.fetch()); assert.equal(f.state.reads.length, reads);
});

test('authorized upload/delete preserve multipart target, invalidation and read-only/size/limit controls', async t => {
  const f = ownFixture(t); await f.fetch(); assert.equal(button(f.render(), 'Загрузить'), undefined);
  f.render({ canManage: true });
  fileInput(f.render()).props.onChange({ target: { files: [new File(['owned'], 'owned.pdf', { type: 'application/pdf' })] } });
  button(f.render(), 'Загрузить').props.onClick(); await turn();
  assert.equal(f.state.writes[0].method, 'POST'); assert.match(f.state.writes[0].url, /50\/visit-objects\/34\/recon-materials\/$/);
  assert.equal(f.state.writes[0].form.get('file').name, 'owned.pdf');
  assert.equal(f.client.getQueryState(f.readOptions.queryKey).isInvalidated, true);
  await f.fetch(); button(f.render(), 'Удалить').props.onClick(); await turn();
  assert.equal(f.state.writes[1].method, 'DELETE'); assert.match(f.state.writes[1].url, /\/700\/$/);
  await f.fetch(); const before = f.state.writes.length;
  fileInput(f.render()).props.onChange({ target: { files: [{ size: 10 * 1024 * 1024 + 1, name: 'too-large.pdf' }] } });
  button(f.render(), 'Загрузить').props.onClick(); await turn(); assert.equal(f.state.writes.length, before);
  assert.match(f.inspect().html, /10 МБ/);
  f.state.materialCount = 30; await f.fetch(); assert.equal(fileInput(f.render()).props.disabled, true);
  assert.equal(button(f.render(), 'Загрузить').props.disabled, true);
});

test('real AuthProvider account-switch and logout continue clearing the old list', async t => {
  const f = ownFixture(t); await f.fetch(); const clears = f.state.clearCount;
  f.state.session = { user: { id: 'actor-b' } }; const held = f.renderAuth();
  assert.equal(held.props.children, null); assert.ok(f.state.clearCount > clears);
  f.client.setQueryData(['ops-me'], f.grants(false)); f.renderAuth(); assert.equal(f.inspect().rowVisible, false);
  await f.fetch(); assert.equal(f.inspect().rowVisible, true);
  await f.logout(); assert.equal(f.inspect().rowVisible, false);
});

test('an already successful upload after target switch invalidates only its old source without a new read or UI delivery', async t => {
  const f = ownFixture(t); f.render({ canManage: true }); await f.fetch(); const oldKey = f.readOptions.queryKey;
  f.state.deferWrites = true;
  fileInput(f.render()).props.onChange({ target: { files: [new File(['owned'], 'owned.pdf', { type: 'application/pdf' })] } });
  button(f.render(), 'Загрузить').props.onClick(); await turn(); assert.equal(f.state.writes.length, 1);
  f.render({ eventId: '51', visitObjectId: '35' }); const newKey = f.readOptions.queryKey; const reads = f.state.reads.length;
  f.state.writePending.shift().resolve({ ...f.row, id: '701' }); await turn();
  assert.equal(f.client.getQueryState(oldKey).isInvalidated, true, 'a completed write must be reloaded when its old target is reopened');
  assert.equal(f.client.getQueryState(newKey).isInvalidated, false);
  assert.equal(f.state.reads.length, reads, 'do not start an old-context read after the user switches target');
  assert.equal(f.state.saved.length, 0);
});

for (const operation of ['upload', 'remove']) test(`accepted ${operation} completes after a same-target successful refetch without retaining a duplicate action`, async t => {
  const f = ownFixture(t); f.render({ canManage: true }); await f.fetch(); const key = f.readOptions.queryKey;
  f.state.deferWrites = true;
  if (operation === 'upload') {
    fileInput(f.render()).props.onChange({ target: { files: [new File(['owned'], 'accepted.pdf', { type: 'application/pdf' })] } });
    button(f.render(), 'Загрузить').props.onClick();
  } else button(f.render(), 'Удалить').props.onClick();
  await turn(); assert.equal(f.state.writes.length, 1);
  const before = f.client.getQueryData(key);
  // A background read can already include the saved upload or exclude the deleted row.
  if (operation === 'upload') { f.state.materialCount = 2; f.row.name = 'fresh-material.pdf'; }
  else f.state.materialCount = 0;
  await f.fetch(); assert.notEqual(f.client.getQueryData(key), before);
  f.state.writePending.shift().resolve(operation === 'upload' ? { ...f.row, id: '701' } : undefined);
  await turn(); await turn();
  const view = f.inspect();
  assert.doesNotMatch(view.html, /role="alert"/, 'an accepted write must not become an access error after a successful refetch');
  assert.equal(f.client.getQueryState(key).isInvalidated, true, 'invalidate the current cache even if the removed row is already absent');
  assert.equal(button(view.tree, 'Загрузить').props.disabled, true, 'accepted upload clears selection rather than inviting a duplicate retry');
  if (operation === 'upload') button(view.tree, 'Загрузить').props.onClick();
  await turn(); assert.equal(f.state.writes.length, 1, 'completion must not leave an actionable duplicate upload');
  assert.equal(view.cachedRows, operation === 'upload' ? 2 : 0);
});

for (const change of ['scope', 'unmount', 'source403-then503', 'source403-then-recovered', 'download403-then-recovered']) {
  test(`accepted upload cannot publish completion after ${change}`, async t => {
    const f = ownFixture(t); f.render({ canManage: true }); await f.fetch(); const key = f.readOptions.queryKey;
    f.state.deferWrites = true;
    fileInput(f.render()).props.onChange({ target: { files: [new File(['owned'], 'accepted.pdf', { type: 'application/pdf' })] } });
    button(f.render(), 'Загрузить').props.onClick(); await turn();
    if (change === 'scope') { f.client.setQueryData(['ops-me'], f.grants(false)); f.render(); }
    if (change === 'unmount') f.unmount();
    if (change.startsWith('source403')) {
      f.state.readStatus = 403; await assert.rejects(f.fetch());
      f.state.readStatus = change.endsWith('recovered') ? 200 : 503;
      if (f.state.readStatus === 200) await f.fetch(); else await assert.rejects(f.fetch());
    }
    if (change === 'download403-then-recovered') {
      await f.startDownload();
      f.state.pending.shift().reject(Object.assign(Error('PERMISSION_DENIED'), { status: 403 })); await turn();
      await f.fetch();
    }
    const reads = f.state.reads.length;
    f.state.writePending.shift().resolve({ ...f.row, id: '701' }); await turn(); await turn();
    assert.equal(f.client.getQueryState(key).isInvalidated, true, 'already saved content still marks only its old source stale');
    assert.equal(f.state.reads.length, reads, 'no read is started from an invalidated action context');
    assert.equal(f.state.saved.length, 0);
    if (change.endsWith('recovered')) {
      assert.match(f.inspect().html, /role="alert"/, 'recovery cannot authorize an older interrupted completion');
      assert.equal(button(f.render(), 'Загрузить').props.disabled, false, 'a denied completion must not silently clear current local selection');
    }
  });
}

