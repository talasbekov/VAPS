const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const front = path.join(__dirname, '../..');
const bounds = { west: 71.15, south: 50.98, east: 71.7, north: 51.35 };
const point = { latitude: 51.128, longitude: 71.43 };
const plain = value => JSON.parse(JSON.stringify(value));
const all = node => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node ?? '';
function loader(overrides = {}) {
  const cache = new Map();
  return function load(id, from = front) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(front, id.slice(2)) : path.resolve(from, id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) return {};
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: child => load(child, path.dirname(file)), URLSearchParams });
    return exports;
  };
}
const ui = {
  '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
  '@/components/ui/card': { Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2' },
  '@/components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(n => [n, n])),
  '@/features/object-map/ui/LocalObjectMap': { LocalObjectMap: 'local-map' },
  './LocalObjectMap': { LocalObjectMap: 'local-map' },
  '@/features/object-map/model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds, isLoading: false, error: false }) },
  '../model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds, isLoading: false, error: false }) },
};
function fixture(module, name, props, extra = {}) {
  const state = [], effects = []; let cursor = 0, tree;
  const load = loader({ ...ui, react: { ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ?? (state[i] = { current: initial }); },
    useMemo(fn, deps) { const i = cursor++, old = state[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) state[i] = { value: fn(), deps }; return state[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = state[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      state[i] = { deps }; effects.push(() => { old?.cleanup?.(); state[i].cleanup = fn(); });
    } },
  }, ...extra });
  const Component = load(module)[name];
  assert.equal(typeof Component, 'function', `${name} must be available`);
  function render() { cursor = 0; tree = Component(props); for (const effect of effects.splice(0)) effect(); return tree; }
  const find = predicate => { const n = all(tree).find(predicate); assert.ok(n, 'expected control'); return n; };
  const button = label => find(n => n.type === 'button' && text(n) === label);
  const input = label => find(n => n.type === 'input' && n.props['aria-label'] === label);
  render();
  return { props, render, find, button, input, nodes: () => all(tree), text: () => text(tree),
    click(label) { button(label).props.onClick(); render(); },
    type(label, value) { input(label).props.onChange({ target: { value } }); render(); },
    map: () => find(n => n.type === 'local-map') };
}
function editor() {
  const changes = [], cancelled = [];
  const f = fixture('@/features/object-passport/ui/PostLocationEditor', 'PostLocationEditor', {
    post: { id: 'p1', name: 'Пост 1', location: point }, canEdit: true, isActive: true,
    onApply: value => changes.push(value), onCancel: () => cancelled.push(true),
  });
  return { ...f, changes, cancelled };
}

function passportMap(sectors = []) {
  const writes = [];
  const f = fixture('@/features/object-passport/ui/PassportForm', 'PassportForm', { objectId: 'o', canEdit: true, isActive: true, sectors }, {
    '@/hooks/use-object-passport': { useUpdatePassport: () => ({ mutate: body => writes.push(body), isPending: false, error: null }) },
    './PassportPostsMap': { PassportPostsMap: 'passport-map' },
    './PostLocationEditor': { PostLocationEditor: 'post-editor' },
  });
  return { ...f, writes, overview: () => f.find(n => n.type === 'passport-map') };
}

test('map placement adds a named post and a first sector locally, then Save Passport persists both', () => {
  const f = passportMap();
  f.overview().props.onAddPost(null, point); f.render();
  assert.equal(f.input('Название сектора').props.value, 'Основной сектор');
  assert.equal(f.input('Название поста').props.value, 'Пост 1');
  assert.deepEqual(f.writes, []);
  const sectorId = f.overview().props.sectors[0].id;
  f.overview().props.onAddPost(sectorId, { latitude: 51.14, longitude: 71.45 }); f.render();
  assert.deepEqual(f.nodes().filter(n => n.props['aria-label'] === 'Название поста').map(n => n.props.value), ['Пост 1', 'Пост 2']);
  f.button('Сохранить паспорт').props.onClick({ currentTarget: {} });
  assert.equal(f.writes[0].sectors[0].posts.length, 2);
  assert.deepEqual(plain(f.writes[0].sectors[0].posts.map(p => p.location)), [point, { latitude: 51.14, longitude: 71.45 }]);
});

test('map placement uses only the requested existing sector and avoids duplicate generated names', () => {
  const f = passportMap([{ id: 's', name: 'Север', posts: [{ id: 'p', name: 'Пост 2' }] }, { id: 't', name: 'Юг', posts: [] }]);
  f.overview().props.onAddPost('missing', point); f.render();
  f.overview().props.onAddPost(null, point); f.render();
  assert.equal(f.overview().props.sectors.flatMap(s => s.posts).length, 1);
  f.overview().props.onAddPost('t', point); f.render();
  assert.equal(f.overview().props.sectors[0].posts.length, 1);
  assert.equal(f.overview().props.sectors[1].posts[0].name, 'Пост 3');
});

for (const reason of ['readonly', 'inactive', 'stale']) test(`retained map-placement callback cannot write after ${reason}`, () => {
  const f = passportMap(); const add = f.overview().props.onAddPost;
  if (reason === 'readonly') f.props.canEdit = false;
  if (reason === 'inactive') f.props.isActive = false;
  if (reason === 'stale') f.props.isCurrentResult = () => false;
  f.render(); add(null, point); f.render();
  assert.equal(f.nodes().some(n => n.props['aria-label'] === 'Название поста'), false);
  assert.deepEqual(f.writes, []);
});

test('the editable overview requires a sector when several exist and rejects invalid/outside map clicks', () => {
  const added = [], selected = [];
  const f = fixture('@/features/object-passport/ui/PassportPostsMap', 'PassportPostsMap', {
    location: point, sectors: [{ id: 's', name: 'Север', posts: [{ id: 'p', name: 'Пост', location: point }] }, { id: 't', name: 'Юг', posts: [] }],
    canEdit: true, onAddPost: (...args) => added.push(args), onSelectPost: (...args) => selected.push(args),
  });
  assert.equal(f.map().props.locating, false);
  f.map().props.onPoint(point); assert.equal(added.length, 0);
  f.find(n => n.type === 'select').props.onChange({ target: { value: 't' } }); f.render();
  assert.equal(f.map().props.locating, true);
  f.map().props.onPoint({ latitude: 0, longitude: 0 });
  f.map().props.onPoint({ latitude: NaN, longitude: 71.4 }); assert.equal(added.length, 0);
  f.map().props.onPoint(point); assert.deepEqual(plain(added), [['t', point]]);
  f.map().props.onSelect(f.map().props.markers.find(m => m.id === 'p'));
  assert.deepEqual(selected, [['s', 'p']]);
  f.props.sectors = [f.props.sectors[0], { id: 'u', name: 'Восток', posts: [] }]; f.render();
  assert.equal(f.map().props.locating, false, 'deleted selected sector must not receive posts');
});

test('empty object map opens for editing and preserves coordinates across tab changes', () => {
  const writes = [];
  const f = fixture('@/features/object-map/ui/ObjectLocationEditor', 'ObjectLocationEditor', {
    objectId: 'o', label: 'Объект', location: null, canEdit: true, isActive: true,
    sectors: [{ id: 's', name: 'Сектор', posts: [{ id: 'p', name: 'Пост' }] }],
  }, { '@/hooks/use-security-objects': { useUpdateObjectLocation: () => ({ mutate: body => writes.push(body), reset() {}, isPending: false }) } });
  assert.equal(f.nodes().some(n => n.type === 'local-map'), false);
  f.click('Указать местоположение');
  assert.equal(f.map().props.locating, true);
  f.map().props.onPoint(point); f.render();
  f.props.isActive = false; f.render();
  f.props.isActive = true; f.render();
  assert.equal(f.input('Широта объекта').props.value, '51.128000');
  assert.equal(f.input('Долгота объекта').props.value, '71.430000');
  assert.deepEqual(writes, []);
  f.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(plain(writes), [{ location: point }]);
});

test('post overview stays compact without mapped coordinates and reveals saved post points', () => {
  const f = fixture('@/features/object-map/ui/ObjectLocationMap', 'ObjectLocationMap', {
    location: null, sectors: [{ id: 's', name: 'Сектор', posts: [{ id: 'p', name: 'Пост' }] }],
  });
  assert.equal(f.nodes().some(n => n.type === 'local-map'), false);
  f.props.sectors[0].posts[0].location = point; f.render();
  assert.deepEqual(plain(f.map().props.markers.map(m => m.location)), [point]);
  f.props.sectors[0].posts[0].location = { latitude: 0, longitude: 0 }; f.render();
  assert.equal(f.nodes().some(n => n.type === 'local-map'), false);
});

test('combat map stays compact without visible markers and retains group navigation', () => {
  const selected = [];
  const f = fixture('@/features/combat-duty/ui/CombatDutyMap', 'CombatDutyMap', { shifts: [], onSelect: id => selected.push(id) });
  assert.equal(f.nodes().length, 0, 'the board already provides the empty assignment state');
  f.props.shifts = [{ id: '1', groupName: 'Резерв', stateCode: 'SUBMITTED', location: { kind: 'RESERVE' } }]; f.render();
  assert.equal(f.nodes().some(n => n.type === 'local-map'), false);
  f.click('Резерв'); assert.deepEqual(selected, ['1']);
  f.props.shifts[0] = { ...f.props.shifts[0], location: { kind: 'POINT', ...point } }; f.render();
  assert.equal(f.map().props.markers.length, 1);
  f.props.shifts[0].stateCode = 'CANCELLED'; f.render();
  assert.equal(f.nodes().length, 0);
});
test('post map clicks and clear stay local until Apply; cancel never alters the passport', () => {
  const f = editor(); f.map().props.onPoint({ latitude: 51.14, longitude: 71.45 }); f.render();
  assert.equal(f.input('Широта поста').props.value, '51.140000'); assert.deepEqual(f.changes, []);
  f.click('Очистить точку поста'); assert.deepEqual(f.changes, []);
  f.click('Отмена'); assert.deepEqual(f.changes, []); assert.equal(f.cancelled.length, 1);
  const g = editor(); g.click('Очистить точку поста'); g.click('Применить к черновику');
  assert.deepEqual(g.changes, [null]);
  assert.ok(g.nodes().filter(n => n.type === 'button').every(n => n.props.type === 'button'));
  assert.equal(g.nodes().some(n => n.type === 'form'), false);
});
test('post manual inputs validate pairs, permit zero and preserve draft after refetch and outside clicks', () => {
  const f = editor(); f.type('Широта поста', ''); assert.equal(f.button('Применить к черновику').props.disabled, true);
  f.type('Широта поста', '0'); f.type('Долгота поста', '0');
  f.props.post = { ...f.props.post, location: { latitude: 51.2, longitude: 71.5 } }; f.render();
  f.map().props.onPoint({ latitude: 80, longitude: 0 }); f.render();
  assert.equal(f.input('Широта поста').props.value, '0'); f.click('Применить к черновику');
  assert.deepEqual(plain(f.changes), [{ latitude: 0, longitude: 0 }]);
});
for (const reason of ['readonly', 'inactive', 'stale']) test(`post editor rejects current and retained callbacks after ${reason}`, () => {
  const f = editor(); const choose = f.map().props.onPoint, apply = f.button('Применить к черновику').props.onClick;
  if (reason === 'readonly') f.props.canEdit = false;
  if (reason === 'inactive') f.props.isActive = false;
  if (reason === 'stale') f.props.isCurrentResult = () => false;
  f.render(); choose({ latitude: 51.2, longitude: 71.5 }); apply(); f.map().props.onPoint({ latitude: 51.2, longitude: 71.5 });
  f.render(); assert.equal(f.input('Широта поста').props.value, '51.128'); assert.deepEqual(f.changes, []);
  if (reason !== 'stale') { f.props.canEdit = true; f.props.isActive = true; f.render(); choose({ latitude: 51.2, longitude: 71.5 }); f.render(); assert.equal(f.input('Широта поста').props.value, '51.128'); }
});
test('passport applies a post point to its existing unsaved draft and persists only with Save Passport', () => {
  const writes = [];
  const f = fixture('@/features/object-passport/ui/PassportForm', 'PassportForm', { objectId: 'o', canEdit: true,
    sectors: [{ id: 's', name: 'Сектор', posts: [{ id: 'p', name: 'Пост', task: '', requirements: '' }] }] }, {
    '@/hooks/use-object-passport': { useUpdatePassport: () => ({ mutate: body => writes.push(body), isPending: false, error: null }) },
    './PostLocationEditor': { PostLocationEditor: 'post-editor' },
  });
  f.type('Название поста', 'Мой черновик'); f.click('Местоположение поста');
  f.find(n => n.type === 'post-editor').props.onApply(point); f.render(); assert.deepEqual(writes, []);
  f.button('Сохранить паспорт').props.onClick({ currentTarget: {} });
  assert.equal(writes[0].sectors[0].posts[0].name, 'Мой черновик');
  assert.deepEqual(plain(writes[0].sectors[0].posts[0].location), point);
});
test('unapplied post edits keep selection and prevent Save Passport; stale apply cannot modify the draft', () => {
  const writes = [];
  const f = fixture('@/features/object-passport/ui/PassportForm', 'PassportForm', { objectId: 'o', canEdit: true, isActive: true,
    sectors: [{ id: 's', name: 'Сектор', posts: ['p', 'q'].map(id => ({ id, name: id, task: '', requirements: '' })) }] }, {
    '@/hooks/use-object-passport': { useUpdatePassport: () => ({ mutate: body => writes.push(body), isPending: false, error: null }) },
    './PostLocationEditor': { PostLocationEditor: 'post-editor' },
  });
  f.type('Название сектора', 'Мой сектор');
  f.find(n => n.props['aria-label'] === 'Местоположение поста: p').props.onClick(); f.render();
  const apply = f.find(n => n.type === 'post-editor').props.onApply;
  assert.equal(f.button('Сохранить паспорт').props.disabled, true);
  const other = f.find(n => n.props['aria-label'] === 'Местоположение поста: q');
  assert.equal(other.props.disabled, true); other.props.onClick(); f.render();
  assert.equal(f.find(n => n.type === 'post-editor').props.post.id, 'p');
  f.props.isActive = false; f.render(); apply(point); f.render();
  f.props.isActive = true; f.render(); apply(point); f.render();
  assert.equal(f.find(n => n.type === 'post-editor').props.post.location, undefined);
  f.find(n => n.type === 'post-editor').props.onCancel(); f.render();
  f.button('Сохранить паспорт').props.onClick({ currentTarget: {} });
  assert.equal(writes[0].sectors[0].name, 'Мой сектор');
  assert.equal(writes[0].sectors[0].posts[0].location, undefined);
});
test('snapshot maps render only historic post positions and explicitly identify missing or outside points', () => {
  const sectors = [{ id: 's', name: 'Сектор', posts: [{ id: 'p1', name: 'На карте', location: point }, { id: 'p2', name: 'Старый пост' }, { id: 'p3', name: 'Далеко', location: { latitude: 0, longitude: 0 } }] }];
  const f = fixture('@/features/object-map/ui/ObjectLocationMap', 'ObjectLocationMap', { location: null, sectors });
  assert.deepEqual(plain(f.map().props.markers), [{ id: 'p1', kind: 'post', label: 'Сектор · На карте', location: point }]);
  const summaryNode = f.find(n => typeof n.type === 'function' && n.type.name === 'PostLocationSummary');
  const summary = text(summaryNode.type(summaryNode.props));
  assert.match(summary, /Старый пост.*не указаны/); assert.match(summary, /Далеко.*вне покрытия/);
  const subject = loader({ ...ui, '@/features/object-map/ui/ObjectLocationMap': { ObjectLocationMap: 'snapshot-map' } })('@/features/object-passport/ui/PassportVersionSnapshot').PassportVersionSnapshot;
  const tree = subject({ version: { id: 'v', versionNumber: 1, note: '', sectors } });
  const map = all(tree).find(n => n.type === 'snapshot-map');
  assert.equal(map.props.location, null); assert.equal(map.props.sectors, sectors);
});
for (const remove of ['post', 'sector']) test(`deleting the selected ${remove} leaves remaining post locations editable`, () => {
  const f = fixture('@/features/object-passport/ui/PassportForm', 'PassportForm', { objectId: 'o', canEdit: true,
    sectors: ['s', 't'].map(id => ({ id, name: id, posts: [{ id, name: id, task: '', requirements: '' }] })) }, {
    '@/hooks/use-object-passport': { useUpdatePassport: () => ({ mutate() {}, isPending: false, error: null }) },
    './PostLocationEditor': { PostLocationEditor: 'post-editor' },
  });
  f.find(n => n.props['aria-label'] === 'Местоположение поста: s').props.onClick(); f.render();
  if (remove === 'post') f.find(n => n.props['aria-label'] === 'Удалить пост').props.onClick();
  else f.button('Удалить сектор').props.onClick();
  f.render();
  f.find(n => n.props['aria-label'] === 'Местоположение поста: t').props.onClick(); f.render();
  assert.equal(f.find(n => n.type === 'post-editor').props.post.id, 't');
});
test('combat overview renders snapshot coordinates only, excludes cancelled shifts and opens their matching rows', () => {
  const selected = [];
  const shifts = [
    { id: '1', groupName: 'Один', stateCode: 'ACCEPTED', location: { kind: 'POST', objectId: 'o', postId: 'p', ...point } },
    { id: '2', groupName: 'Старый', stateCode: 'SUBMITTED', location: { kind: 'OBJECT', objectId: 'o' } },
    { id: '3', groupName: 'Отменён', stateCode: 'CANCELLED', location: { kind: 'POINT', ...point } },
    { id: '4', groupName: 'Далеко', stateCode: 'SUBMITTED', location: { kind: 'POINT', latitude: 0, longitude: 0 } },
    { id: '5', groupName: 'Резерв', stateCode: 'SUBMITTED', location: { kind: 'RESERVE', ...point } },
  ];
  const f = fixture('@/features/combat-duty/ui/CombatDutyMap', 'CombatDutyMap', { shifts, onSelect: id => selected.push(id) });
  assert.deepEqual(plain(f.map().props.markers.map(m => [m.id, m.location])), [['1', point]]);
  f.map().props.onSelect(f.map().props.markers[0]); assert.deepEqual(selected, ['1']);
  assert.match(f.text(), /Старый/); assert.match(f.text(), /Далеко/);
  assert.equal(f.nodes().some(n => n.type === 'button' && text(n) === 'Отменён'), false);
});
test('combat stored coordinates remain readable if the offline map cannot load', () => {
  const f = fixture('@/features/combat-duty/ui/CombatDutyMap', 'CombatDutyMap', {
    shifts: [{ id: '1', groupName: 'Группа', stateCode: 'SUBMITTED', location: { kind: 'POST', ...point } }], onSelect() {},
  }, { '@/features/object-map/model/use-object-map-asset': { useObjectMapAsset: () => ({ bounds: null, isLoading: false, error: true }) } });
  assert.match(f.text(), /51.128/); assert.match(f.text(), /71.43/);
  assert.equal(f.map().props.asset.error, true, 'map retry remains available for saved coordinates');
});
test('OBJECT and POST wizard previews resolve scoped choices, never forged input or parent object fallback', () => {
  const choices = { places: [{ id: 'place', divisionId: 'd', objectId: 'o', name: 'Объект', location: point,
    posts: [{ id: 'p', name: 'Пост', location: { latitude: 51.15, longitude: 71.5 } }, { id: 'old', name: 'Без точки' }] }], routes: [] };
  const overrides = { ...ui, 'next/dynamic': { default: () => 'point-map' }, '@/features/object-map/ui/ObjectLocationMap': { ObjectLocationMap: 'preview-map' } };
  const subject = loader(overrides)('@/features/combat-duty/ui/CombatLocationFields').CombatLocationFields;
  const preview = (value, divisionId = 'd') => all(subject({ value, choices, divisionId, multiple: false, onChange() {} })).find(n => n.type === 'preview-map');
  assert.deepEqual(plain(preview({ kind: 'OBJECT', objectId: 'o', latitude: 0, longitude: 0 }).props.location), point);
  assert.deepEqual(plain(preview({ kind: 'POST', objectId: 'o', postId: 'p' }).props.location), { latitude: 51.15, longitude: 71.5 });
  assert.equal(preview({ kind: 'POST', objectId: 'o', postId: 'old' }).props.location, null);
  assert.equal(preview({ kind: 'OBJECT', objectId: 'o' }, 'foreign').props.location, null);
  assert.equal(preview({ kind: 'ROUTE' }), undefined);
  assert.ok(all(subject({ value: { kind: 'POINT' }, choices, divisionId: 'd', multiple: false, onChange() {} })).some(n => n.type === 'point-map'));
});
