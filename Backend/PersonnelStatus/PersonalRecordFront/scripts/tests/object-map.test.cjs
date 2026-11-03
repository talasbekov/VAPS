const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

const front = path.join(__dirname, '../..');
const bounds = { west: 71.15, south: 50.98, east: 71.7, north: 51.35 };
const point = { latitude: 51.128, longitude: 71.43 };
function loader(overrides = {}) {
  const cache = new Map();
  function load(id, from = front) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(front, id.slice(2)) : path.resolve(from, id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) return {};
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(compiled, { exports, require: child => load(child, path.dirname(file)), URLSearchParams, FormData });
    return exports;
  }
  return load;
}
const plain = value => JSON.parse(JSON.stringify(value));
function model() {
  const m = loader()('@/features/object-map/model/location');
  assert.equal(typeof m.parseLocationInputs, 'function', 'coordinate validation must be implemented');
  return m;
}

test('manual coordinates preserve zero and WGS84 boundaries without coercing missing or invalid inputs', () => {
  const m = model();
  assert.deepEqual(plain(m.parseLocationInputs('0', '0')), { latitude: 0, longitude: 0 });
  assert.deepEqual(plain(m.parseLocationInputs('-90', '180')), { latitude: -90, longitude: 180 });
  for (const [latitude, longitude] of [['', '71.43'], [' ', '0'], ['NaN', '0'], ['Infinity', '0'], ['91', '0'], ['0', '-181'], ['false', '0']]) {
    assert.equal(m.parseLocationInputs(latitude, longitude), null);
  }
});

test('coverage accepts only validated manifest bounds and rejects outside clicks without clamping', () => {
  const m = model();
  assert.deepEqual(plain(m.readMapBounds(bounds)), bounds);
  for (const invalid of [null, {}, { ...bounds, west: NaN }, { ...bounds, north: '51.35' }, { ...bounds, west: bounds.east }, { ...bounds, south: -91 }]) {
    assert.equal(m.readMapBounds(invalid), null);
  }
  assert.equal(m.isWithinMapCoverage(point, bounds), true);
  assert.equal(m.isWithinMapCoverage({ latitude: bounds.north, longitude: bounds.east }, bounds), true);
  assert.equal(m.isWithinMapCoverage({ latitude: bounds.north + 0.000001, longitude: 71.43 }, bounds), false);
  assert.equal(m.isWithinMapCoverage(point, null), false);
});

test('registry markers use only saved in-coverage catalog IDs; missing and distant objects are counted separately', () => {
  const m = model();
  const objects = [
    { id: 'catalog-1', name: 'First', location: point },
    { id: 'catalog-2', name: 'Missing', location: null },
    { id: 'catalog-3', name: 'Outside', location: { latitude: 0, longitude: 0 } },
    { id: 'catalog-4', name: 'Legacy' },
  ];
  const result = m.buildObjectMapMarkers(objects, bounds);
  assert.deepEqual(plain(result), { markers: [{ id: 'catalog-1', kind: 'object', label: 'First', location: point }], missingCount: 2, outsideCount: 1 });
  assert.equal(objects[1].location, null);
});

test('object location route safely encodes the catalog ID', () => {
  const m = loader()('@/entities/security-object/model/types');
  assert.equal(typeof m.objectLocationPath, 'function', 'location endpoint must be declared');
  assert.equal(m.objectLocationPath('one/two ?'), '/api/ops/objects/one%2Ftwo%20%3F/location/');
});

function mutationFixture(t) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  client.setQueryData(['ops-me'], { permissions: ['object.view', 'object.manage'] });
  client.setQueryData(['ops-objects', 'one'], { id: 'one', location: null });
  let current = true, saved = 0;
  const writes = [];
  const load = loader({
    react: { useRef: value => ({ current: value }) },
    '@tanstack/react-query': { useQueryClient: () => client },
    '@/hooks/use-ops-mutation': { useOpsMutation: options => options },
    '@/entities/security-object': loader()('@/entities/security-object/model/types'),
    '@/lib/ops-api': { opsApiClient: { patch: async (url, body) => { writes.push({ url, body }); return { id: 'one', location: body.location }; } } },
  });
  const hook = load('@/hooks/use-security-objects').useUpdateObjectLocation;
  assert.equal(typeof hook, 'function', 'location mutation must be implemented');
  const mutation = hook('one', () => saved++, () => current);
  return { client, writes, mutation, denyContext: () => { current = false; }, saved: () => saved,
    readAccess: load('@/lib/query-read-access') };
}

