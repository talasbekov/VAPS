const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

const root = path.join(__dirname, '../..');
const markers = new Proxy({}, { get: (_, key) => String(key) });
function harness({ query = '', permissions = ['status.view', 'status.manage', 'status.workspace', 'duty.view'], roles = [], isLoading = false, error = null } = {}) {
  const params = new URLSearchParams(query), navigations = [];
  const access = { roles, permissions: new Set(permissions), globalPermissions: new Set(), isLoading, error,
    allowed: true, scope: 'test', hasPermission: code => permissions.includes('*') || permissions.includes(code),
    hasGlobalPermission: code => permissions.includes('*') || permissions.includes(code) };
  const overrides = {
    react: { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }) },
    'next/link': { default: 'Link' },
    'next/navigation': { useSearchParams: () => params, useRouter: () => ({ replace: href => navigations.push(href) }) },
    'lucide-react': markers,
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/hooks/use-status-calendar': { useStatusCalendarDivisions: () => ({ data: { results: [] }, isLoading: false, isError: false }) },
    '@/hooks/use-duty-register': { useDutyRegisterAccess: () => access, useDutyRoster: () => ({
      visibleData: { business_date: '2026-10-21', departments: [], combat_groups: [], time_zone: 'Asia/Almaty', generated_at: '2026-10-21T03:00:00Z' },
      isLoading: false, isError: false, isFetching: false,
    }) },
    '@/hooks/use-staff-units-page': { useStaffUnitsPage: () => ({ data: { summary: { employees: 0, without_status: 0, overdue: 0, scheduled: 0 } },
      isLoading: false, error: null, isRefetching: false, dataUpdatedAt: 0 }) },
    '@/hooks/use-staff-units-by-directorate': { directorateDenial: () => null },
    '@/features/daily-expense/ui/StatusDetails': { statusPeriod: () => '' },
    '@/features/daily-expense/model/directorate-summary': {},
    '@/hooks/use-department-requests': {},
    '@/widgets/status-calendar': { StatusCalendarBoard: 'StatusCalendarBoard' },
    './StatusMatrix': { StatusMatrix: 'StatusMatrix' }, './StatusDayPanel': { StatusDayPanel: 'StatusDayPanel' },
    './DailyActionQueue': { DailyActionQueue: 'DailyActionQueue' },
  };
  const cache = new Map();
  function load(name, importer) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/components/') || name === '@/features/forces-request-banner/ui/ForcesRequestBanner' ||
        name === '@/features/ops-daily/status-day-close' || name === '@/features/department-requests' ||
        name === '@/features/force-collections' || name === '@/features/daily-expense' ||
        name === '@/features/daily-expense/ui/ResponsibleDailyExpense') return markers;
    if (name.endsWith('.module.css')) return { default: markers };
    if (!name.startsWith('@/') && !name.startsWith('.')) return require(name);
    const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(importer), name);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(fs.existsSync);
    if (!file) return {};
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, URLSearchParams, URL, console, require: id => load(id, file) }, { filename: file });
    return exports;
  }
  return { load: name => load('@/' + name), params, navigations, access };
}
function nodes(tree) {
  const result = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object' || !node.props) return;
    result.push(node); visit(node.props.children);
  }
  visit(tree); return result;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean' || typeof node === 'function') return '';
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
const url = href => new URL(href, 'http://localhost');

test('workspace collection target keeps the selected event instead of an unrelated request or campaign', () => {
  const f = harness(), { workspaceHref } = f.load('features/forces-workspace/model/workspace');
  const next = url(workspaceHref(new URLSearchParams('request=old&campaign=old&tab=table&visit=102&back=stage%3DPLACEMENT'), 'forces', { collection: '9007199254740993' }));
  assert.equal(next.searchParams.get('collection'), '9007199254740993');
  assert.equal(next.searchParams.get('tab'), 'collections');
  assert.equal(next.searchParams.get('request'), null);
  assert.equal(next.searchParams.get('campaign'), null);
  assert.equal(next.searchParams.get('visit'), '102');
  assert.equal(next.searchParams.get('back'), 'stage=PLACEMENT');
});

