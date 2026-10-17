const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loader() {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../hooks/use-staff-units-page.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === '@tanstack/react-query') return { useQuery: value => value, keepPreviousData: value => value };
    if (name === '@/lib/api') return { apiClient: {}, ApiHttpError: class extends Error {} };
    throw Error('Unexpected import: ' + name);
  }, Map, Set, Error });
  assert.equal(typeof exports.loadStaffUnitsSelection, 'function', 'Selected employee metadata must be read completely in bounded requests');
  return exports.loadStaffUnitsSelection;
}
const row = id => ({ id, division: { id: 7 }, employee: { id } });
const result = (rows, hasNext = false) => ({ staff_units: rows, division: null, total_count: rows.length, has_next: hasNext });

test('selection metadata batches 250 unique employees within the server limit and retains every slot', async () => {
  const calls = [];
  const ids = Array.from({ length: 250 }, (_, index) => index + 1);
  const rows = await loader()([...ids, 1, 2], async params => {
    calls.push(params);
    assert.ok(params.employeeIds.length <= 200, 'The API rejects a larger ID filter');
    return result(params.employeeIds.map(row));
  });
  assert.deepEqual(Array.from(rows, value => value.id), ids);
  assert.equal(calls.length, 2);
});

test('selection metadata follows pages inside a batch when an employee occupies multiple slots', async () => {
  const pages = [];
  const rows = await loader()([1], async params => {
    pages.push(params.page);
    return result([{ ...row(100 + params.page), employee: { id: 1 } }], params.page === 1);
  });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(Array.from(rows, value => value.id), [101, 102]);
});

test('selection metadata rejects a failed later batch instead of returning partial permission evidence', async () => {
  let requests = 0;
  await assert.rejects(loader()(Array.from({ length: 201 }, (_, index) => index + 1), async params => {
    requests++;
    if (requests === 2) throw Error('Second batch failed');
    return result(params.employeeIds.map(row));
  }), /Second batch failed/);
  assert.equal(requests, 2);
});

test('a cancelled selection makes no request', async () => {
  const abort = new AbortController();
  abort.abort();
  let requests = 0;
  await assert.rejects(loader()([1], async () => { requests++; return result([row(1)]); }, abort.signal), { name: 'AbortError' });
  assert.equal(requests, 0);
});

test('cancelling after a response prevents further batches and rejects incomplete metadata', async () => {
  const abort = new AbortController();
  let requests = 0;
  await assert.rejects(loader()(Array.from({ length: 201 }, (_, index) => index + 1), async params => {
    requests++;
    abort.abort();
    return result(params.employeeIds.map(row));
  }, abort.signal), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('repeated selection pages fail without accepting an incomplete or unbounded result', async () => {
  let requests = 0;
  await assert.rejects(loader()([1], async () => { requests++; return result([row(1)], true); }), /страниц/);
  assert.equal(requests, 2);
});