test('location mutation writes only the location endpoint and updates its object cache after a current success', async t => {
  const f = mutationFixture(t), body = { location: point };
  const result = await f.mutation.mutationFn(body);
  f.mutation.onSuccess(result, body);
  assert.deepEqual(plain(f.writes), [{ url: '/api/ops/objects/one/location/', body }]);
  assert.deepEqual(plain(f.client.getQueryData(['ops-objects', 'one'])), { id: 'one', location: point });
  assert.equal(f.saved(), 1);
});

for (const reason of ['navigation', 'permission-failure', 'missing-manage', 'read-denial', 'read-failure']) {
  test(`location mutation cannot submit after ${reason}`, async t => {
    const f = mutationFixture(t);
    if (reason === 'navigation') f.denyContext();
    if (reason === 'permission-failure') f.client.getQueryCache().find({ queryKey: ['ops-me'] }).setState({ status: 'error', error: Error('refresh failed') });
    if (reason === 'missing-manage') f.client.setQueryData(['ops-me'], { permissions: ['object.view'] });
    if (reason === 'read-denial') f.readAccess.blockReadAccess(f.client, ['ops-objects', 'one']);
    if (reason === 'read-failure') f.client.getQueryCache().find({ queryKey: ['ops-objects', 'one'] }).setState({ status: 'error', error: Error('read failed') });
    await assert.rejects(async () => f.mutation.mutationFn({ location: point }));
    assert.equal(f.writes.length, 0);
  });
}

function editorFixture() {
  const React = require('react');
  const state = [], effects = [];
  let index = 0, tree, hookOptions;
  const props = { objectId: 'one', label: 'First', location: null, canEdit: true, isActive: true };
  const mutation = { isPending: false, error: null, writes: [], reset() {}, mutate(body) { this.writes.push(body); } };
  const load = loader({
    react: { ...React,
      useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
        return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
      useRef: initial => { const slot = index++; return state[slot] ?? (state[slot] = { current: initial }); },
      useMemo: (fn, deps) => { const slot = index++, previous = state[slot];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) state[slot] = { value: fn(), deps };
        return state[slot].value; },
      useEffect: (fn, deps) => { const slot = index++, previous = state[slot];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          state[slot] = { deps }; effects.push(() => { previous?.cleanup?.(); state[slot].cleanup = fn(); });
        } },
    },
    '@/hooks/use-security-objects': { useUpdateObjectLocation: (id, onSaved, isCurrentResult) => {
      hookOptions = { id, onSaved, isCurrentResult }; return mutation;
    } },
    '@/features/object-map/model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds, isLoading: false, error: false, retry() {} }) },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
    '@/components/ui/card': { Card: 'section', CardHeader: 'header', CardTitle: 'h2', CardContent: 'div' },
    '@/features/object-map/ui/LocalObjectMap': { LocalObjectMap: 'local-map' },
    './LocalObjectMap': { LocalObjectMap: 'local-map' },
    '../model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds, isLoading: false, error: false, retry() {} }) },
  });
  const Editor = load('@/features/object-map/ui/ObjectLocationEditor').ObjectLocationEditor;
  assert.equal(typeof Editor, 'function', 'explicit location editor must be implemented');
  function render() { index = 0; tree = Editor(props); for (const effect of effects.splice(0)) effect(); return tree; }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(child => nodes(child))];
  }
  function find(predicate) { const node = nodes().find(predicate); assert.ok(node, 'expected editor control'); return node; }
  function button(label) { return find(node => node.type === 'button' && node.props.children === label); }
  function input(label) { return find(node => node.type === 'input' && node.props['aria-label'] === label); }
  function click(label) { button(label).props.onClick(); render(); }
  function type(label, value) { input(label).props.onChange({ target: { value } }); render(); }
  render();
  return { props, mutation, render, button, input, click, type, nodes, options: () => hookOptions,
    map: () => find(node => node.type === 'local-map') };
}

