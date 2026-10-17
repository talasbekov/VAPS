const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function model() {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../features/offline-map/model/viewport.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  return exports;
}

test('zooming at the pointer keeps the same geographic point under it', () => {
  const { zoomMapAt } = model();
  const view = { center: [100000, 200000], zoom: 13 };
  const offset = [173, -89];
  const next = zoomMapAt(view, 1, offset);
  assert.equal(next.zoom, 14);
  for (let axis = 0; axis < 2; axis++) {
    assert.equal(next.center[axis] + offset[axis] / 2 ** (next.zoom - 16), view.center[axis] + offset[axis] / 2 ** (view.zoom - 16));
  }
  const back = zoomMapAt(next, -1, offset);
  assert.equal(back.zoom, view.zoom);
  assert.deepEqual(Array.from(back.center), view.center);
});

test('zoom limits do not drift the map, and buttons zoom around its center', () => {
  const { zoomMapAt } = model();
  for (const [zoom, delta] of [[11, -1], [18, 1]]) {
    const next = zoomMapAt({ center: [100, 200], zoom }, delta, [230, 120]);
    assert.equal(next.zoom, zoom);
    assert.deepEqual(Array.from(next.center), [100, 200]);
  }
  const next = zoomMapAt({ center: [100, 200], zoom: 14 }, 1);
  assert.deepEqual(Array.from(next.center), [100, 200]);
});
