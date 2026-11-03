const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, URLSearchParams, require: name => dependencies[name] ?? (name.startsWith('.') || name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(name)) });
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