test('editing, clicking and cancelling only change the draft; external refreshes preserve typed coordinates', () => {
  const f = editorFixture();
  f.click('Указать местоположение');
  f.map().props.onPoint(point); f.render();
  assert.equal(f.input('Широта объекта').props.value, '51.128000');
  f.type('Широта объекта', '51.135'); f.type('Долгота объекта', '71.44');
  f.props.location = { latitude: 51.15, longitude: 71.46 }; f.render();
  assert.equal(f.input('Широта объекта').props.value, '51.135');
  assert.equal(f.mutation.writes.length, 0);
  f.click('Отмена');
  assert.equal(f.mutation.writes.length, 0);
});

test('an outside-coverage map click preserves the draft while valid outside manual coordinates can be saved', () => {
  const f = editorFixture();
  f.click('Указать местоположение');
  f.map().props.onPoint(point); f.render();
  f.map().props.onPoint({ latitude: 51.350001, longitude: 71.43 }); f.render();
  assert.equal(f.input('Широта объекта').props.value, '51.128000');
  f.type('Широта объекта', '0'); f.type('Долгота объекта', '0');
  f.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(plain(f.mutation.writes), [{ location: { latitude: 0, longitude: 0 } }]);
});

test('clear is a draft until Save, and pending saves keep every input and map click unchanged', () => {
  const f = editorFixture();
  f.props.location = point; f.render();
  f.click('Изменить местоположение'); f.click('Очистить точку');
  assert.equal(f.mutation.writes.length, 0);
  f.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(plain(f.mutation.writes), [{ location: null }]);
  f.mutation.isPending = true; f.render();
  assert.equal(f.input('Широта объекта').props.disabled, true);
  assert.equal(f.map().props.locating, false);
  f.map().props.onPoint(point); f.render();
  assert.equal(f.input('Широта объекта').props.value, '');
});

test('an editor context closed by a passport tab change never becomes current again on return', () => {
  const f = editorFixture(); f.click('Указать местоположение');
  const original = f.options().isCurrentResult;
  assert.equal(original(), true);
  f.props.isActive = false; f.render();
  assert.equal(original(), false);
  f.props.isActive = true; f.render();
  assert.equal(original(), false);
  assert.equal(f.options().isCurrentResult(), true);
});

for (const reason of ['navigation', 'permission-loss', 'read-denial']) {
  test(`a late location response after ${reason} neither exposes coordinates nor resets the current editor`, async t => {
    const f = mutationFixture(t), body = { location: point };
    const result = await f.mutation.mutationFn(body);
    if (reason === 'navigation') f.denyContext();
    if (reason === 'permission-loss') f.client.setQueryData(['ops-me'], { permissions: [] });
    if (reason === 'read-denial') f.readAccess.blockReadAccess(f.client, ['ops-objects', 'one']);
    f.mutation.onSuccess(result, body);
    assert.equal(f.client.getQueryData(['ops-objects', 'one']).location, null);
    assert.equal(f.saved(), 0);
  });
}

test('registry marker selection opens its matching catalog passport with the complete filter return query', () => {
  const React = require('react'), navigations = [];
  const load = loader({
    react: { ...React, useMemo: fn => fn(), useState: value => [typeof value === 'function' ? value() : value, () => {}] },
    'next/navigation': { useRouter: () => ({ push: value => navigations.push(value) }) },
    'next/link': { default: 'a' },
    '../model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds, error: false, isLoading: false }) },
    './LocalObjectMap': { LocalObjectMap: 'local-map' },
    '@/components/ui/card': { Card: 'section', CardHeader: 'header', CardTitle: 'h2', CardContent: 'div' },
    '@/components/ui/button': { Button: 'button' },
  });
  const subject = load('@/features/object-map/ui/ObjectsMap').ObjectsMap;
  assert.equal(typeof subject, 'function', 'registry map must be implemented');
  const backSuffix = '?back=' + encodeURIComponent('view=map&tab=own&search=First&region=Астана');
  const tree = subject({ objects: [{ id: 'catalog-1', code: 'ONE', name: 'First', location: point }], backSuffix });
  function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]; }
  const map = nodes(tree).find(node => node.type === 'local-map');
  assert.ok(map);
  assert.equal(map.props.locating, false);
  map.props.onPoint({ latitude: 0, longitude: 0 });
  assert.deepEqual(navigations, []);
  map.props.onSelect(map.props.markers[0]);
  assert.deepEqual(navigations, ['/security-ops/objects/catalog-1' + backSuffix]);
});

