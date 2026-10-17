const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../hooks/use-ops-permissions.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function readPermissions({ status = 'authenticated', session = {}, isError = false, error = null,
  data = { permissions: ['status.manage'], global_permissions: ['admin.roles'], roles: [{ code: 'HEAD', scope_division_id: 3 }] },
  blocked = false, suspension = null, empty = false } = {}) {
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported, require(name) {
    if (name === 'react') return { useMemo: fn => fn(), useCallback: fn => fn, useContext: () => suspension };
    if (name === 'next-auth/react') return { useSession: () => ({ status, data: session }) };
    if (name === '@tanstack/react-query') return { useQueryClient: () => ({}), useQuery: () => ({
      data: empty ? undefined : data, isError, isLoading: false, error: error ?? (isError ? { kind: 'network' } : null),
    }) };
    if (name === '@/lib/query-read-access') return { isReadAccessBlocked: () => blocked };
    if (name === '@/lib/ops-permission-suspension') return { OpsPermissionSuspensionContext: {} };
    if (name === '@/lib/ops-api') return { opsApiClient: {} };
    throw Error(name);
  } });
  return exported.useOpsPermissions();
}
test('successful authenticated permissions retain action rights, roles and global distinction', () => {
  const result = readPermissions();
  assert.equal(result.hasPermission('status.manage'), true);
  assert.equal(result.hasPermission('admin.roles'), false);
  assert.equal(result.hasGlobalPermission('admin.roles'), true);
  assert.equal(result.roles.length, 1);
});
for (const [name, state] of [
  ['failed permissions refresh', { isError: true }],
  ['signed out session with cached data', { status: 'unauthenticated', session: null }],
  ['session loading with cached data', { status: 'loading' }],
  ['expired token with cached data', { session: { error: 'RefreshAccessTokenError' } }],
]) test(name + ' cannot supply cached authority', () => {
  const result = readPermissions(state);
  assert.equal(result.hasPermission('status.manage'), false);
  assert.equal(result.hasGlobalPermission('admin.roles'), false);
  assert.equal(result.permissions, undefined);
  assert.equal(result.globalPermissions, undefined);
  assert.equal(result.roles.length, 0);
});

for (const kind of ['server', 'network']) {
  test(`a known ${kind} permission outage can preserve mounted content without supplying authority`, () => {
    const result = readPermissions({ isError: true, error: { kind } });
    assert.equal(result.canSuspendOnFailure, true);
    assert.equal(result.hasPermission('status.manage'), false);
    assert.equal(result.hasGlobalPermission('admin.roles'), false);
  });
  test(`the protected boundary suspends consumers on a ${kind} outage before they replace nested editors`, () => {
    const suspension = new Promise(() => {});
    assert.throws(() => readPermissions({ isError: true, error: { kind }, suspension }), value => value === suspension);
  });
}

for (const [name, state] of [
  ['first load', { empty: true }],
  ['an earlier explicit denial', { blocked: true }],
  ['sign-out', { status: 'unauthenticated', session: null }],
  ['session expiry', { session: { error: 'RefreshAccessTokenError' } }],
]) test(`a transient error after ${name} cannot preserve previously protected content`, () => {
  const result = readPermissions({ isError: true, error: { kind: 'server' }, ...state });
  assert.equal(result.canSuspendOnFailure, false);
});

for (const status of [401, 403, 404]) test(`${status} is an explicit permission denial and cannot suspend access removal`, () => {
  const result = readPermissions({ isError: true, error: { kind: 'api', status }, suspension: new Promise(() => {}) });
  assert.equal(result.canSuspendOnFailure, false);
  assert.equal(result.hasPermission('status.manage'), false);
});
