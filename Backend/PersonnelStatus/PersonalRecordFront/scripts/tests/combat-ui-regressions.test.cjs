const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToString, renderToStaticMarkup } = require('react-dom/server');

// Real component rendering; only external hooks, navigation and the host shell
// are supplied by the harness so the regression cannot depend on a live login.
function harness(overrides = {}) {
  const slots = [];
  let cursor = 0;
  const cache = new Map();
  const deps = {
    react: { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    } },
    '@/components/dashboard-layout': { DashboardLayout: ({ children }) => React.createElement('main', null,
      React.createElement('nav', { 'aria-label': 'Основная навигация' }), children) },
    '@/components/ui/card': { Card: 'section', CardContent: 'div' },
    '@/components/ui/button': { Button: ({ asChild, variant, size, children, ...props }) => React.createElement('button', props, children) },
    '@/components/ui/input': { Input: 'input' },
    '@/components/page-header': { PageHeader: ({ title }) => React.createElement('h1', null, title) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ error: null, isLoading: false }) },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries() {}, refetchQueries() {} }) },
    'next/navigation': { useSearchParams: () => new URLSearchParams('section=combat') },
    'next/link': ({ children, scroll, ...props }) => React.createElement('a', props, children),
    'lucide-react': { AlertTriangle: () => null },
    '@/features/duty-dispatch/ui/DutyDispatchWorkspace': { DutyDispatchWorkspace: () => null },
    './DutyJournalRecords': { DutyJournalRecords: () => null },
    './DutyRoster': { DutyRoster: () => null },
    '@/features/combat-duty/ui/CombatDutyBoard': { CombatDutyBoard: () => null },
    ...overrides,
  };
  function load(name) {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name === '../model/workspace') return load('@/features/duty-register/model/workspace');
    if (!name.startsWith('@/')) return require(name);
    const base = path.join(__dirname, '../..', name.slice(2));
    const file = [base + '.tsx', base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw Error('Missing module ' + name);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    } }).outputText, { exports, require: load, URLSearchParams, Set, Map });
    return exports;
  }
  return { load, render: fn => { cursor = 0; return fn(); } };
}

test('an unavailable journal section has one host shell, including embedded denial', () => {
  const h = harness({ '@/hooks/use-duty-register': { useDutyRegisterAccess: () => ({
    isLoading: false, error: null, allowed: true, hasPermission: code => code === 'status.manage',
    hasGlobalPermission: () => false, scope: 'own',
  }) } });
  const { DutyRegisterWorkspace } = h.load('@/features/duty-register/ui/DutyRegisterWorkspace');
  const html = h.render(() => renderToStaticMarkup(React.createElement(DutyRegisterWorkspace)));
  assert.match(html, /Доступ закрыт/);
  assert.equal((html.match(/<main/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Основная навигация"/g) ?? []).length, 1);
});

test('standalone access denial still provides its host shell', () => {
  const h = harness();
  const { OpsAccessDenied } = h.load('@/components/ops-access-denied');
  const html = h.render(() => renderToStaticMarkup(React.createElement(OpsAccessDenied, { what: 'журнала' })));
  assert.equal((html.match(/<main/g) ?? []).length, 1);
  assert.match(html, /Недостаточно прав для просмотра журнала/);
});

for (const isLoading of [true, false]) test(`ordinary suspense (permissions loading=${isLoading}) is neutral, not an outage`, () => {
  const h = harness({ '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({
    error: null, isLoading, canSuspendOnFailure: false,
  }) } });
  const { OpsPermissionBoundary } = h.load('@/components/ops-permission-boundary');
  const Wait = () => { throw new Promise(() => {}); };
  const html = h.render(() => renderToString(React.createElement(OpsPermissionBoundary, null, React.createElement(Wait))));
  assert.doesNotMatch(html, /Не удалось проверить права доступа|сервер не ответил|Повторить/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
});

for (const known of [false, true]) test(`a real permission outage (known editor=${known}) retains recovery without revealing content`, () => {
  const h = harness();
  const { OpsNetworkError } = h.load('@/lib/ops-errors');
  const error = new OpsNetworkError('offline');
  const outage = harness({
    '@/lib/ops-errors': h.load('@/lib/ops-errors'),
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ error, isLoading: false, canSuspendOnFailure: known }) },
  });
  const { OpsPermissionBoundary } = outage.load('@/components/ops-permission-boundary');
  const html = outage.render(() => renderToString(React.createElement(OpsPermissionBoundary, null,
    React.createElement('div', null, 'protected editor'))));
  assert.match(html, /Не удалось проверить права доступа/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /protected editor/);
});

const choices = { divisions: [
  { id: '1', name: 'Служба', parentId: null },
  { id: '2', name: 'Первый департамент', parentId: '1' },
  { id: '3', name: 'Первое управление', parentId: '2' },
  { id: '4', name: 'Второй департамент', parentId: '1' },
  { id: '5', name: 'Первое управление', parentId: '4' },
], objectChoices: [] };
const rows = ['2', '3', '5', '99'].map((divisionId, index) => ({
  id: String(index + 1), divisionId, name: 'Дневное', isActive: true, code: 'DAY',
}));
function catalogHarness(catalogChoices = choices, catalogRows = rows) {
  const writes = [];
  const h = harness({
    '@/hooks/use-combat-duty': { useCombatRead: () => ({ data: { results: catalogRows } }), useCombatRefresh: () => async () => {} },
    '@/lib/ops-api': { opsApiClient: { patch: async (...args) => { writes.push(args); } } },
  });
  const { CombatCatalogs } = h.load('@/features/combat-duty/ui/CombatCatalogs');
  const tree = () => h.render(() => CombatCatalogs({ choices: catalogChoices, divisionId: '2' }));
  return { tree, writes };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}
test('equal catalogue names show the full owner path and an honest fallback for an unknown owner', () => {
  const { tree } = catalogHarness();
  const html = renderToStaticMarkup(tree());
  assert.match(html, /Служба \/ Первый департамент \/ Первое управление/);
  assert.match(html, /Служба \/ Второй департамент \/ Первое управление/);
  assert.match(html, /Подразделение №99/);
});

test('an unavailable ancestor does not invent an owner or reveal names from another branch', () => {
  const { tree } = catalogHarness({ ...choices, divisions: [choices.divisions[2]] }, [rows[1]]);
  const html = renderToStaticMarkup(nodes(tree()).find(node => node.type === 'li'));
  assert.match(html, /Подразделение: Первое управление/);
  assert.doesNotMatch(html, /Первый департамент|Второй департамент|Подразделение №2/);
});

test('a cycle in available division metadata terminates and includes each name once', { timeout: 1000 }, () => {
  const { tree } = catalogHarness({ ...choices, divisions: [
    { id: '3', name: 'Управление А', parentId: '5' },
    { id: '5', name: 'Управление Б', parentId: '3' },
  ] }, [rows[1]]);
  const html = renderToStaticMarkup(tree());
  assert.equal((html.match(/Управление А/g) ?? []).length, 1);
  assert.equal((html.match(/Управление Б/g) ?? []).length, 1);
});

test('editing a descendant catalogue row preserves its owner rather than the selected parent', async () => {
  const { tree, writes } = catalogHarness();
  const child = nodes(tree()).find(node => node.type === 'li' && node.key === '2');
  const edit = nodes(child).find(node => node.props.children === 'Изменить');
  edit.props.onClick();
  const updated = tree();
  const form = nodes(updated).find(node => node.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].divisionId, '3');
});
