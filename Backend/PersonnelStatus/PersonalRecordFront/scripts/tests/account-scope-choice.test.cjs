const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ordinaryRole = code => ({ code, name: `Role ${code}`, description: 'Работа со статусами управления', is_active: true, permissions: ['status.view'] });

function accountForm() {
  const calls = [];
  const roles = { isSuccess: true, isFetching: false, data: { results: [ordinaryRole('READER'), ordinaryRole('OTHER'), { ...ordinaryRole('ADMIN'), permissions: ['*'] }] } };
  const divisions = { isSuccess: true, isFetching: false, data: { id: 0, children: [{ id: 7, name: 'Управление', children: [{ id: 8, name: 'Отдел' }] }] } };
  const rights = { hasGlobalPermission: () => true };
  const assignment = { isPending: false, error: null, mutate: body => calls.push(body) };
  const states = [];
  let index = 0;
  let changed = false;
  let effects = [];
  const react = {
    ...require('react'),
    useState(initial) {
      const id = index++;
      if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial;
      return [states[id], value => {
        const next = typeof value === 'function' ? value(states[id]) : value;
        if (!Object.is(next, states[id])) { states[id] = next; changed = true; }
      }];
    },
    useEffect(callback, deps) {
      const id = index++;
      if (!states[id] || deps.some((value, offset) => !Object.is(value, states[id][offset]))) {
        effects.push(callback);
        states[id] = deps;
      }
    },
  };
  const idle = () => ({ isPending: false, error: null, mutate() {} });
  const stubs = {
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => rights },
    '@/hooks/use-divisions-tree': { useDivisionsTree: () => divisions },
    '@/hooks/use-access-permissions': {
      useAccessUserRoles: () => ({ data: { results: [] } }),
      useAccessRoleOptions: () => roles,
      useAssignAccessRole: () => assignment,
      useRevokeAccessRole: idle,
      useSetAccessAccountActive: idle,
      useResetAccessAccountPassword: idle,
    },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
    '@/entities/access': { WHOLE_SERVICE_SCOPE_LABEL: 'Вся служба' },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../app/settings/users/page.tsx'), 'utf8') + '\nexports.subject = AccountDetails;';
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => name === 'react' ? react : stubs[name] ?? (name.startsWith('@/') || name.startsWith('./') || name.startsWith('next/') ? new Proxy({}, { get: (_, key) => key }) : require(name)),
  });
  function render() {
    let tree;
    for (let turn = 0; turn < 10; turn++) {
      index = 0; changed = false; effects = [];
      tree = exports.subject({ account: { id: 42, username: 'fixture', full_name: 'Fixture User', email: '', is_active: true, last_login: null }, onTemporaryPassword() {} });
      effects.forEach(effect => effect());
      if (!changed) break;
      assert.ok(turn < 9, 'component effects must settle');
    }
    const nodes = [];
    function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.props?.children); }
    visit(tree);
    return nodes;
  }
  const field = id => render().find(node => node.props?.id === id);
  const grant = () => render().find(node => node.type === 'Button' && node.props.children === 'Выдать');
  return {
    roles, divisions, rights, assignment, calls, render,
    role: () => field('assign-role'),
    scope: () => field('assign-scope'),
    selectRole(value) { field('assign-role').props.onChange({ target: { value } }); },
    selectScope(value) { field('assign-scope').props.onChange({ target: { value } }); },
    grant,
    submit() { grant().props.onClick(); },
    text: () => render().flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : Array.isArray(node.props?.children) ? node.props.children.filter(child => typeof child === 'string') : []).join(' '),
  };
}

test('an ordinary role requires an explicit scope and cannot submit the initial empty choice', () => {
  const form = accountForm();
  assert.equal(form.scope().props.value, '');
  form.selectRole('READER');
  assert.equal(form.scope().props.value, '');
  assert.equal(form.grant().props.disabled, true);
  assert.ok(form.render().some(node => node.type === 'option' && node.props.value === '' && String(node.props.children).includes('область')));
  form.submit();
  assert.equal(form.calls.length, 0);
});

