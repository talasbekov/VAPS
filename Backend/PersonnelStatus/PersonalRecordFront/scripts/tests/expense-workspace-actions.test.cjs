const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '../..');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, URLSearchParams, require: name => {
    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(root, path.dirname(file), name)) + '.tsx', dependencies);
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const model = (() => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'features/forces-workspace/model/workspace.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, URLSearchParams });
  return exports;
})();
const expense = id => ({ code: 'DEPARTMENT_EXPENSE_OFFICER', name: 'Ответственный за расход', scope_division_id: id, scope_division_name: `Департамент ${id}` });
const source = (id, name, recipient, withoutStatus, submitted = false) => ({
  division: { id: String(id), name, parent_id: '2', division_type: 'directorate', notify_recipient_name: recipient, without_status: withoutStatus },
  listTotal: 6, offList: 0, withoutStatus, submission: submitted ? { sent_at: null } : null,
});
function state(overrides = {}) {
  const access = { roles: [expense(2)], permissions: new Set(['status.view', 'forces.allocate']), globalPermissions: new Set(),
    isLoading: false, error: null, hasPermission: code => ['status.view', 'forces.allocate'].includes(code) };
  const query = { isPending: false, isFetching: false, isError: false, error: null, refetch() {} };
  const data = { scope: { id: '2', name: 'Департамент 2' },
    sources: [source(3, 'Первое управление', 'Начальник первого', 2), source(4, 'Второе управление', null, 0), source(5, 'Сдавшее управление', 'Начальник третьего', 0, true)],
    total: { submission: null } };
  return { access, businessDate: '2026-10-20', scopeId: 2, data, query, structureError: null,
    clock: query, report: query, divisions: query, submissions: query, catalog: { isError: false }, ...overrides };
}
function render(snapshot = state(), query = 'businessDate=2026-10-20&search=retained', role = 'expense') {
  const identity = ({ children }) => React.createElement(React.Fragment, null, children);
  const { ForcesWorkspace } = load('features/forces-workspace/ui/ForcesWorkspace.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ replace() {} }) },
    'lucide-react': { ArrowLeft: () => null },
    '@/components/dashboard-layout': { DashboardLayout: identity },
    '@/components/ui/button': { Button: ({ children, variant, ...props }) => React.createElement('button', props, children) },
    '@/features/department-requests': { DepartmentRequestsTable: () => React.createElement('p', null, 'Existing requests') },
    '@/features/force-collections': { ForceCollectionsTable: () => React.createElement('p', null, 'Existing collections') },
    '@/features/daily-expense': { DailyExpenseBoard: () => React.createElement('p', null, 'Existing generic daily form') },
    '@/features/daily-expense/ui/ResponsibleDailyExpense': {
      ResponsibleDailyExpense: () => React.createElement('p', null, 'Existing department daily form'),
      DailyRetry: ({ label }) => React.createElement('p', { role: 'alert' }, label),
    },
    '@/features/daily-expense/model/directorate-summary': { useResponsibleDaily: () => snapshot },
    '@/features/daily-expense/ui/SummaryActionBar': { SUMMARY_ACTION_ANCHOR: 'summary-action' },
    '@/hooks/use-department-requests': { useDepartmentRequests: () => ({ data: { results: [] }, isPending: false, isError: false }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => snapshot.access },
    '@/entities/portal-access': load('entities/portal-access/index.ts'),
    '@/shared/lib/date': { formatIsoDate: date => date.split('-').reverse().join('.'), formatIsoDateTime: date => date },
    '../model/workspace': model,
    '../model/daily-action-queue': { useDailyActionQueue: () => snapshot },
  });
  return renderToStaticMarkup(React.createElement(ForcesWorkspace, { role }));
}

test('expense opens with the missing-submission action queue before its existing daily form', () => {
  const html = render();
  assert.match(html, /Требует моего действия/);
  assert.ok(html.indexOf('Требует моего действия') < html.indexOf('Existing department daily form'));
  assert.match(html, /Не сдали[^<]*2/);
  assert.match(html, /Первое управление/);
  assert.match(html, /Начальник первого/);
  assert.match(html, /Без статуса[^<]*2/);
  assert.match(html, /Получатель[^<]*не назначен/);
  assert.match(html, /Департамент 2/);
  assert.match(html, /20\.10\.2026/);
  assert.doesNotMatch(html, /Сдавшее управление/);
  assert.match(html, /href="\/employees\?businessDate=2026-10-20&amp;search=retained&amp;view=daily#summary-action"/);
});

