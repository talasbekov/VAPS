const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../features/forces-workspace/model/workspace.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, URLSearchParams });
const { resolveWorkspaceRole, resolveWorkspaceView, responsibleDepartmentScope, workspaceHref } = moduleExports;
const role = (code, scope_division_id = 2) => ({ code, scope_division_id });
const access = (roles, permissions) => ({ roles, permissions, isLoading: false, error: null, hasPermission: code => permissions.includes('*') || permissions.includes(code) });

test('legacy daily entry preserves dates while removing force targets from the destination', () => {
  assert.equal(typeof moduleExports.legacyDailyExpenseHref, 'function');
  for (const view of ['daily', 'department-summary']) {
    assert.equal(moduleExports.legacyDailyExpenseHref(new URLSearchParams(`view=${view}&businessDate=2026-10-27&dateFrom=2026-10-20&dateTo=2026-10-27&search=kept`)),
      '/daily-expense?businessDate=2026-10-27&dateFrom=2026-10-20&dateTo=2026-10-27&search=kept');
  }
});

test('force targets never become daily work merely because an older view parameter remains', () => {
  assert.equal(typeof moduleExports.legacyDailyExpenseHref, 'function');
  for (const query of ['', 'view=forces', 'view=daily&request=7', 'view=daily&collection=8', 'view=department-summary&campaign=4', 'view=daily&tab=collections', 'view=daily&tab=requests']) {
    assert.equal(moduleExports.legacyDailyExpenseHref(new URLSearchParams(query)), null, query);
  }
});

