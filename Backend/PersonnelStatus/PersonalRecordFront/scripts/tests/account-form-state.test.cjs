const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function component(file, name, dependencies) {
  const cells = [];
  let index = 0;
  let effects = [];
  const react = { ...require('react'),
    useState(initial) { const id = index++; if (!(id in cells)) cells[id] = typeof initial === 'function' ? initial() : initial; return [cells[id], value => { cells[id] = typeof value === 'function' ? value(cells[id]) : value; }]; },
    useRef(initial) { const id = index++; return cells[id] ??= { current: initial }; },
    useEffect(callback, deps) { const id = index++; if (!cells[id] || deps.some((value, i) => value !== cells[id][i])) { effects.push(callback); cells[id] = deps; } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') + `\nexports.subject = ${name};`;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, URLSearchParams, require: key => key === 'react' ? react : dependencies[key] ?? (key.startsWith('@/') || key.startsWith('./') || key.startsWith('next/') ? new Proxy({}, { get: (_, name) => name }) : require(key)) });
  return props => {
    index = 0; effects = [];
    const tree = exports.subject(props);
    effects.forEach(effect => effect());
    const nodes = [];
    function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.props?.children); }
    visit(tree);
    return nodes;
  };
}

test('pending account creation cannot be dismissed and lose its one-time result', () => {
  let closes = 0; let resets = 0;
  const mutation = { isPending: true, data: undefined, error: null, reset: () => resets++ };
  const render = component('app/settings/users/page.tsx', 'CreateAccountDialog', {
    '@/hooks/use-access-permissions': { useCreateAccessAccount: () => mutation },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  const props = { open: true, onOpenChange: () => closes++, onCreated() {} };
  const nodes = render(props);
  const cancel = nodes.find(node => node.type === 'Button' && node.props.children === 'Отмена');
  assert.equal(cancel.props.disabled, true);
  nodes.find(node => node.type === 'Dialog').props.onOpenChange(false);
  assert.equal(closes, 0);
  assert.equal(resets, 0);
  mutation.isPending = false;
  render(props).find(node => node.type === 'Dialog').props.onOpenChange(false);
  assert.equal(closes, 1);
  assert.equal(resets, 1);
});

function employeeLink() {
  const choices = { data: { count: 1, results: [{ id: 7, name: 'Selected person', personnel_number: 'P7', user_id: null }] }, isLoading: false, isError: false };
  const writes = [];
  const mutation = { isPending: false, error: null, mutate: body => writes.push(body) };
  const render = component('app/settings/users/account-employee-link.tsx', 'AccountEmployeeLink', {
    '@tanstack/react-query': { useQuery: () => choices, useQueryClient: () => ({ invalidateQueries() {} }) },
    '@/hooks/use-ops-mutation': { useOpsMutation: () => mutation },
    '@/entities/access': { ACCESS_ACCOUNTS_PATH: '/accounts/', accessAccountPath: id => `/accounts/${id}/` },
  });
  const account = { id: 42, employee_id: null, employee_name: null };
  return { account, choices, mutation, writes, render: () => render({ account }) };
}

test('searching again preserves the chosen employee as a visible option and save target', () => {
  const subject = employeeLink();
  subject.render().find(node => node.type === 'select').props.onChange({ target: { value: '7' } });
  subject.choices.data = { count: 1, results: [{ id: 8, name: 'Other person', personnel_number: 'P8', user_id: null }] };
  const nodes = subject.render();
  assert.ok(nodes.some(node => node.type === 'option' && String(node.props.value) === '7'), 'controlled selection must stay visible when search excludes it');
  nodes.find(node => node.type === 'Button' && node.props.children === 'Сохранить связь').props.onClick();
  assert.equal(subject.writes[0].employee_id, 7);
});

test('pending employee-link save protects the submitted selection from further edits', () => {
  const subject = employeeLink();
  subject.mutation.isPending = true;
  const nodes = subject.render();
  assert.equal(nodes.find(node => node.type === 'select').props.disabled, true);
  assert.equal(nodes.find(node => node.type === 'Input').props.disabled, true);
});

test('employee search explains loading and an empty result instead of a silent dropdown', () => {
  const subject = employeeLink();
  subject.choices.data = undefined;
  subject.choices.isLoading = true;
  let nodes = subject.render();
  assert.ok(nodes.some(node => node.props?.role === 'status' && String(node.props.children).includes('Поиск сотрудников')));
  subject.choices.isLoading = false;
  subject.choices.data = { count: 0, results: [] };
  nodes = subject.render();
  assert.ok(nodes.some(node => node.props?.role === 'status' && String(node.props.children).includes('Сотрудники не найдены')));
});

test('failed employee search hides cached matches and blocks saving a stale selection', () => {
  const subject = employeeLink();
  subject.render().find(node => node.type === 'select').props.onChange({ target: { value: '7' } });
  subject.choices.isError = true;
  const nodes = subject.render();
  assert.ok(nodes.some(node => node.props?.role === 'alert' && String(node.props.children).includes('Не удалось')));
  assert.equal(nodes.some(node => node.type === 'option' && String(node.props.value) === '7'), false);
  assert.equal(nodes.find(node => node.type === 'Button' && node.props.children === 'Сохранить связь').props.disabled, true);
});

test('employee search makes matching results explicit and points to the choice list', () => {
  const nodes = employeeLink().render();
  assert.ok(nodes.some(node => node.props?.role === 'status' && String(node.props.children).includes('Найдено сотрудников')));
});

test('account search results show the linked employee name when login profile has no name', () => {
  const render = component('app/settings/users/page.tsx', 'AccountRow', {
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  const nodes = render({ account: { id: 42, username: 'imported_42', full_name: null, employee_name: 'Мейрам Еламан', is_active: true }, isSelected: false, onSelect() {} });
  assert.ok(nodes.some(node => node.props?.children === 'Мейрам Еламан'));
});

test('selected account remains editable when server search excludes it', () => {
  const account = { id: 42, username: 'selected', employee_id: null };
  const render = component('app/settings/users/page.tsx', 'AccessUsersScreen', {
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/settings/users', useSearchParams: () => new URLSearchParams('user=42&search=other') },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasGlobalPermission: () => true, isLoading: false }) },
    '@/hooks/use-debounced-commit': { useDebouncedCommit: value => [value, () => {}] },
    '@/hooks/use-access-permissions': { useAccessAccounts: () => ({ data: { count: 0, results: [] } }), useAccessAccount: () => ({ data: account }) },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  const nodes = render({});
  assert.ok(nodes.some(node => node.type?.name === 'AccountDetails' && node.props.account.id === 42));
});

test('account registry exposes later pages and resets offset when search changes', () => {
  const routes = []; let options;
  const render = component('app/settings/users/page.tsx', 'AccessUsersScreen', {
    'next/navigation': { useRouter: () => ({ replace: value => routes.push(value) }), usePathname: () => '/settings/users', useSearchParams: () => new URLSearchParams('user=42&offset=50') },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasGlobalPermission: () => true, isLoading: false }) },
    '@/hooks/use-debounced-commit': { useDebouncedCommit: (value, change) => [value, change] },
    '@/hooks/use-access-permissions': { useAccessAccounts: (_, value) => { options = value; return { data: { count: 101, next: '/accounts/?offset=100', previous: '/accounts/', results: [{ id: 42 }] } }; }, useAccessAccount: () => ({ data: undefined }) },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  const nodes = render({});
  assert.equal(options.offset, 50);
  nodes.find(node => node.type === 'Button' && node.props.children === 'Следующая страница').props.onClick();
  assert.equal(new URL('https://example.test' + routes.pop()).searchParams.get('offset'), '100');
  nodes.find(node => node.type === 'Input').props.onChange({ target: { value: 'new-search' } });
  const next = new URL('https://example.test' + routes.pop());
  assert.equal(next.searchParams.get('offset'), null);
  assert.equal(next.searchParams.get('user'), '42');
});

for (const scenario of [
  { name: 'failed detail refresh', detail: { data: { id: 42 }, isError: true } },
  { name: 'different user still loading', detail: { data: { id: 41 }, isLoading: true } },
  { name: 'permissions still loading', loading: true, detail: { data: { id: 42 } } },
  { name: 'permissions unavailable', allowed: false, detail: { data: { id: 42 } } },
]) test(scenario.name + ' cannot expose editable cached account', () => {
  const render = component('app/settings/users/page.tsx', 'AccessUsersScreen', {
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/settings/users', useSearchParams: () => new URLSearchParams('user=42') },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasGlobalPermission: () => scenario.allowed !== false, isLoading: scenario.loading === true }) },
    '@/hooks/use-debounced-commit': { useDebouncedCommit: value => [value, () => {}] },
    '@/hooks/use-access-permissions': { useAccessAccounts: () => ({ data: { count: 0, results: [] } }), useAccessAccount: () => scenario.detail },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  assert.equal(render({}).some(node => node.type?.name === 'AccountDetails'), false);
});

test('late account refresh does not overwrite a newer employee draft', () => {
  const subject = employeeLink();
  subject.render().find(node => node.type === 'select').props.onChange({ target: { value: '7' } });
  subject.account.employee_id = 8;
  subject.render();
  assert.equal(subject.render().find(node => node.type === 'select').props.value, '7');
});

test('one-time password requires an explicit close instead of Escape or an outside click', () => {
  let closed = 0; let prevented = 0;
  const render = component('app/settings/users/page.tsx', 'TemporaryPasswordDialog', {
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
  });
  const nodes = render({ secret: { login: 'fixture', password: 'fixture', reason: 'created' }, onClose: () => closed++ });
  const content = nodes.find(node => node.type === 'DialogContent');
  content.props.onInteractOutside?.({ preventDefault: () => prevented++ });
  content.props.onEscapeKeyDown?.({ preventDefault: () => prevented++ });
  assert.equal(prevented, 2);
  assert.equal(closed, 0);
  nodes.find(node => node.type === 'Button' && node.props.children === 'Закрыть').props.onClick();
  assert.equal(closed, 1);
});

test('account list and selected detail use independent caches and global permission gates', () => {
  let allowed = true; const calls = [];
  const deps = {
    '@tanstack/react-query': { useQuery: config => config },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasGlobalPermission: () => allowed, isLoading: false }) },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/settings/users': 'admin.roles' } },
    '@/entities/access': { ACCESS_ACCOUNTS_PATH: '/api/operations/accounts/', accessAccountPath: id => `/api/operations/accounts/${id}/` },
    '@/lib/ops-api': { opsApiClient: { get: url => calls.push(url) } },
  };
  const list = component('hooks/use-access-permissions.ts', '(search) => useAccessAccounts(search, { offset: 50 })', deps);
  const detail = component('hooks/use-access-permissions.ts', 'useAccessAccount', deps);
  const listQuery = list('detail')[0]; const detailQuery = detail(50)[0];
  assert.notDeepEqual(Array.from(listQuery.queryKey), Array.from(detailQuery.queryKey));
  listQuery.queryFn(); detailQuery.queryFn();
  assert.equal(calls[0], '/api/operations/accounts/?search=detail&limit=50&offset=50');
  assert.equal(calls[1], '/api/operations/accounts/50/');
  allowed = false;
  assert.equal(list('detail')[0].enabled, false);
  assert.equal(detail(50)[0].enabled, false);
});
