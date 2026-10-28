const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const date = '2026-10-28';
const empty = () => null;
const pass = ({ children }) => React.createElement(React.Fragment, null, children);

function panelCounts(divisions, rows) {
  const counts = {};
  const success = data => ({ data, isSuccess: true, isFetching: false, isPending: false, isError: false });
  const permissions = { roles: [], globalPermissions: new Set(), isLoading: false, error: null,
    hasPermission: code => ['status.view', 'daily_report.mark_update'].includes(code) };
  const modules = new Map();
  const overrides = {
    react: { ...React, useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial;
      return React.useState(Object.prototype.toString.call(value) === '[object Set]' ? new Set(rows.map(row => row.division_id)) : value);
    } },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => permissions },
    '@/hooks/use-strength-report': { useStrengthReport: () => success({ business_date: date, rows, totals: {}, column_labels: {} }) },
    '@/hooks/use-daily-expense-read': { useDailyExpenseRead: name => success({ results: name === 'divisions' ? divisions : [] }) },
    '@/hooks/use-ops-status-types': { useOpsStatusTypes: () => ({ all: [], isLoading: false, isError: false, labelOf: code => code }) },
    '@/hooks/use-ops-status-write': { useCreateOpsStatus: () => ({}) },
    '@/entities/status/access': { canManageStatusInDivision: () => false },
    '../model/business-date': { useBusinessDate: () => ({ businessDate: date, isOverridden: true }) },
    '@/features/ops-daily': { DaySubmissionPanel: props => { counts[props.divisionId] = props.rowCount; return null; } },
    '@/lib/api': { apiClient: {} }, '@/lib/ops-api': { opsApiClient: {} },
    './SetStatusDialog': { SetStatusDialog: empty }, './LeadershipStrip': { LeadershipStrip: empty },
    './SummaryVersions': { SummaryVersions: empty }, './StatusDetails': { StatusDetails: empty },
    '@/components/stat-card': { StatCard: empty },
  };
  function load(id, importer = path.join(root, 'features/daily-expense/ui/DailyExpenseBoard.tsx')) {
    if (id in overrides) return overrides[id];
    if (id.startsWith('@/components/ui/')) return new Proxy({}, { get: () => pass });
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(importer), id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw new Error('Missing module ' + id);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: child => load(child, file), URLSearchParams });
    return exports;
  }
  const { DailyExpenseBoard } = load('@/features/daily-expense/ui/DailyExpenseBoard');
  renderToStaticMarkup(React.createElement(DailyExpenseBoard));
  return counts;
}

const division = (id, parent_id) => ({ id: String(id), parent_id: parent_id == null ? null : String(parent_id), name: 'Unit ' + id, can_submit: true });
const row = (division_id, list_total) => ({ division_id, list_total, name: 'Unit ' + division_id, columns: {} });

test('submission confirmation counts the entire nested subtree and excludes another directorate', () => {
  const counts = panelCounts([division(2, 1), division(3, 2), division(4, 3), division(9, 1)],
    [row(2, 1), row(3, 2), row(4, 3), row(9, 40)]);
  assert.deepEqual(counts, { 2: 6, 3: 5, 4: 3, 9: 40 });
});

test('leaf and empty-directorate confirmations preserve exact zero and occupied counts', () => {
  assert.deepEqual(panelCounts([division(2, null), division(3, null)], [row(2, 0), row(3, 4)]), { 2: 0, 3: 4 });
});