test('event forces link opens the real collection only with headquarters authority', () => {
  for (const [permissions, expectedTab, collection] of [
    [['forces.command'], 'collections', '9007199254740993'],
    [['forces.allocate'], 'requests', null],
    [['forces.select', 'status.view'], null, null],
  ]) {
    const f = harness({ query: 'visit=102&back=stage%3DPLACEMENT', permissions });
    const { EventForcesLink } = f.load('features/forces-workspace/ui/EventForcesLink');
    assert.equal(typeof EventForcesLink, 'function', 'event-to-forces transition needs a shared permission-aware consumer');
    const tree = EventForcesLink({ eventId: '9007199254740993', children: 'Сбор сил' });
    const next = url(tree.props.href);
    assert.equal(next.searchParams.get('collection'), collection);
    assert.equal(next.searchParams.get('tab'), expectedTab);
    assert.equal(next.searchParams.get('visit'), '102');
  }
  for (const state of [{ permissions: ['event.view'] }, { permissions: ['forces.command'], isLoading: true },
    { permissions: ['forces.command'], error: Error('permission refresh failed') }]) {
    const f = harness(state);
    const { EventForcesLink } = f.load('features/forces-workspace/ui/EventForcesLink');
    assert.equal(EventForcesLink({ eventId: '17', children: 'Сбор сил' }), null);
  }
});

test('an explicitly authorized collection stays reachable with a combined department responsibility', () => {
  const f = harness({ query: 'view=forces&collection=9007199254740993&tab=collections',
    permissions: ['forces.allocate', 'forces.command'], roles: [{ code: 'FORCES_GATHERING_OFFICER', scope_division_id: 2 }] });
  const tree = f.load('features/forces-workspace/ui/ForcesWorkspace').ForcesWorkspace({ role: 'responsible' });
  assert.equal(nodes(tree).some(node => node.type === 'ForceCollectionsTable'), true);
  assert.equal(nodes(tree).some(node => node.type === 'DepartmentRequestsTable'), false);
  const denied = harness({ query: 'view=forces&collection=9007199254740993', permissions: ['forces.allocate'] });
  const other = denied.load('features/forces-workspace/ui/ForcesWorkspace').ForcesWorkspace({ role: 'responsible' });
  assert.equal(nodes(other).some(node => node.type === 'ForceCollectionsTable'), false);
});

test('explicit distribution destinations use headquarters workspace for authorized combined roles', () => {
  for (const code of ['FORCES_GATHERING_OFFICER', 'DEPARTMENT_EXPENSE_OFFICER']) {
    for (const query of ['view=forces&tab=collections', 'view=forces&tab=collections&campaign=9007199254740993', 'campaign=9007199254740993', 'tab=collections']) {
      const f = harness({ query, permissions: ['forces.allocate', 'forces.command', 'status.view'],
        roles: [{ code, scope_division_id: 2 }] });
      const role = f.load('features/forces-workspace/model/workspace').resolveWorkspaceRole(f.access);
      assert.equal(role, code === 'FORCES_GATHERING_OFFICER' ? 'responsible' : 'expense');
      const tree = f.load('features/forces-workspace/ui/ForcesWorkspace').ForcesWorkspace({ role });
      assert.equal(nodes(tree).some(node => node.type === 'ForceCollectionsTable'), true, `${code}: ${query}`);
      assert.equal(nodes(tree).some(node => node.type === 'DepartmentRequestsTable'), false);
      assert.equal(text(nodes(tree).find(node => node.type === 'h1')), 'Распределения');
      assert.equal(nodes(tree).some(node => node.props['aria-label'] === 'Разделы модуля'), false);
    }
  }
});

test('an explicit distribution destination cannot grant headquarters access to department users', () => {
  for (const code of ['FORCES_GATHERING_OFFICER', 'DEPARTMENT_EXPENSE_OFFICER']) {
    for (const query of ['view=forces&tab=collections', 'view=forces&tab=collections&campaign=17', 'campaign=17', 'tab=collections']) {
      const f = harness({ query, permissions: ['forces.allocate', 'status.view'], roles: [{ code, scope_division_id: 2 }] });
      const role = f.load('features/forces-workspace/model/workspace').resolveWorkspaceRole(f.access);
      const tree = f.load('features/forces-workspace/ui/ForcesWorkspace').ForcesWorkspace({ role });
      assert.equal(nodes(tree).some(node => node.type === 'ForceCollectionsTable'), false, `${code}: ${query}`);
      assert.notEqual(text(nodes(tree).find(node => node.type === 'h1')), 'Распределения');
    }
  }
});