test('canonical expense role opens daily workflow with existing module permissions', () => {
  const result = resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER')], ['status.view', 'daily_report.generate', 'forces.allocate']));
  assert.equal(result, 'expense');
  for (const query of ['', 'view=daily', 'view=department-summary']) {
    assert.equal(resolveWorkspaceView(result, new URLSearchParams(query)), 'daily');
  }
  assert.equal(resolveWorkspaceView(result, new URLSearchParams('view=forces&request=123')), 'forces');
  assert.equal(resolveWorkspaceView(result, new URLSearchParams('view=forces')), 'forces');
  assert.equal(resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER')], ['status.view'])), 'denied');
});
test('expense role without status permission is denied and unresolved access never routes eagerly', () => {
  const state = access([role('DEPARTMENT_EXPENSE_OFFICER')], []);
  assert.equal(resolveWorkspaceRole(state), 'denied');
  assert.equal(resolveWorkspaceRole({ ...state, isLoading: true }), 'loading');
  assert.equal(resolveWorkspaceRole({ ...state, error: new Error('offline') }), 'denied');
});
test('force-only expense user keeps request access while explicit daily explains missing permission', () => {
  const result = resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER')], ['forces.allocate']));
  assert.equal(result, 'expense');
  assert.equal(resolveWorkspaceView(result, new URLSearchParams(), false), 'forces');
  assert.equal(resolveWorkspaceView(result, new URLSearchParams('request=123'), false), 'forces');
  assert.equal(resolveWorkspaceView(result, new URLSearchParams('view=daily'), false), 'daily');
});
test('existing headquarters and legacy responsible precedence survive combined expense assignments', () => {
  assert.equal(resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER'), role('OPS_STAFF')], ['forces.allocate', 'forces.command', 'status.view'])), 'headquarters');
  assert.equal(resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER'), role('OPS_STAFF')], ['forces.allocate'])), 'expense');
  assert.equal(resolveWorkspaceRole(access([role('DEPARTMENT_EXPENSE_OFFICER'), role('OPS_STAFF'), role('FORCES_GATHERING_OFFICER')], ['forces.allocate', 'forces.command'])), 'responsible');
});
test('an inactive workspace role cannot deny other explicitly granted forces actions', () => {
  for (const [roles, permissions] of [
    [[role('FORCES_GATHERING_OFFICER')], ['forces.command']],
    [[role('OPS_STAFF')], ['forces.allocate']],
    [[role('DEPARTMENT_EXPENSE_OFFICER')], ['forces.select']],
    [[role('FORCES_GATHERING_OFFICER'), role('OPS_STAFF')], ['forces.select']],
    [[role('CUSTOM_EXPLICIT_GRANT')], ['forces.allocate']],
  ]) {
    assert.equal(resolveWorkspaceRole(access(roles, permissions)), 'legacy');
  }
  assert.equal(resolveWorkspaceRole(access([role('FORCES_GATHERING_OFFICER'), role('OPS_STAFF')], ['forces.command'])), 'headquarters');
});
test('workspace choice neither invents a department scope nor treats a role as a grant', () => {
  for (const code of ['FORCES_GATHERING_OFFICER', 'OPS_STAFF', 'DEPARTMENT_EXPENSE_OFFICER']) {
    assert.equal(resolveWorkspaceRole(access([role(code)], [])), 'denied');
  }
  const custom = [role('CUSTOM_EXPLICIT_GRANT', 2)];
  assert.equal(resolveWorkspaceRole(access(custom, ['forces.allocate'])), 'legacy');
  assert.equal(responsibleDepartmentScope(custom), null);
});
test('all preset combinations preserve explicit forces access and still fail closed on permission errors', () => {
  const roleCodes = ['FORCES_GATHERING_OFFICER', 'OPS_STAFF', 'DEPARTMENT_EXPENSE_OFFICER'];
  const permissionCodes = ['forces.command', 'forces.allocate', 'forces.select'];
  for (let rolesMask = 0; rolesMask < 8; rolesMask++) {
    for (let permissionsMask = 1; permissionsMask < 8; permissionsMask++) {
      const state = access(roleCodes.filter((_, index) => rolesMask & (1 << index)).map(code => role(code)),
        permissionCodes.filter((_, index) => permissionsMask & (1 << index)));
      const view = resolveWorkspaceRole(state);
      assert.notEqual(view, 'denied');
      if (view === 'headquarters') assert.ok(state.hasPermission('forces.command'));
      if (view === 'responsible' || view === 'expense') assert.ok(state.hasPermission('forces.allocate'));
      assert.equal(resolveWorkspaceRole({ ...state, error: new Error('permission refresh failed') }), 'denied');
      assert.equal(resolveWorkspaceRole({ ...state, isLoading: true }), 'loading');
    }
  }
  assert.equal(resolveWorkspaceRole(access([role('OPS_STAFF')], ['*'])), 'headquarters');
});
test('legacy force role keeps its permission requirement, desk and request views', () => {
  assert.equal(resolveWorkspaceRole(access([role('FORCES_GATHERING_OFFICER')], ['status.view'])), 'denied');
  assert.equal(resolveWorkspaceRole(access([role('FORCES_GATHERING_OFFICER')], ['forces.allocate'])), 'responsible');
  assert.equal(resolveWorkspaceView('responsible', new URLSearchParams()), 'desk');
  assert.equal(resolveWorkspaceView('responsible', new URLSearchParams('request=123')), 'forces');
});
test('both department roles resolve their assigned scope, duplicate assignments do not widen it', () => {
  for (const code of ['DEPARTMENT_EXPENSE_OFFICER', 'FORCES_GATHERING_OFFICER']) {
    assert.equal(responsibleDepartmentScope([role(code)]), 2);
  }
  assert.equal(responsibleDepartmentScope([role('DEPARTMENT_EXPENSE_OFFICER'), role('FORCES_GATHERING_OFFICER')]), 2);
});
test('missing, conflicting and unrelated scopes never select a department', () => {
  for (const roles of [[], [role('OPS_STAFF')], [role('DEPARTMENT_EXPENSE_OFFICER', null)],
    [role('DEPARTMENT_EXPENSE_OFFICER', 2), role('FORCES_GATHERING_OFFICER', 3)],
    [role('DEPARTMENT_EXPENSE_OFFICER', 2), role('DEPARTMENT_EXPENSE_OFFICER', null)]]) {
    assert.equal(responsibleDepartmentScope(roles), null);
  }
});
test('daily navigation keeps report date, range and unrelated filters', () => {
  const next = new URL(workspaceHref(new URLSearchParams('view=department-summary&businessDate=2026-10-30&dateFrom=2026-10-30&dateTo=2026-11-01&search=kept'), 'daily'), 'http://localhost');
  assert.equal(next.searchParams.get('businessDate'), '2026-10-30');
  assert.equal(next.searchParams.get('dateFrom'), '2026-10-30');
  assert.equal(next.searchParams.get('dateTo'), '2026-11-01');
  assert.equal(next.searchParams.get('search'), 'kept');
});
