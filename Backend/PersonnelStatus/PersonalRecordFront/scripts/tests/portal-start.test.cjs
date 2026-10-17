const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../entities/portal-access/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported });
const { defaultPortalRoute, moduleOpenFor } = exported;
const granted = (...codes) => (code) => codes.includes('*') || codes.includes(code);

test('head starts with personnel statuses even when object and event registers are available', () => {
  assert.equal(defaultPortalRoute(granted('status.view', 'status.workspace', 'object.view', 'event.view')), '/statuses');
});
test('status manager starts in statuses even with employee-selection permission', () => {
  assert.equal(defaultPortalRoute(granted('status.view', 'status.workspace', 'status.manage', 'forces.select', 'object.view', 'event.view')), '/statuses');
  assert.equal(defaultPortalRoute(granted('status.manage', 'forces.select')), '/employees', 'status.manage must not imply status.view');
  for (const permission of ['forces.allocate', 'forces.command']) {
    assert.equal(defaultPortalRoute(granted('status.view', 'status.manage', 'forces.select', permission)), '/employees');
  }
  assert.equal(defaultPortalRoute(granted('status.view', 'service_summary.view', 'status.manage', 'forces.select'), granted('DUTY_OFFICER')), '/security-ops/service-summary');
  assert.equal(defaultPortalRoute(granted('*'), granted('DUTY_OFFICER')), '/dashboard');
});
test('expense officer keeps forces workspace as start; removing forces falls back to statuses', () => {
  for (const forcePermission of ['forces.command', 'forces.allocate', 'forces.select']) {
    assert.equal(defaultPortalRoute(granted(forcePermission, 'status.view')), '/employees');
  }
  assert.equal(defaultPortalRoute(granted('status.view', 'status.workspace')), '/statuses');
});
test('duty officer starts in service summary through workspace permission', () => {
  assert.equal(defaultPortalRoute(granted('status.view', 'service_summary.view', 'duty.view'), granted('DUTY_OFFICER')), '/security-ops/service-summary');
  assert.equal(defaultPortalRoute(granted('status.view', 'duty.view')), '/security-ops/duty-register');
  assert.equal(defaultPortalRoute(granted('status.view', 'status.workspace', 'duty.view')), '/statuses');
});
test('retained duty role does not expose the summary after status-read permission is revoked', () => {
  const dutyRole = granted('DUTY_OFFICER');
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted(), dutyRole), false);
  assert.equal(defaultPortalRoute(granted('object.view'), dutyRole), '/security-ops/objects');
  assert.equal(defaultPortalRoute(granted('forces.allocate'), dutyRole), '/employees');
  assert.equal(defaultPortalRoute(granted(), dutyRole), '/security-ops/profile');
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted('status.view', 'service_summary.view'), dutyRole), true);
});
test('summary requires both permissions, while wildcard remains supported', () => {
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted('status.view')), false);
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted('*')), true);
  assert.equal(moduleOpenFor('/employees', granted('forces.select')), true);
});
test('single-purpose users reach an allowed work screen instead of profile', () => {
  for (const [permission, route] of [
    ['daily_report.generate', '/reports'], ['duty.view', '/security-ops/duty-register'],
    ['report.generate', '/security-ops/service-reports'], ['analytics.view', '/security-ops/analytics'],
    ['catalog.view', '/security-ops/persons'], ['object.view', '/security-ops/objects'],
  ]) {
    assert.equal(defaultPortalRoute(granted(permission)), route);
    assert.equal(moduleOpenFor(route, granted(permission), () => false), true);
  }
});

test('duty management can start in its journal while a general analyst keeps analytics', () => {
  assert.equal(defaultPortalRoute(granted('duty.manage')), '/security-ops/duty-register');
  assert.equal(defaultPortalRoute(granted('status.manage')), '/security-ops/duty-register');
  assert.equal(defaultPortalRoute(granted('analytics.view')), '/security-ops/analytics');
  assert.equal(moduleOpenFor('/security-ops/duty-register', granted('analytics.view')), true);
});
test('admin keeps overview; no permissions and unrecognised roles fall back to profile', () => {
  assert.equal(defaultPortalRoute(granted('*')), '/dashboard');
  assert.equal(defaultPortalRoute(granted(), granted('DIRECTORATE_HEAD')), '/security-ops/profile');
});
test('every combination routes only to a module open under the same permissions and role gate', () => {
  const codes = ['service_summary.view', 'status.view', 'status.workspace', 'status.manage', 'forces.select', 'forces.allocate', 'forces.command', 'duty.view', 'object.view', 'event.view', 'daily_report.generate', 'analytics.view'];
  for (let mask = 0; mask < 2 ** codes.length; mask++) {
    const permission = granted(...codes.filter((_, index) => mask & (1 << index)));
    for (const roles of [granted(), granted('DUTY_OFFICER')]) {
      const route = defaultPortalRoute(permission, roles);
      assert.equal(moduleOpenFor(route, permission, roles), true, `${mask}: ${route}`);
    }
  }
});

test('custom workspace rights open summary while duty role cannot replace a missing right', () => {
  assert.equal(defaultPortalRoute(granted('status.view', 'service_summary.view'), granted('CUSTOM_READER')), '/security-ops/service-summary');
  assert.equal(defaultPortalRoute(granted('status.view'), granted('DUTY_OFFICER')), '/security-ops/profile');
  assert.equal(defaultPortalRoute(granted('status.view', 'status.workspace'), granted('DUTY_OFFICER')), '/statuses');
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted('status.view'), granted('DUTY_OFFICER')), false);
  assert.equal(moduleOpenFor('/security-ops/service-summary', granted('service_summary.view'), granted('DUTY_OFFICER')), false);
});
