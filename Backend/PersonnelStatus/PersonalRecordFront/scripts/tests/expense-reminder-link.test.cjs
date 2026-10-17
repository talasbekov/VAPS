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
  vm.runInNewContext(compiled, { exports, require: name => dependencies[name] ?? (name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(name)) });
  return exports;
}
const portal = load('entities/portal-access/index.ts');
function render(permissions, roles = []) {
  const { ExpenseTrafficCard } = load('features/command-expense/ui/ExpenseTrafficCard.tsx', {
    react: { ...require('react'), useMemo: callback => callback() },
    'next/link': 'Link',
    '@/entities/portal-access': portal,
    '@/entities/daily-grid': { SUBMISSION_LABEL: {}, countSubmissions: () => ({ submitted: 0, missing: 1, late: 0 }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, roles: roles.map(code => ({ code })), hasPermission: code => permissions.includes('*') || permissions.includes(code) }) },
    '@/hooks/use-strength-report': { useTrafficLightTree: () => ({ isPending: false, isError: false, data: { nodes: [], business_date: '2026-10-21', control_hour: '17:00:00' } }) },
  });
  const nodes = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    nodes.push(value); visit(value.props?.children);
  }
  visit(ExpenseTrafficCard());
  return nodes;
}
const reminder = nodes => nodes.find(node => node.props?.children === 'Открыть свод для напоминания');
test('duty reminder link carries the actual traffic report date', () => {
  const tree = render(['status.view', 'service_summary.view', 'daily_report.generate'], ['DUTY_OFFICER']);
  assert.equal(reminder(tree).props.href, '/security-ops/service-summary?dateFrom=2026-10-21');
  assert.match(reminder(tree).props.className, /min-h-11/);
  assert.equal(tree.some(node => node.type === 'Button'), false);
});
test('scoped non-duty and read-only duty users receive no reminder promise', () => {
  assert.equal(reminder(render(['status.view', 'daily_report.generate'], ['DEPARTMENT_EXPENSE_OFFICER'])), undefined);
  assert.equal(reminder(render(['status.view'], ['DUTY_OFFICER'])), undefined);
  assert.equal(reminder(render(['daily_report.generate'], ['DUTY_OFFICER'])), undefined);
});
test('administrator can reach existing reminder workflow without a synthetic duty role', () => {
  assert.ok(reminder(render(['*'])));
});

test('custom rights grant reminder access; technical duty role alone cannot', () => {
  assert.ok(reminder(render(['status.view', 'service_summary.view', 'daily_report.generate'], ['CUSTOM_READER'])));
  assert.equal(reminder(render(['status.view', 'daily_report.generate'], ['DUTY_OFFICER'])), undefined);
  assert.equal(reminder(render(['service_summary.view', 'daily_report.generate'], ['CUSTOM_READER'])), undefined);
});
