const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function moduleAt(file, deps) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: id => deps[id] ?? require(id) });
  return exports;
}

function render(compact, catalog) {
  // Use the real shared hook so inactive rows and aliases follow its contract.
  const hook = moduleAt('hooks/use-ops-status-types.ts', {
    react: { useMemo: fn => fn(), useCallback: fn => fn },
    '@tanstack/react-query': { useQuery: () => ({ data: catalog, isPending: false }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true }) },
    '@/entities/status/retired-types': { isSelectableStatusType: () => true },
    '@/lib/api': {},
  });
  const { StatsCards } = moduleAt('components/dashboard/stats-cards.tsx', {
    '@/hooks/use-ops-status-types': hook,
    '@/components/ui/card': {},
    '@/components/stat-card': { StatCard: 'StatCard' },
    '@/components/load-failure': { LoadFailure: 'LoadFailure' },
    'framer-motion': { motion: { div: 'div' } },
  });
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    nodes.push(node); walk(node.props?.children);
  }
  walk(StatsCards({ compact, stats: {
    staff_count: 10, total_absences: 10,
    by_type: { DUTY_DAILY: 1, SPECIAL_WATCH: 2, vacation: 3, OLD_IMPORT: 4 },
  } }));
  return compact
    ? nodes.filter(n => n.type === 'div' && Array.isArray(n.props.children) && n.props.children[0]?.type === 'dt')
      .map(n => [n.props.children[0].props.children, n.props.children[1].props.children])
    : nodes.filter(n => n.type === 'StatCard').map(n => [n.props.label, n.props.value]);
}

for (const compact of [true, false]) {
  test(`catalog and unknown historical statuses remain visible in ${compact ? 'compact' : 'full'} summary`, () => {
    const rows = render(compact, [
      { code: 'DUTY_DAILY', name: 'Суточное дежурство', is_active: true },
      { code: 'SPECIAL_WATCH', name: 'Исторический караул', is_active: false },
      { code: 'VACATION', legacy_code: 'vacation', name: 'Переименованный отпуск', is_active: true },
    ]);
    assert.deepEqual(rows, [
      ['Всего сотрудников', 10], ['Всего отсутствий', 10],
      ['Суточное дежурство', 1], ['Исторический караул', 2], ['Переименованный отпуск', 3], ['OLD_IMPORT', 4],
    ]);
    assert.equal(rows.slice(2).reduce((sum, row) => sum + row[1], 0), rows[1][1]);
  });

  test(`catalog unavailable preserves all counts and legacy fallback in ${compact ? 'compact' : 'full'} summary`, () => {
    assert.deepEqual(render(compact, []), [
      ['Всего сотрудников', 10], ['Всего отсутствий', 10],
      ['DUTY_DAILY', 1], ['SPECIAL_WATCH', 2], ['Отпуска', 3], ['OLD_IMPORT', 4],
    ]);
  });
}