test('explicit subdivision and whole-service choices preserve numeric and null payloads', () => {
  const form = accountForm();
  form.selectRole('READER');
  form.selectScope('7');
  assert.equal(form.grant().props.disabled, false);
  form.submit();
  form.selectScope('WHOLE_SERVICE');
  assert.equal(form.grant().props.disabled, false);
  form.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(form.calls)), [
    { user_id: '42', role_code: 'READER', scope_division_id: 7 },
    { user_id: '42', role_code: 'READER', scope_division_id: null },
  ]);
});

test('choosing a different ordinary role clears the previous deliberate scope', () => {
  const form = accountForm();
  form.selectRole('READER');
  form.selectScope('WHOLE_SERVICE');
  form.selectRole('OTHER');
  assert.equal(form.scope().props.value, '');
  assert.equal(form.grant().props.disabled, true);
  form.submit();
  assert.equal(form.calls.length, 0);
  form.selectScope('8');
  form.selectRole('READER');
  assert.equal(form.scope().props.value, '');
});

test('wildcard roles force whole service even while subdivision choices are unavailable', () => {
  const form = accountForm();
  form.divisions.isSuccess = false;
  form.divisions.isPending = true;
  form.divisions.data = undefined;
  form.selectRole('ADMIN');
  assert.equal(form.scope().props.value, 'WHOLE_SERVICE');
  assert.equal(form.scope().props.disabled, true);
  assert.equal(form.grant().props.disabled, false);
  form.submit();
  assert.equal(form.calls[0].scope_division_id, null);
});

test('leaving a wildcard role cannot silently retain whole-service access', () => {
  const form = accountForm();
  form.selectRole('ADMIN');
  form.selectRole('READER');
  assert.equal(form.scope().props.value, '');
  assert.equal(form.scope().props.disabled, false);
  assert.equal(form.grant().props.disabled, true);
  form.submit();
  assert.equal(form.calls.length, 0);
});

for (const scenario of [
  { name: 'role catalog is refreshing', change: form => { form.roles.isFetching = true; } },
  { name: 'role catalog has failed', change: form => { form.roles.isSuccess = false; form.roles.isError = true; } },
  { name: 'selected role disappeared', change: form => { form.roles.data.results = form.roles.data.results.filter(role => role.code !== 'READER'); } },
  { name: 'subdivision catalog is refreshing', change: form => { form.divisions.isFetching = true; } },
  { name: 'subdivision catalog has failed', change: form => { form.divisions.isSuccess = false; form.divisions.isError = true; } },
  { name: 'selected subdivision disappeared', change: form => { form.divisions.data.children = []; } },
  { name: 'administrative permission is absent', change: form => { form.rights.hasGlobalPermission = () => false; } },
  { name: 'assignment is pending', change: form => { form.assignment.isPending = true; } },
]) test(`cannot grant from cached form state when ${scenario.name}`, () => {
  const form = accountForm();
  form.selectRole('READER');
  form.selectScope('7');
  scenario.change(form);
  assert.equal(form.grant().props.disabled, true);
  form.submit();
  assert.equal(form.calls.length, 0);
});

test('removing wildcard permission in a refreshed role leaves no ordinary scope selected', () => {
  const form = accountForm();
  form.selectRole('ADMIN');
  form.roles.data.results.find(role => role.code === 'ADMIN').permissions = ['status.view'];
  assert.equal(form.scope().props.value, '');
  assert.equal(form.grant().props.disabled, true);
});

test('scope help explains descendants and additive unrestricted access in plain language', () => {
  const form = accountForm();
  form.selectRole('READER');
  const text = form.text();
  assert.match(text, /подчинённые/);
  assert.match(text, /Вся служба[^.]*без ограничения подразделением/);
  assert.match(text, /складываются/);
  assert.match(text, /не отменяет[^.]*всю службу/);
});
