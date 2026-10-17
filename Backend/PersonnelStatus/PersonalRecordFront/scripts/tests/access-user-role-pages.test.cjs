const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const endpoint = '/api/operations/user-roles/';

function load(relative, get) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  const stubs = {
    '@tanstack/react-query': { useQuery: options => options },
    '@/lib/ops-api': { opsApiClient: { get } },
    '@/hooks/use-ops-mutation': {},
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasGlobalPermission: () => true, isLoading: false }) },
  };
  vm.runInNewContext(compiled, { exports, URL, URLSearchParams, require: name => {
    if (stubs[name]) return stubs[name];
    if (name === '@/entities/access' || name === './index') return load('entities/access/index.ts', get);
    if (name === '@/entities/portal-access') return load('entities/portal-access/index.ts', get);
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', get);
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const role = (id, active) => ({ id, user_id: '42', is_active: active, role_code: 'READER', scope_division_id: id, scope_division_name: null });
const body = (results, next = null) => ({ count: 51, previous: null, next, results });

test('user assignment query includes active grants beyond the first page of inactive history', async () => {
  const calls = [];
  const get = async url => {
    calls.push(url);
    return calls.length === 1
      ? body(Array.from({ length: 50 }, (_, i) => role(i + 1, false)), 'http://backend.test:8100/api/operations/user-roles/?user_id=42&limit=50&offset=50')
      : body([role(51, true)]);
  };
  const query = load('hooks/use-access-permissions.ts', get).useAccessUserRoles(42);
  const result = await query.queryFn();
  assert.equal(result.results.length, 51);
  assert.equal(result.results.filter(row => row.is_active)[0].id, 51);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith(`${endpoint}?`));
  const nextQuery = new URL(calls[1], 'https://front.test').searchParams;
  assert.equal(nextQuery.get('user_id'), '42');
  assert.equal(nextQuery.get('offset'), '50');
  assert.equal(nextQuery.get('limit'), '50');
  assert.equal(result.next, null);
});

test('pagination refuses a changed account or endpoint instead of presenting unrelated grants', async () => {
  for (const next of [`${endpoint}?user_id=43&offset=50`, `${endpoint}?offset=50`, '/api/operations/accounts/?user_id=42', `${endpoint}?user_id=42&user_id=43`]) {
    let calls = 0;
    const query = load('hooks/use-access-permissions.ts', async () => { calls++; return body([role(1, false)], next); }).useAccessUserRoles(42);
    await assert.rejects(query.queryFn(), /страницы назначений/);
    assert.equal(calls, 1);
  }
});

test('loop and failed later page cannot return a misleading partial assignment list', async () => {
  const loop = load('hooks/use-access-permissions.ts', async () => body([role(1, false)], `${endpoint}?user_id=42`)).useAccessUserRoles(42);
  await assert.rejects(loop.queryFn(), /повторяет страницу/);
  let calls = 0;
  const failure = load('hooks/use-access-permissions.ts', async () => {
    if (++calls === 2) throw new Error('network failure');
    return body([role(1, false)], `${endpoint}?user_id=42&offset=50`);
  }).useAccessUserRoles(42);
  await assert.rejects(failure.queryFn(), /network failure/);
});

test('scope labels identify missing scoped names without claiming whole-service access', () => {
  const { accessScopeLabel } = load('entities/access/index.ts');
  assert.equal(typeof accessScopeLabel, 'function');
  assert.equal(accessScopeLabel({ scope_division_id: null, scope_division_name: null }), 'Вся служба');
  assert.equal(accessScopeLabel({ scope_division_id: 7, scope_division_name: 'Управление' }), 'Управление');
  assert.equal(accessScopeLabel({ scope_division_id: 7, scope_division_name: null }), 'Подразделение #7');
  assert.equal(accessScopeLabel({ scope_division_id: 7, scope_division_name: '   ' }), 'Подразделение #7');
});
