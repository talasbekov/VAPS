const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

function model() {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../lib/query-read-access.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports });
  return exports;
}
function setup(t) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  const m = model(), key = ['private-catalog'];
  client.setQueryData(key, { rows: ['previous'] });
  const read = fn => client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => m.readWithAccessCheck(client, key, signal, fn) });
  return { client, m, key, read };
}
const failure = status => Object.assign(new Error('read failed'), { status });
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const status of [401, 403, 404]) {
  test(`${status} hides cached data through transient retry; actual success restores access`, async t => {
    const { client, m, key, read } = setup(t);
    await assert.rejects(read(async () => { throw failure(status); }));
    assert.equal(m.isReadAccessBlocked(client, key), true);
    assert.deepEqual(client.getQueryData(key), { rows: ['previous'] });
    await assert.rejects(read(async () => { throw failure(503); }));
    assert.equal(m.isReadAccessBlocked(client, key), true);
    await read(async () => ({ rows: ['fresh'] }));
    assert.equal(m.isReadAccessBlocked(client, key), false);
    assert.deepEqual(client.getQueryData(key), { rows: ['fresh'] });
  });
}

test('transient failure alone keeps cached read available and never marks unrelated keys', async t => {
  const { client, m, key, read } = setup(t);
  await assert.rejects(read(async () => { throw failure(503); }));
  assert.equal(m.isReadAccessBlocked(client, key), false);
  await assert.rejects(read(async () => { throw failure(403); }));
  client.setQueryData(['other-catalog'], { rows: ['other'] });
  assert.equal(m.isReadAccessBlocked(client, ['other-catalog']), false);
  assert.equal(m.isReadAccessBlocked(client, [...key]), true);
});

test('cancelled late success cannot clear a newer denial on the same Query', async t => {
  const { client, m, key, read } = setup(t);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const old = read(async () => { await held; return { rows: ['late'] }; }).catch(() => {});
  await client.cancelQueries({ queryKey: key, exact: true });
  await assert.rejects(read(async () => { throw failure(403); }));
  assert.equal(m.isReadAccessBlocked(client, key), true);
  release(); await old; await tick();
  assert.equal(m.isReadAccessBlocked(client, key), true);
  assert.deepEqual(client.getQueryData(key), { rows: ['previous'] });
});

test('cancelled late denial cannot block a newer successful read', async t => {
  const { client, m, key, read } = setup(t);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const old = read(async () => { await held; throw failure(403); }).catch(() => {});
  await client.cancelQueries({ queryKey: key, exact: true });
  await read(async () => ({ rows: ['fresh'] }));
  release(); await old; await tick();
  assert.equal(m.isReadAccessBlocked(client, key), false);
  assert.deepEqual(client.getQueryData(key), { rows: ['fresh'] });
});

test('removing and recreating a key isolates the new Query from an old completion', async t => {
  const { client, m, key, read } = setup(t);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const old = read(async () => { await held; return { rows: ['late'] }; }).catch(() => {});
  client.removeQueries({ queryKey: key, exact: true });
  await assert.rejects(read(async () => { throw failure(403); }));
  release(); await old; await tick();
  assert.equal(m.isReadAccessBlocked(client, key), true);
  assert.equal(client.getQueryData(key), undefined);
  client.removeQueries({ queryKey: key, exact: true });
  client.setQueryData(key, { rows: ['replacement'] });
  assert.equal(m.isReadAccessBlocked(client, key), false);
});
