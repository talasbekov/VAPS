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
    react: { ...React, useEffect() {}, useState(initial) {
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
    } }).outputText, { exports, require: load, URLSearchParams, Set, Map, Error });
    return exports;
  }
  return { load, loadActual: name => { delete deps[name]; return load(name); }, render: fn => { cursor = 0; return fn(); } };
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

for (const authorized of [false, true]) test(`first assignment supplies an inline setup only for a catalog manager (${authorized})`, () => {
  const h = harness({
    '@/components/ui/dialog': { Dialog: 'div', DialogContent: 'div', DialogHeader: 'header', DialogTitle: 'h2' },
    './CombatLocationFields': { CombatLocationFields: 'location' },
    './CombatFirstSetup': { CombatFirstSetup: 'first-setup' },
    '@/hooks/use-combat-duty': { useCombatRead: () => ({ data: { results: [] } }), useCombatRefresh: () => async () => {} },
    '@/lib/ops-api': { opsApiClient: {} },
  });
  const { CombatGroupForm } = h.load('@/features/combat-duty/ui/CombatGroupForm');
  const tree = h.render(() => CombatGroupForm({ date: '2026-11-05', divisionId: '2',
    choices: { groups: [], types: [], routes: [], places: [], events: [] },
    onClose() {}, onConfigure: authorized ? () => {} : undefined }));
  const all = nodes(tree);
  assert.equal(all.some(n => n.type === 'first-setup'), authorized);
  assert.equal(all.some(n => n.type === 'select'), false, 'missing catalogues must not leave empty selectors');
  assert.equal(all.some(n => n.props.children === 'Далее: люди'), false, 'no dead-end disabled next button');
  if (!authorized) assert.match(renderToStaticMarkup(tree), /Обратитесь к ответственному/);
});

test('refreshing a newly created group never creates it twice and retains the chosen owner', async () => {
  const writes = [], selected = [];
  let failures = true;
  const h = harness({
    '@/hooks/use-combat-duty': { useCombatRefresh: () => async () => { if (failures) throw Error('Сеть недоступна'); } },
    '@/lib/ops-api': { opsApiClient: { post: async (path, body) => { writes.push({ path, body }); return { id: '8', ...body }; } } },
  });
  const { CombatFirstSetup } = h.load('@/features/combat-duty/ui/CombatFirstSetup');
  const tree = () => h.render(() => CombatFirstSetup({ divisionId: '2', kind: 'groups', onCreated: row => selected.push(row.id), onConfigure() {} }));
  nodes(tree()).find(n => n.props['aria-label'] === 'Название первой группы').props.onChange({ target: { value: 'Патруль' } });
  nodes(tree()).find(n => n.props.children === 'Создать группу').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].body)), { kind: 'groups', divisionId: '2', name: 'Патруль', maxMembers: 4 });
  assert.deepEqual(selected, ['8']);
  assert.match(renderToStaticMarkup(tree()), /Сеть недоступна/);
  failures = false;
  nodes(tree()).find(n => n.props.children === 'Обновить список').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(nodes(tree()).some(n => n.type === 'form'), false, 'setup must not nest a form inside the assignment form');
});

test('board retains acknowledged creations through a choices failure and wizard remount', () => {
  const catalog = { ...choices, groups: [], types: [], places: [], routes: [], events: [], permissions: {
    roster: true, manageCatalogs: true, review: false, rosterDivisionIds: ['2'], manageCatalogsDivisionIds: ['2'], reviewDivisionIds: [] } };
  let unavailable = false;
  const h = harness({
    'next/navigation': { useSearchParams: () => new URLSearchParams('section=combat&date=2026-11-05&combat_division=2'), useRouter: () => ({ replace() {} }) },
    '@/hooks/use-combat-duty': { useCombatRead: path => ({
      data: path.includes('choices/') ? unavailable ? undefined : catalog : path.includes('week/') ? { results: [] } :
        { businessDate: '2026-11-05', summary: {}, shifts: [] }, isError: path.includes('choices/') && unavailable,
      access: { hasPermission: () => false }, refetch() {},
    }) },
    './CombatGroupForm': { CombatGroupForm: 'wizard' }, './CombatCatalogs': {},
    './CombatDutyTable': { CombatDutyTable: 'table' }, './CombatDutyMap': { CombatDutyMap: 'map' },
  });
  const { CombatDutyBoard } = h.loadActual('@/features/combat-duty/ui/CombatDutyBoard');
  const render = () => h.render(CombatDutyBoard);
  const wizard = () => nodes(render()).find(n => n.type === 'wizard');
  nodes(render()).find(n => n.props.children === 'Назначить людей').props.onClick();
  wizard().props.onCatalogCreated('groupId', '8');
  unavailable = true;
  assert.equal(wizard(), undefined, 'protected choices are hidden after failed reads');
  unavailable = false;
  assert.equal(wizard().props.createdSelection.groupId, '8', 'receipt survives the real parent unmount condition');
});

