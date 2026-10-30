const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const cache = new Map();
function load(name) {
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name);
  const p = path.join(__dirname, '../..', name.slice(2)) + '.ts';
  assert.ok(fs.existsSync(p), name);
  const exports = {}; cache.set(name, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: load, Intl, Date });
  return exports;
}
const model = () => load('@/features/ambient-background/model/scenes');
const event = (patch = {}) => ({ id: 'event-a', code: 'ОМ-а', stage: 'RECON', businessDate: '2026-10-28', businessDateEnd: '2026-10-30', visitObjects: [{ id: 'visit-a', objectId: 'object-a', objectName: 'Объект А', stage: 'RECON' }], ...patch });
const point = { latitude: 51.128, longitude: 71.43 };
const bounds = { west: 71.15, east: 71.7, south: 50.98, north: 51.35 };
test('background day uses organisation timezone across the UTC boundary', () => {
  assert.equal(model().backgroundDay(new Date('2026-10-28T18:59:59Z')), '2026-10-28');
  assert.equal(model().backgroundDay(new Date('2026-10-28T19:00:00Z')), '2026-10-29');
});
test('only nonclosed events in their actual date range are candidates; null end is same day', () => {
  assert.equal(model().eventIsCurrent(event(), '2026-10-29'), true);
  for (const patch of [{ stage: 'CLOSED' }, { businessDate: '2026-10-30' }, { businessDateEnd: '2026-10-28' }, { businessDateEnd: null }, { businessDate: '2026-02-30' }, { stage: 'UNKNOWN' }]) assert.equal(model().eventIsCurrent(event(patch), '2026-10-29'), false, JSON.stringify(patch));
  assert.equal(model().eventIsCurrent(event({ businessDate: '2026-10-29', businessDateEnd: null }), '2026-10-29'), true);
});
test('coordinates must be real finite numbers within the available map, not a guessed location', () => {
  assert.equal(model().pointInBounds(point, bounds), true);
  for (const p of [null, {}, { latitude: '51.128', longitude: 71.43 }, { latitude: true, longitude: 71.43 }, { latitude: 91, longitude: 71.43 }, { latitude: 51.128, longitude: Infinity }, { latitude: 43.2, longitude: 76.9 }]) assert.equal(model().pointInBounds(p, bounds), false);
});
test('all registry pages are read and active objects on later pages are retained', async () => {
  const calls = [];
  const scenes = await model().readBackgroundScenes(async url => {
    calls.push(url);
    if (url.includes('/placement/map/')) return { objects: { 'visit-a': point } };
    if (new URL(url, 'http://local').searchParams.get('page') === '1') return { results: [event({ id: 'old', businessDateEnd: '2026-10-28' })], next: '2' };
    return { results: [event()], next: null };
  }, '2026-10-29', new AbortController().signal);
  assert.equal(scenes.length, 1); assert.equal(scenes[0].kind, 'object');
  assert.equal(scenes[0].center.latitude, point.latitude);
  assert.equal(calls.filter(url => !url.includes('/placement/map/')).length, 2);
  assert.ok(calls.every(url => url.startsWith('/api/ops/security-events/')));
  assert.ok(calls[0].includes('to=2026-10-29')); assert.ok(!decodeURIComponent(calls[0]).includes('CLOSED'));
});
test('expired events do not trigger map requests and return no fake active scenes', async () => {
  let calls = 0;
  const scenes = await model().readBackgroundScenes(async () => { calls++; return { results: [event({ businessDateEnd: '2026-10-28' })], next: null }; }, '2026-10-29', new AbortController().signal);
  assert.equal(calls, 1); assert.equal(scenes.length, 0);
});
test('closed or missing visits and absent coordinates are omitted; duplicate page rows do not refetch a map', async () => {
  let maps = 0;
  const row = event({ visitObjects: [{ id: 'closed', objectId: 'x', objectName: 'Closed', stage: 'CLOSED' }, { id: 'missing', objectId: null, stage: 'RECON' }, { id: 'visit-a', objectId: 'a', objectName: 'A', stage: 'RECON' }, { id: 'unplaced', objectId: 'b', stage: 'RECON' }] });
  const scenes = await model().readBackgroundScenes(async url => url.includes('/placement/map/') ? (maps++, { objects: { 'visit-a': point, closed: point } }) : { results: [row, row], next: null }, '2026-10-29', new AbortController().signal);
  assert.equal(maps, 1); assert.equal(scenes.length, 1); assert.equal(scenes[0].key, 'event-a:visit-a');
});
test('failed registry or coordinate read rejects instead of presenting partial success', async () => {
  await assert.rejects(() => model().readBackgroundScenes(async () => { throw Error('503'); }, '2026-10-29', new AbortController().signal), /503/);
  await assert.rejects(() => model().readBackgroundScenes(async url => { if (url.includes('/placement/map/')) throw Error('403'); return { results: [event()], next: null }; }, '2026-10-29', new AbortController().signal), /403/);
});
test('bad pagination and malformed payload do not cause infinite or external reads', async () => {
  for (const next of ['1', 'https://elsewhere.invalid/api/', 'NaN', '-1']) await assert.rejects(() => model().readBackgroundScenes(async () => ({ results: [], next }), '2026-10-29', new AbortController().signal));
  await assert.rejects(() => model().readBackgroundScenes(async () => ({ results: null, next: null }), '2026-10-29', new AbortController().signal));
});
test('aborted reads stop before later registry pages or coordinate calls', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(() => model().readBackgroundScenes(async () => { calls++; controller.abort(); return { results: [event()], next: '2' }; }, '2026-10-29', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

function renderBackground({ canAct = true, section = 'events', data = [], assetAvailable = true } = {}) {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const asset = { manifest: { center: point, bounds }, geometry: { coordinates: [], features: [], labels: [] } };
  let enabled;
  const dependencies = {
    react: React,
    '@/components/navigation/section-navigation': { useSectionNavigation: () => ({ sectionId: section }) },
    '@/hooks/use-ops-protected-read': { useOpsReadAccess: () => ({ actor: 'test', scope: 'actor:test', allowed: true }), useOpsProtectedRead: (_prefix, _parts, _access, _read, options) => { enabled = options.enabled !== false; return { canAct, data }; } },
    '@/lib/ops-api': { opsApiClient: {} },
    '@/features/offline-map/model/asset': { peekAstanaMapAsset: () => assetAvailable ? asset : null },
    '../model/scenes': model(),
    './MapBackdrop': { default: ({ scene }) => React.createElement('canvas', { 'data-scene-rendered': scene.key }) },
    './AmbientBackground.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/ambient-background/ui/AmbientBackground.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name) });
  const html = renderToStaticMarkup(React.createElement(exports.AmbientBackground));
  assert.ok(html.includes('Фон раздела')); assert.ok(!html.includes('data-msg='));
  return { html, enabled };
}
const privateScenes = ['a', 'b', 'c'].map(key => ({ key: `private-${key}`, kind: 'object', label: `Private ${key}`, center: point }));
test('private scene rendering is gated by a current successful protected read, not retained payload', () => {
  const { html } = renderBackground({ canAct: false, data: privateScenes });
  assert.ok(!html.includes('private-'));
  assert.ok(html.includes('data-scene-rendered="astana"'));
});
test('rotation prepares at most two authorized canvas layers even for a larger playlist', () => {
  const { html } = renderBackground({ data: privateScenes });
  assert.equal((html.match(/data-scene-rendered=/g) || []).length, 2);
  assert.ok(html.includes('private-a')); assert.ok(html.includes('private-b')); assert.ok(!html.includes('private-c'));
});
test('all directions use the same authorized map playlist and public fallback when access is blocked', () => {
  for (const section of ['daily', 'duty', 'personal', 'events']) {
    const { html, enabled } = renderBackground({ section, data: privateScenes });
    assert.equal(enabled, true);
    assert.equal((html.match(/data-scene-rendered=/g) || []).length, 2);
    assert.ok(html.includes('private-a')); assert.ok(html.includes('private-b'));
    const blocked = renderBackground({ section, data: privateScenes, canAct: false }).html;
    assert.ok(blocked.includes('data-scene-rendered="astana"'));
    assert.ok(!blocked.includes('private-'));
  }
});
test('missing local asset cannot be presented as a ready object map', () => {
  const { html } = renderBackground({ data: privateScenes, assetAvailable: false });
  assert.ok(!html.includes('data-scene-rendered=')); assert.ok(!html.includes('Private ')); assert.ok(html.includes('Загрузка фона карты'));
});

test('a resumed fade advances the caption exactly on its own CSS completion, not a restarted timeout', () => {
  const React = require('react'), effects = [], updates = [], timers = []; let stateIndex = 0;
  const fakeReact = { ...React, useEffect: fn => effects.push(fn), useMemo: fn => fn(), useCallback: fn => fn,
    useState: init => { const i = stateIndex++; return [i === 4 || i === 6 ? true : typeof init === 'function' ? init() : init, value => updates.push({ i, value })]; } };
  const dependencies = {
    react: fakeReact,
    '@/components/navigation/section-navigation': { useSectionNavigation: () => ({ sectionId: 'events' }) },
    '@/hooks/use-ops-protected-read': { useOpsReadAccess: () => ({ scope: 'test' }), useOpsProtectedRead: () => ({ canAct: true, data: privateScenes }) },
    '@/lib/ops-api': { opsApiClient: {} },
    '@/features/offline-map/model/asset': { peekAstanaMapAsset: () => ({ manifest: { center: point, bounds } }) },
    '../model/scenes': model(), './MapBackdrop': { default: () => null },
    './AmbientBackground.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/ambient-background/ui/AmbientBackground.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name), setTimeout: (_, delay) => timers.push(delay), clearTimeout() {} });
  const tree = exports.AmbientBackground().props.children.type();
  // Last effect owns rotation; asset/visibility effects require a browser and are intentionally not run.
  effects.at(-1)(); assert.deepEqual(timers, []);
  let layer; function visit(node) { if (!node || typeof node !== 'object') return; if (node.props?.onAnimationEnd) layer = node; React.Children.forEach(node.props?.children, visit); } visit(tree);
  assert.ok(layer, 'incoming map must own the animation completion');
  const target = {}; layer.props.onAnimationEnd({ target: {}, currentTarget: target }); assert.equal(updates.length, 0, 'bubbled drift event ignored');
  layer.props.onAnimationEnd({ target, currentTarget: target });
  assert.equal(updates.find(u => u.i === 5).value(0), 1); assert.equal(updates.find(u => u.i === 6).value, false);
});
