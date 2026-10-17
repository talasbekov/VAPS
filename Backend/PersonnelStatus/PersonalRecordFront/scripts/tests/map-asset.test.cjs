const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const manifest = { center: { latitude: 51.128, longitude: 71.43 }, bounds: { west: 71, south: 51, east: 72, north: 52 }, sourceDate: null, attribution: 'OSM' };
const geometry = { coordinates: [1, 2], features: [], labels: [] };
function model(fetch) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../features/offline-map/model/asset.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, fetch });
  return exports;
}
const response = value => ({ ok: true, json: async () => value });

test('concurrent map consumers share one public request pair and the same parsed result', async () => {
  const requests = [], parses = [];
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const m = model(async url => { requests.push(url); await waiting; return { ok: true, json: async () => { parses.push(url); return url.includes('manifest') ? manifest : geometry; } }; });
  assert.equal(m.peekAstanaMapAsset(), null);
  const first = m.loadAstanaMapAsset(), second = m.loadAstanaMapAsset();
  assert.equal(requests.length, 2);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.geometry, geometry);
  assert.equal(m.peekAstanaMapAsset(), a);
  assert.equal(await m.loadAstanaMapAsset(), a);
  assert.equal(requests.length, 2);
  assert.equal(parses.length, 2);
});

for (const failure of ['network', 'json', 'shape']) {
  test(`${failure} failure does not keep a rejected or malformed city asset; retry loads fresh files`, async () => {
    let broken = true;
    const requests = [];
    const m = model(async url => {
      requests.push(url);
      if (url.includes('geometry') && broken) {
        if (failure === 'network') return { ok: false };
        if (failure === 'shape') return response({});
        return { ok: true, json: async () => { throw new Error('Invalid JSON'); } };
      }
      return response(url.includes('manifest') ? manifest : geometry);
    });
    await assert.rejects(m.loadAstanaMapAsset());
    assert.equal(m.peekAstanaMapAsset(), null);
    broken = false;
    const loaded = await m.loadAstanaMapAsset();
    assert.equal(loaded.geometry, geometry);
    assert.equal(requests.length, 4);
    assert.equal(requests.filter(url => url.includes('manifest')).length, 2);
    assert.equal(await m.loadAstanaMapAsset(), loaded);
    assert.equal(requests.length, 4);
  });
}