test('combined command and department roles keep their ordinary department destinations', () => {
  for (const [code, expectedTitle] of [['FORCES_GATHERING_OFFICER', 'Рабочий стол'], ['DEPARTMENT_EXPENSE_OFFICER', 'Ежедневный расход']]) {
    for (const query of ['', 'view=forces', 'view=forces&tab=requests&request=17']) {
      const f = harness({ query, permissions: ['forces.allocate', 'forces.command', 'status.view'], roles: [{ code, scope_division_id: 2 }] });
      const role = f.load('features/forces-workspace/model/workspace').resolveWorkspaceRole(f.access);
      const tree = f.load('features/forces-workspace/ui/ForcesWorkspace').ForcesWorkspace({ role });
      assert.equal(nodes(tree).some(node => node.type === 'ForceCollectionsTable'), false, `${code}: ${query}`);
      assert.equal(text(nodes(tree).find(node => node.type === 'h1')), query ? 'Сбор сил на ОМ' : expectedTitle);
      if (query) assert.equal(nodes(tree).some(node => node.type === 'DepartmentRequestsTable'), true);
    }
  }
});

test('duty roster links its selected day to the status calendar instead of the expense submission date', () => {
  const f = harness({ query: 'date=2040-03-19' });
  const tree = f.load('features/duty-register/ui/DutyRoster').DutyRoster();
  const link = nodes(tree).find(node => node.type === 'Link' && node.props.href.startsWith('/statuses'));
  assert.ok(link);
  const next = url(link.props.href);
  assert.equal(next.searchParams.get('view'), 'calendar');
  assert.equal(next.searchParams.get('statusDate'), '2040-03-19');
  assert.equal(next.searchParams.get('businessDate'), null);
  assert.match(text(link), /19\.03\.2040/);
});

test('status workspace opens the calendar tab from the roster without treating businessDate as an edit date', () => {
  for (const [query, expected] of [['view=calendar&statusDate=2040-03-19', 'calendar'], ['businessDate=2040-03-19', 'table']]) {
    const f = harness({ query });
    const wrapper = f.load('app/statuses/page').default();
    const screen = nodes(wrapper).find(node => node.type?.name === 'StatusesScreen');
    const tree = screen.type(screen.props);
    const tabs = nodes(tree).find(node => node.type === 'Tabs');
    assert.equal(tabs.props.value ?? tabs.props.defaultValue, expected);
  }
});

test('calendar readers use the explicit selected date and month even when the expense date differs', () => {
  const f = harness({ query: 'view=calendar&statusDate=2040-03-19&businessDate=2026-10-22' });
  const tree = f.load('widgets/status-calendar/ui/StatusCalendarBoard').StatusCalendarBoard();
  const matrix = nodes(tree).find(node => node.type === 'StatusMatrix');
  assert.equal(matrix.props.month, '2040-03');
  assert.equal(matrix.props.selectedDate, '2040-03-19');
  assert.equal(nodes(tree).find(node => node.type === 'StatusDayPanel').props.date, '2040-03-19');
  matrix.props.onSelectDate('2040-03-20');
  assert.equal(f.navigations.length, 1);
  const next = url(f.navigations[0]);
  assert.equal(next.searchParams.get('statusDate'), '2040-03-20');
  assert.equal(next.searchParams.get('businessDate'), '2026-10-22');
});

test('an impossible explicit calendar date is explained instead of silently showing today', () => {
  for (const day of ['2040-02-30', '0000-01-01', '2040-3-19', '2040-03-19T00:00:00Z']) {
    const f = harness({ query: 'view=calendar&statusDate=' + encodeURIComponent(day) });
    const tree = f.load('widgets/status-calendar/ui/StatusCalendarBoard').StatusCalendarBoard();
    assert.equal(nodes(tree).some(node => node.type === 'StatusMatrix'), false);
    assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
    assert.equal(nodes(tree).find(node => node.props['aria-label'] === 'Следующий месяц').props.disabled, true);
  }
});

test('existing calendar status save contract retains the chosen future or past date', () => {
  const f = harness(), { statusStartForSave } = f.load('features/employee-status-update/model/status-action-date');
  assert.equal(statusStartForSave({ mode: 'schedule', today: '2026-10-21', chosenStartDate: new Date('2040-03-19T12:00:00'), inService: false }), '2040-03-19');
  assert.equal(statusStartForSave({ mode: 'change', today: '2026-10-21', initialStartDate: new Date('2026-10-19T12:00:00'), inService: true }), '2026-10-19');
});
