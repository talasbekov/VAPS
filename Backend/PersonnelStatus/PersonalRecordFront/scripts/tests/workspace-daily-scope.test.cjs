const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}, appendix = '') {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') + appendix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, URLSearchParams, window: {location: {hash:'#summary-action'}}, require: name => dependencies[name] ?? (name.startsWith('.') || name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(name)) });
  return exports;
}
const workspace = load('features/forces-workspace/model/workspace.ts');
const expense = scope_division_id => ({ code: 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id });
function dailyComponent(roles, globals = [], workspaceRole = 'expense') {
  const access = { roles, globalPermissions: new Set(globals), permissions: new Set(['*']), isLoading: false, error: null,
    hasPermission: () => true, hasGlobalPermission: code => globals.includes('*') || globals.includes(code) };
  const { ForcesWorkspace } = load('features/forces-workspace/ui/ForcesWorkspace.tsx', {
    '../model/workspace': workspace,
    'next/navigation': { useSearchParams: () => new URLSearchParams('view=department-summary'), useRouter: () => ({ replace() {} }) },
    'next/link': { default: 'Link' },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
  });
  const types = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    types.push(node.type); visit(node.props?.children);
  }
  visit(ForcesWorkspace({ role: workspaceRole }));
  return types.filter(type => ['DailyExpenseBoard', 'ResponsibleDailyExpense'].includes(type));
}
for (const [label, roles, globals, selected] of [
  ['single department', [expense(2)], [], 'ResponsibleDailyExpense'],
  ['scoped custom wildcard', [expense(2), { code: 'CUSTOM', scope_division_id: 2 }], [], 'ResponsibleDailyExpense'],
  ['two departments', [expense(2), expense(18)], [], 'DailyExpenseBoard'],
  ['global and scoped grants', [expense(null), expense(2)], [], 'DailyExpenseBoard'],
  ['administrator plus scoped expense', [expense(2), { code: 'ADMIN', scope_division_id: null }], ['*'], 'DailyExpenseBoard'],
  ['custom global wildcard plus scoped expense', [expense(2), { code: 'CUSTOM', scope_division_id: null }], ['*'], 'DailyExpenseBoard'],
]) test(label, () => assert.deepEqual(dailyComponent(roles, globals), [selected]));
test('headquarters daily remains the generic board', () => assert.deepEqual(dailyComponent([{ code: 'OPS_STAFF', scope_division_id: null }], ['forces.command'], 'headquarters'), ['DailyExpenseBoard']));

function standaloneDaily(codes, patch = {}) {
  assert.ok(fs.existsSync(path.join(__dirname, '../../app/daily-expense/page.tsx')), 'daily responsibilities need a standalone route');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const access = { roles: [], permissions: new Set(codes), globalPermissions: new Set(), isLoading: false, error: null,
    hasPermission: code => codes.includes('*') || codes.includes(code), ...patch };
  const reads = [];
  const identity = ({children}) => children;
  const Page = load('app/daily-expense/page.tsx', {
    'next/navigation': { useSearchParams: () => new URLSearchParams('businessDate=2026-10-27&dateFrom=2026-10-20'), useRouter: () => ({ replace() {} }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/entities/portal-access': load('entities/portal-access/index.ts'),
    '@/features/forces-workspace/model/workspace': workspace,
    '@/components/dashboard-layout': { DashboardLayout: identity },
    '@/components/page-header': { PageHeader: ({title, description}) => React.createElement('header', null, React.createElement('h1', null, title), description) },
    '@/components/ui/button': { Button: identity },
    '@/components/ops-access-denied': { OpsAccessDenied: ({what, actions}) => React.createElement('section', {role:'alert'}, `Недостаточно прав для просмотра ${what}`, actions) },
    '@/features/daily-expense': { DailyExpenseBoard: props => { reads.push(props); return null; } },
    '@/features/daily-expense/ui/ResponsibleDailyExpense': { ResponsibleDailyExpense: props => { reads.push(props); return null; } },
    '@/features/forces-workspace/ui/DailyActionQueue': { DailyActionQueue: () => null },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Page));
  return {html, reads};
}

test('daily-only permission mounts the existing expense form for the selected date', () => {
  const {html, reads} = standaloneDaily(['status.view','daily_report.generate']);
  assert.match(html, /Ежедневный расход/);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].businessDate, '2026-10-27');
});

test('daily entry prevents child data reads during loading, failure and revoked grants', () => {
  for (const [codes, patch] of [
    [[], {}], [['status.view'], {}], [['daily_report.generate'], {}],
    [['status.view','forces.allocate'], {}],
    [['status.view','daily_report.generate'], {isLoading:true}],
    [['status.view','daily_report.generate'], {error:Error('403')}],
    [['status.view','daily_report.generate'], {permissions:undefined}],
  ]) {
    const {html, reads} = standaloneDaily(codes, patch);
    assert.equal(reads.length, 0);
    assert.match(html, /role="(?:status|alert)"/);
  }
});

function legacyEntry(query, codes, patch = {}) {
  const routes = [], effects = [];
  const access = {roles:[], permissions:new Set(codes), isLoading:false, error:null,
    hasPermission:code=>codes.includes('*')||codes.includes(code), ...patch};
  const {subject} = load('app/employees/page.tsx', {
    react:{...require('react'),useEffect:callback=>effects.push(callback)},
    'next/navigation':{useSearchParams:()=>new URLSearchParams(query),useRouter:()=>({replace:href=>routes.push(href)})},
    '@tanstack/react-query':{useQueryClient:()=>({})},
    '@/hooks/use-ops-permissions':{useOpsPermissions:()=>access},
    '@/entities/portal-access':load('entities/portal-access/index.ts'),
    '@/features/forces-workspace/model/workspace':workspace,
  }, '\nexports.subject = EmployeesEntry;');
  const tree = subject();
  effects.forEach(effect=>effect());
  const types=[];
  function visit(node) {
    if(Array.isArray(node)) return node.forEach(visit);
    if(!node || typeof node!=='object') return;
    types.push(typeof node.type==='function' ? node.type.name : node.type);
    visit(node.props?.children);
  }
  visit(tree);
  return {routes,types};
}

test('legacy daily link redirects only with confirmed daily authority before any force screen mounts', () => {
  const codes=['status.view','daily_report.generate'];
  const ready=legacyEntry('view=department-summary&businessDate=2026-10-27',codes);
  assert.deepEqual(ready.routes,['/daily-expense?businessDate=2026-10-27#summary-action']);
  assert.ok(!ready.types.some(type=>['EmployeesScreen','ForcesWorkspace'].includes(type)));
  for(const patch of [{isLoading:true},{error:Error('403')},{permissions:undefined,hasPermission:()=>false}]) {
    const result=legacyEntry('view=daily',codes,patch);
    assert.deepEqual(result.routes,[]);
    assert.ok(!result.types.some(type=>['EmployeesScreen','ForcesWorkspace'].includes(type)));
  }
  for(const query of ['view=forces','view=daily&request=7','']) {
    const result=legacyEntry(query,codes);
    assert.deepEqual(result.routes,[]);
    assert.ok(!result.types.some(type=>['EmployeesScreen','ForcesWorkspace'].includes(type)));
  }
});