for (const [label, patch, expected] of [
  ['pending snapshot', { query: { isPending: true } }, /Загрузка очереди/],
  ['cached snapshot being rechecked', { query: { isFetching: true } }, /Загрузка очереди/],
  ['denied snapshot after cached success', { query: { isError: true, error: { status: 403 } } }, /Доступ[^<]*закрыт/],
  ['unavailable snapshot after cached success', { query: { isError: true, error: { status: 503 } } }, /Очередь[^<]*недоступна/],
  ['wrong department snapshot', { data: { scope: { id: '18', name: 'Чужой департамент' }, sources: [source(3, 'Первое управление', 'Начальник первого', 2)], total: {} } }, /Загрузка очереди/],
]) test(`${label} hides source identities and incomplete missing counts`, () => {
  const html = render(state(patch));
  assert.match(html, expected);
  assert.doesNotMatch(html, /Первое управление|Начальник первого|Не сдали[^<]*2|Чужой департамент/);
});

test('a retained expense role cannot reveal the queue after status access is revoked', () => {
  const snapshot = state();
  snapshot.access.hasPermission = code => code === 'forces.allocate';
  const html = render(snapshot, 'view=daily&businessDate=2026-10-20');
  assert.match(html, /Недостаточно прав/);
  assert.doesNotMatch(html, /Первое управление|Начальник первого|Требует моего действия|Existing department daily form/);
});

test('daily-only responsibility retains its missing-submission queue without force allocation', () => {
  const snapshot = state();
  const permissions = ['status.view', 'daily_report.generate'];
  snapshot.access.permissions = new Set(permissions);
  snapshot.access.hasPermission = code => permissions.includes(code);
  const html = render(snapshot);
  assert.match(html, /Первое управление/);
  assert.match(html, /Не сдали[^<]*2/);
  assert.doesNotMatch(html, /Недостаточно прав/);
});

test('permission loading hides cached source names and is not presented as a forbidden read', () => {
  const snapshot = state(); snapshot.access.isLoading = true;
  const html = render(snapshot);
  assert.match(html, /Загрузка очереди/);
  assert.doesNotMatch(html, /Первое управление|Начальник первого|Недостаточно прав/);
});

test('an empty source list is explained without a misleading zero-laggard success', () => {
  const snapshot = state(); snapshot.data.sources = [];
  const html = render(snapshot);
  assert.match(html, /Нет обязательных источников/);
  assert.doesNotMatch(html, /Не сдали|Все обязательные источники сдали/);
});

test('a fully sent department with submitted sources has a completed empty queue', () => {
  const snapshot = state(); snapshot.data.sources = [source(3, 'Первое управление', 'Начальник первого', 0, true)];
  snapshot.data.total.submission = { sent_at: '2026-10-20T08:00:00Z' };
  const html = render(snapshot);
  assert.match(html, /Свод отправлен/);
  assert.match(html, /Нет ожидающих сдач/);
  assert.doesNotMatch(html, /Первое управление|Не сдали/);
});

for (const [label, roles, globals] of [
  ['multiple departments', [expense(2), expense(18)], []],
  ['mixed global and scoped expense', [expense(null), expense(2)], []],
  ['global wildcard', [expense(2)], ['*']],
]) test(`${label} keeps the generic department picker without a guessed queue`, () => {
  const snapshot = state(); snapshot.access.roles = roles; snapshot.access.globalPermissions = new Set(globals);
  const html = render(snapshot);
  assert.match(html, /Existing generic daily form/);
  assert.doesNotMatch(html, /Первое управление|Требует моего действия/);
});

test('an explicit request deep link keeps forces work without a daily queue', () => {
  const html = render(state(), 'request=123&view=daily&businessDate=2026-10-20');
  assert.match(html, /Existing requests/);
  assert.doesNotMatch(html, /Первое управление|Требует моего действия|Existing department daily form/);
});