test('a remounted wizard with an acknowledged but unavailable group offers refresh, not another creation', () => {
  const h = harness({
    '@/components/ui/dialog': { Dialog: 'div', DialogContent: 'div', DialogHeader: 'header', DialogTitle: 'h2' },
    './CombatLocationFields': { CombatLocationFields: 'location' }, './CombatFirstSetup': { CombatFirstSetup: 'first-setup' },
    '@/hooks/use-combat-duty': { useCombatRead: () => ({ data: { results: [] } }), useCombatRefresh: () => async () => {} },
    '@/lib/ops-api': { opsApiClient: {} },
  });
  const { CombatGroupForm } = h.load('@/features/combat-duty/ui/CombatGroupForm');
  const tree = h.render(() => CombatGroupForm({ date: '2026-11-05', divisionId: '2',
    choices: { groups: [], types: [], routes: [], places: [], events: [] }, createdSelection: { groupId: '8' }, onClose() {}, onConfigure() {} }));
  assert.equal(nodes(tree).some(n => n.type === 'first-setup'), false);
  assert.ok(nodes(tree).some(n => n.props.children === 'Обновить список'));
});
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

test('combat managers can open both entry routes without unrelated duty permissions', () => {
  const h = harness();
  const { moduleOpenFor } = h.load('@/entities/portal-access');
  for (const permission of ['duty.combat.manage', 'duty.roster', 'duty.catalog.manage']) {
    for (const route of ['/security-ops/combat-duty', '/security-ops/duty-register']) {
      assert.equal(moduleOpenFor(route, code => code === permission), true, `${permission}: ${route}`);
    }
  }
  assert.equal(moduleOpenFor('/security-ops/combat-duty', () => false), false);
});

test('combat actions require the server capability as well as its subdivision scope', () => {
  const granted = new Set(['duty.manage', 'status.view']);
  const permissions = { roster: true, review: false, manageCatalogs: true,
    rosterDivisionIds: ['2'], reviewDivisionIds: null, manageCatalogsDivisionIds: ['2'] };
  const h = harness({
    react: { ...React, useState: value => [value, () => {}], useEffect() {} },
    'next/navigation': { useSearchParams: () => new URLSearchParams('section=combat&date=2026-11-03&combat_division=4'), useRouter: () => ({ replace() {} }) },
    '@/hooks/use-combat-duty': { useCombatRead: path => ({ data: path.includes('choices/')
      ? { ...choices, permissions, groups: [], types: [], places: [], routes: [], events: [] }
      : path.includes('week/') ? { results: [] }
      : path.includes('strength-report/') ? { totals: { list_total: 0, columns: {} } }
      : { businessDate: '2026-11-03', summary: { totalGroups: 1, formedGroups: 1, people: 1, vehicles: 0, awaitingReview: 1, activeGroups: 0, reserveGroups: 0 }, shifts: [{ id: '1' }] },
      access: { hasPermission: code => granted.has(code) } }) },
    './CombatGroupForm': {}, './CombatCatalogs': {}, './CombatDutyTable': { CombatDutyTable: 'combat-table' }, './CombatDutyMap': { CombatDutyMap: 'combat-map' },
  });
  const { CombatDutyBoard } = h.loadActual('@/features/combat-duty/ui/CombatDutyBoard');
  const expenseLinks = () => nodes(h.render(CombatDutyBoard)).filter(node => node.props.children === 'Открыть ежедневный расход');
  assert.equal(expenseLinks().length, 0, 'aggregate readership does not authorize the expense workspace');
  granted.add('forces.allocate');
  assert.equal(expenseLinks()[0].props.href, '/employees/?view=daily&businessDate=2026-11-03');
  const button = label => nodes(h.render(CombatDutyBoard)).find(node => node.props.children === label);
  assert.equal(button('Назначить людей').props.disabled, true, 'readable foreign division is not writable');
  assert.equal(button('Справочники подразделения').props.disabled, true, 'catalog write scope is independent of read scope');
  const capability = () => nodes(h.render(CombatDutyBoard)).find(node => node.type === 'combat-table').props.canFor;
  assert.equal(capability()('review', '2'), false, 'ordinary duty.manage cannot enable HQ review');
  assert.equal(capability()('roster', '2'), true);
  assert.equal(capability()('roster', '4'), false);
  permissions.review = true;
  permissions.reviewDivisionIds = ['2'];
  assert.equal(capability()('review', '2'), true);
  assert.equal(capability()('review', '4'), false);
  permissions.reviewDivisionIds = null;
  assert.equal(capability()('review', '4'), true);
});

