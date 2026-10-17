const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function model() {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../features/offline-map/model/geometry.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, Map, Set });
  assert.equal(typeof exports.buildMapSearchIndex, 'function');
  assert.equal(typeof exports.searchMapPlaces, 'function');
  return exports;
}

const line = (name, nodes, kind = 'road') => ({ kind, name, nodes, bounds: [0, 0, 30, 30] });
const origin = 256 * 2 ** 15;
const geometry = {
  coordinates: [0, 0, 10, 0, 20, 0, 30, 0, 5, 30, 10, 30].map(value => value + origin),
  features: [line('  Улица Ёлочная ', [0, 1]), line('улица ёлочная', [2, 3]), line('Северная улица', [4, 5]), line('Дом', [0, 1], 'building')],
  labels: [{ x: origin + 5, y: origin + 20, name: 'Район Есиль', kind: 'suburb' }],
};

test('local map search deduplicates road segments and matches case, spaces and ё', () => {
  const m = model();
  const index = m.buildMapSearchIndex(geometry);
  assert.equal(index.length, 3);
  assert.equal(m.searchMapPlaces(index, '  ЕЛОЧНАЯ  ')[0].name, 'Улица Ёлочная');
  assert.equal(m.searchMapPlaces(index, 'улица елочная').length, 1);
});

test('a street navigation point lies on the recorded road instead of a gap between disconnected segments', () => {
  const m = model();
  const street = m.searchMapPlaces(m.buildMapSearchIndex(geometry), 'ёлочная')[0];
  const [x, y] = m.project(street.location);
  assert.ok(Math.abs(y - origin) < 0.00001);
  assert.ok(Math.abs(x - origin - 10) < 0.00001 || Math.abs(x - origin - 20) < 0.00001);
});

test('district search uses the label coordinate and all query words', () => {
  const m = model();
  const index = m.buildMapSearchIndex(geometry);
  const place = m.searchMapPlaces(index, 'есиль район')[0];
  const [x, y] = m.project(place.location);
  assert.equal(place.kind, 'place');
  assert.ok(Math.abs(x - origin - 5) < 0.00001 && Math.abs(y - origin - 20) < 0.00001);
  assert.equal(m.searchMapPlaces(index, 'есиль северная').length, 0);
});

test('search omits unnamed and non-road features, bounds results and ignores short input', () => {
  const m = model();
  const index = m.buildMapSearchIndex({ ...geometry, features: [...geometry.features, line('', [0, 1]), ...Array.from({ length: 15 }, (_, i) => line(`Улица ${i}`, [0, 1]))] });
  assert.equal(m.searchMapPlaces(index, 'дом').length, 0);
  assert.equal(m.searchMapPlaces(index, 'у').length, 0);
  assert.equal(m.searchMapPlaces(index, 'улица').length, 8);
});