test('published snapshots pass only their immutable point, including an explicit null historical notice', () => {
  const React = require('react');
  const load = loader({
    '@/features/object-map/ui/ObjectLocationMap': { ObjectLocationMap: 'snapshot-location' },
    '@/components/ui/card': { Card: 'section', CardContent: 'div' },
  });
  const subject = load('@/features/object-passport/ui/PassportVersionSnapshot').PassportVersionSnapshot;
  function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]; }
  for (const location of [point, null, undefined]) {
    const tree = subject({ version: { id: 'v1', note: '', sectors: [], location } });
    const map = nodes(tree).find(node => node.type === 'snapshot-location');
    assert.ok(map, 'history must show a version-specific location section');
    assert.equal(map.props.location, location ?? null);
    assert.match(map.props.emptyMessage, /В этой версии паспорта координаты не сохранены/);
  }
});

test('ordinary catalog fixtures and pre-existing passport versions keep their location explicitly null', () => {
  const entities = loader()('@/entities/security-object/model/freshness');
  const load = loader({ '@/entities/security-object': entities });
  const objects = load('@/mocks/ops/fixtures/objects').buildObjectsFixtures('2026-11-02T10:00:00Z', '2026-11-02');
  assert.ok(objects.length > 0);
  for (const object of objects) {
    assert.equal(object.location, null);
    for (const version of object.passportVersions) assert.equal(version.location, null);
  }
});

test('mock save, publication snapshot and later clear preserve independent saved and historical points', async () => {
  const entities = loader()('@/entities/security-object/model/types');
  const initial = { id: 'one', location: null, code: 'ONE', sectors: [{ id: 's1', name: 'Sector', posts: [{ id: 'p1', name: 'Post' }] }], passportVersions: [] };
  const routes = [], audit = [];
  const http = Object.fromEntries(['get', 'patch', 'post'].map(method => [method, (url, handler) => {
    const route = { method, url, handler }; routes.push(route); return route;
  }]));
  const load = loader({
    msw: { http, HttpResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200 }) } },
    '@/entities/security-object': entities,
    './security-events-handlers': { readEventsStore: () => [] },
    './fixtures/objects': { buildObjectsFixtures: () => [initial] },
    './settings-store': {}, './audit-store': { appendAudit: item => audit.push(item) },
  });
  load('@/mocks/ops/objects-handlers');
  const endpoint = routes.find(route => route.method === 'patch' && route.url.endsWith('/location/'));
  assert.ok(endpoint, 'mock must implement the location endpoint');
  const send = body => endpoint.handler({ params: { id: 'one' }, request: { json: async () => body } });
  for (const bad of [{}, { location: false }, { location: { latitude: true, longitude: 71.43 } }, { location: { latitude: 1 } }]) {
    assert.equal((await send(bad)).status, 400);
  }
  assert.equal(initial.location, null);
  const saved = await send({ location: point });
  assert.equal(saved.status, 200); assert.deepEqual(plain(saved.data.location), point);
  const publish = routes.find(route => route.method === 'post' && route.url.endsWith('/passport/versions/'));
  const published = await publish.handler({ params: { id: 'one' }, request: { json: async () => ({ effectiveFrom: '2026-11-02', note: '', location: { latitude: 0, longitude: 0 } }) } });
  assert.deepEqual(plain(published.data.passportVersions[0].location), point);
  const cleared = await send({ location: null });
  assert.equal(cleared.data.location, null);
  assert.deepEqual(plain(cleared.data.passportVersions[0].location), point);
});