test('the workdesk exposes duties for a dedicated combat manager', () => {
  const h = harness();
  const { portalWorkspace } = h.load('@/features/portal-workspace/model');
  const workspace = portalWorkspace({ permissions: new Set(['duty.combat.manage']), roles: [],
    hasPermission: code => code === 'duty.combat.manage', hasGlobalPermission: () => false,
    isLoading: false, error: null });
  assert.ok([...workspace.primary, ...workspace.more].some(task => task.href.startsWith('/security-ops/duty-register')));
});

test('calendar combat assignments retain historical place and only link for an authorized reader', () => {
  let allowed = false;
  const assignment = { kind: 'GROUP', group_id: '7', group_name: 'Группа 7', shift_id: '9',
    business_date: '2026-11-03', division_id: '2', location: { kind: 'POINT', latitude: 51, longitude: 71 },
    location_label: 'Сохранённая точка', object_id: null, post_id: null, event_id: null, event_name: null, automatic: true };
  const h = harness({
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, error: null, hasPermission: code => allowed && code === 'duty.combat.manage' }) },
    '@/hooks/use-status-calendar': { useStatusCalendarDay: () => ({ data: {
      groups: Object.fromEntries(['on_duty', 'on_event', 'absent'].map(key => [key, { count: key === 'on_duty' ? 1 : 0, hasMore: false,
        employees: key === 'on_duty' ? [{ id: '3', name: 'Сотрудник', rank: '', division: null, status: { code: 'ON_DUTY', name: 'Дежурит' }, combat_assignment: assignment }] : [] }])),
      inService: 0, total: 1 }, isLoading: false, isError: false }) },
  });
  const { StatusDayPanel } = h.load('@/widgets/status-calendar/ui/StatusDayPanel');
  const html = () => renderToStaticMarkup(React.createElement(StatusDayPanel, { date: '2026-11-03' }));
  assert.match(html(), /Группа 7/);
  assert.match(html(), /Сохранённая точка/);
  assert.doesNotMatch(html(), /href=/);
  allowed = true;
  assert.match(html(), /section=combat/);
  assert.match(html(), /combat_shift=9/);
});

test('offline map navigation cannot submit an enclosing combat group form', () => {
  const modules = harness();
  const h = harness({
    react: { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect() {}, useRef: initial => ({ current: initial }), useMemo: calculate => calculate() },
    '../model/geometry': modules.load('@/features/offline-map/model/geometry'),
    '../model/viewport': modules.load('@/features/offline-map/model/viewport'),
    '../model/asset': { peekAstanaMapAsset: () => null },
  });
  const Map = h.load('@/features/offline-map/ui/OfflineAstanaMap').default;
  const tree = Map({ markers: [], onSelect() {}, onPoint() {}, locating: true });
  const all = nodes(tree);
  for (const label of ['Отдалить карту', 'Приблизить карту']) {
    assert.equal(all.some(node => node.props['aria-label'] === label), false, label);
  }
  assert.equal(all.some(node => node.props.children === 'Показать точки'), false);
  assert.equal(all.some(node => node.type === 'form'), false, 'map must not create an invalid nested form');
  const input = all.find(node => node.props['aria-label'] === 'Поиск улицы или района');
  const enter = new Event('keydown', { cancelable: true });
  Object.defineProperty(enter, 'key', { value: 'Enter' });
  input.props.onKeyDown?.(enter);
  assert.equal(enter.defaultPrevented, true, 'search Enter must not submit the combat form');
});
