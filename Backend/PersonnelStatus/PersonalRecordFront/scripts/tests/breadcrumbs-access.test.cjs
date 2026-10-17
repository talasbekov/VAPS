const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { exports, URLSearchParams, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const portal = load('entities/portal-access/index.ts');
const workspace = load('features/forces-workspace/model/workspace.ts');
function render({ pathname = '/employees/', query = '', permissions = [], permissionsAvailable = true, roles = [], ...state } = {}) {
  const access = { permissions: permissionsAvailable ? new Set(permissions) : undefined, roles: roles.map(code => ({ code })), hasPermission: code => permissions.includes('*') || permissions.includes(code), isLoading: false, error: null, ...state };
  const { Breadcrumbs } = load('components/navigation/breadcrumbs.tsx', {
    'next/link': { default: 'Link' }, 'lucide-react': { ChevronRight: 'ChevronRight' },
    'next/navigation': { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/entities/portal-access': portal,
    '@/features/forces-workspace/model/workspace': workspace,
  });
  const wrapper = Breadcrumbs();
  assert.equal(wrapper.type, require('react').Suspense, 'search parameters have a local Suspense boundary');
  const tree = wrapper.props.children.type();
  const nodes = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    nodes.push(value); visit(value.props?.children);
  }
  visit(tree);
  return nodes;
}
const brand = nodes => nodes.find(node => node.type === 'Link' && node.props.children === 'Smart Жоспарлау');
const current = nodes => nodes.find(node => node.props?.['aria-current'] === 'page')?.props.children;

test('brand takes head, duty and admin to their permitted starting screens', () => {
  assert.equal(brand(render({ pathname: '/statuses/', permissions: ['status.view', 'status.workspace', 'status.manage'] })).props.href, '/statuses');
  assert.equal(brand(render({ permissions: ['status.view', 'service_summary.view'], roles: ['DUTY_OFFICER'] })).props.href, '/security-ops/service-summary');
  assert.equal(brand(render({ permissions: ['*'] })).props.href, '/dashboard');
});
test('pending, failed and unavailable authority never offers a cached brand destination', () => {
  for (const state of [{ isLoading: true }, { error: Error('offline') }, { permissionsAvailable: false }]) {
    assert.equal(brand(render({ permissions: ['*'], ...state })), undefined);
  }
});
test('expense current label follows daily default, summary alias and explicit forces request', () => {
  const props = { roles: ['DEPARTMENT_EXPENSE_OFFICER'], permissions: ['status.view', 'forces.allocate'] };
  assert.equal(current(render(props)), 'Ежедневный расход');
  assert.equal(current(render({ ...props, query: 'view=department-summary&businessDate=2026-10-20' })), 'Ежедневный расход');
  assert.equal(current(render({ ...props, query: 'view=daily&request=123' })), 'Сбор сил на ОМ');
  assert.equal(current(render({ roles: props.roles, permissions: ['forces.allocate'] })), 'Сбор сил на ОМ');
});
test('legacy, headquarters and responsible titles match their existing page variants', () => {
  assert.equal(current(render({ permissions: ['*'], query: 'view=daily' })), 'Ежедневный расход организации');
  assert.equal(current(render({ permissions: ['*'], query: '' })), 'Ежедневный расход организации');
  assert.equal(current(render({ permissions: ['*'], query: 'view=forces' })), 'Сбор сил на ОМ');
  assert.equal(current(render({ permissions: ['*'], query: 'view=department-summary' })), 'Свод департамента');
  assert.equal(current(render({ permissions: ['forces.command'], roles: ['OPS_STAFF'] })), 'Распределения');
  assert.equal(current(render({ permissions: ['forces.allocate'], roles: ['FORCES_GATHERING_OFFICER'] })), 'Рабочий стол');
  assert.equal(current(render({ pathname: '/statuses/', permissions: ['status.view'] })), 'Управление статусами');
});

test('brand follows custom workspace rights instead of technical role', () => {
  assert.equal(brand(render({ permissions: ['status.view', 'service_summary.view'], roles: ['CUSTOM_READER'] })).props.href, '/security-ops/service-summary');
  assert.equal(brand(render({ permissions: ['status.view'], roles: ['DUTY_OFFICER'] })).props.href, '/security-ops/profile');
  assert.equal(brand(render({ permissions: ['status.view', 'status.workspace'], roles: ['DUTY_OFFICER', 'CUSTOM_READER'] })).props.href, '/statuses');
});
