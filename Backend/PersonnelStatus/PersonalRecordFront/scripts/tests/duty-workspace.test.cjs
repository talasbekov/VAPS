const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
const source = fs.readFileSync(path.join(__dirname, '../../features/duty-register/model/workspace.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exported, URLSearchParams, Date });
const { dutyWorkspaceSection, dutyWorkspaceHref, validDutyDate, dutyRosterFilters, dutyRosterFilterValues, shiftDutyDate, serverDutyDate } = exported;

test('journal opens composition while existing filtered and record links retain control', () => {
  assert.equal(dutyWorkspaceSection(new URLSearchParams()), 'roster');
  for (const query of ['from=2026-10-16&to=2026-10-16', 'record=DISPATCH%3A9007199254740993', 'view=employees', 'attention=1', 'source=PLAN', 'search=ГБР']) {
    assert.equal(dutyWorkspaceSection(new URLSearchParams(query)), 'records', query);
  }
  assert.equal(dutyWorkspaceSection(new URLSearchParams('section=roster&from=2026-10-16')), 'roster');
});

test('section navigation keeps dates and independent record filters without mutating input', () => {
  const params = new URLSearchParams('date=2026-10-16&division_id=9007199254740993&search=Пост+2');
  const href = dutyWorkspaceHref('shifts', params);
  const next = new URLSearchParams(href.split('?')[1]);
  assert.equal(next.get('section'), 'shifts');
  assert.equal(next.get('date'), '2026-10-16');
  assert.equal(next.get('division_id'), '9007199254740993');
  assert.equal(next.get('search'), 'Пост 2');
  assert.equal(params.has('section'), false);
});

test('moving from composition to control anchors the same business day', () => {
  const href = dutyWorkspaceHref('records', new URLSearchParams('section=roster&date=2026-10-16'));
  const next = new URLSearchParams(href.split('?')[1]);
  assert.equal(next.get('from'), '2026-10-16');
  assert.equal(next.get('to'), '2026-10-16');
  assert.equal(dutyWorkspaceSection(next), 'records');
});

test('legacy destinations select composition or shifts and preserve the original date', () => {
  for (const section of ['roster', 'shifts']) {
    const href = dutyWorkspaceHref(section, new URLSearchParams('date=2026-10-16'));
    assert.equal(href, `/security-ops/duty-register/?date=2026-10-16&section=${section}`);
  }
});

test('a one-day control link opens composition for the same day', () => {
  const next = new URLSearchParams(dutyWorkspaceHref('roster', new URLSearchParams('from=2026-10-15&to=2026-10-15&record=LOG%3A17')).split('?')[1]);
  assert.equal(next.get('date'), '2026-10-15');
  assert.equal(next.get('record'), 'LOG:17');
});

test('date validation rejects impossible days and zero years without timezone conversion', () => {
  for (const day of ['', '2026-02-29', '2026-04-31', '0000-01-01', '2026-1-1', 'not-a-date']) assert.equal(validDutyDate(day), false, day);
  for (const day of ['2024-02-29', '2026-10-16', '0001-01-01', '9999-12-31']) assert.equal(validDutyDate(day), true, day);
});

test('composition filters survive control navigation and preserve imported identifiers', () => {
  const filters = dutyRosterFilters(new URLSearchParams('roster_search=Пост+2&roster_division=9007199254740993&roster_placement=unassigned&roster_page=3&search=ГБР'));
  assert.equal(filters.search, 'Пост 2');
  assert.equal(filters.division, '9007199254740993');
  assert.equal(filters.placement, 'unassigned');
  assert.equal(filters.page, 3);
  const params = new URLSearchParams({ date: '2026-10-16', ...dutyRosterFilterValues(filters) });
  const control = new URLSearchParams(dutyWorkspaceHref('records', params).split('?')[1]);
  const back = new URLSearchParams(dutyWorkspaceHref('roster', control).split('?')[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(dutyRosterFilters(back))), JSON.parse(JSON.stringify(filters)));
  assert.equal(dutyWorkspaceSection(new URLSearchParams(dutyRosterFilterValues(filters))), 'roster');
});

test('invalid filter URLs are bounded and resetting removes only composition filters', () => {
  const filters = dutyRosterFilters(new URLSearchParams('roster_placement=bogus&roster_page=Infinity&roster_division=1e6'));
  assert.equal(filters.placement, 'all'); assert.equal(filters.page, 1); assert.equal(filters.division, '');
  const next = new URLSearchParams(dutyWorkspaceHref('roster', new URLSearchParams('record=LOG%3A17&search=ГБР&roster_page=3'), dutyRosterFilterValues({ search: '', division: '', placement: 'all', page: 1 })).split('?')[1]);
  assert.equal(next.has('roster_page'), false);
  assert.equal(next.get('search'), 'ГБР'); assert.equal(next.get('record'), 'LOG:17');
});

test('server no-department sentinel remains a selectable shareable roster filter', () => {
  const filters = dutyRosterFilters(new URLSearchParams('roster_division=0'));
  assert.equal(filters.division, '0');
  const next = new URLSearchParams(dutyWorkspaceHref('roster', new URLSearchParams(), dutyRosterFilterValues(filters)).split('?')[1]);
  assert.equal(dutyRosterFilters(next).division, '0');
});

test('changing composition day advances a linked one-day control period and closes its old record', () => {
  const next = new URLSearchParams(dutyWorkspaceHref('roster', new URLSearchParams('date=2026-10-16&from=2026-10-16&to=2026-10-16&record=LOG%3A17&roster_page=2'), { date: '2026-10-17' }).split('?')[1]);
  assert.equal(next.get('from'), '2026-10-17'); assert.equal(next.get('to'), '2026-10-17');
  assert.equal(next.has('record'), false); assert.equal(next.has('roster_page'), false);
  const range = new URLSearchParams(dutyWorkspaceHref('roster', new URLSearchParams('date=2026-10-16&from=2026-10-01&to=2026-10-31'), { date: '2026-10-17' }).split('?')[1]);
  assert.equal(range.get('from'), '2026-10-01'); assert.equal(range.get('to'), '2026-10-31');
});

test('date shortcuts use civil days and the server timezone without workstation time', () => {
  assert.equal(shiftDutyDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDutyDate('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDutyDate('0001-01-01', -1), null);
  assert.equal(shiftDutyDate('9999-12-31', 1), null);
  assert.equal(shiftDutyDate('2026-02-29', 1), null);
  assert.equal(serverDutyDate('2026-10-15T21:30:00Z', 'Asia/Qyzylorda'), '2026-10-16');
  assert.equal(serverDutyDate('2026-10-15T21:30:00Z', 'America/Los_Angeles'), '2026-10-15');
  assert.equal(serverDutyDate('broken', 'Asia/Qyzylorda'), null);
  assert.equal(serverDutyDate('2026-10-15T21:30:00Z', 'unknown'), null);
});

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const journalData = { period: { from: '2026-10-16', to: '2026-10-16' }, generated_at: '2026-10-16T10:00:00+05:00', time_zone: 'Asia/Qyzylorda',
  rows: [], filters: { divisions: [{ id: 4, name: 'Отдел' }], employees: [{ employee_id: 7, employee_name: 'Сотрудник' }] } };
function uiHarness(overrides = {}) {
  const slots = []; let cursor = 0;
  const deps = {
    react: { ...React, useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    }, useEffect: fn => fn(), useRef: initial => ({ current: initial }), useTransition: () => [false, fn => fn()] },
    '@/components/ui/button': { Button: 'button' },
    './DutyExecutionTimeline': { DutyExecutionBadge: () => null, DutyExecutionTimeline: () => null },
    ...overrides,
  };
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (!name.startsWith('@/')) return require(name);
    const base = path.join(__dirname, '../..', name.slice(2));
    const file = [base + '.tsx', base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw Error('Missing module ' + name);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: load, URLSearchParams, Date, Intl, BigInt,
      window: { addEventListener() {}, removeEventListener() {} } });
    return exports;
  }
  return { load, render: fn => { cursor = 0; return fn(); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join('');
  return tree?.props ? content(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function filterHarness(query = '', busy = false) {
  const h = uiHarness(); const applied = [];
  const props = { params: new URLSearchParams(query), data: journalData, kinds: [], busy, onApply: value => applied.push(value) };
  const Filters = h.load('@/features/duty-register/ui/DutyRegisterFilters').DutyRegisterFilters;
  const tree = () => h.render(() => Filters(props));
  const input = label => nodes(tree()).find(node => node.type === 'label' && content(node).startsWith(label))?.props.children.find?.(child => child?.props?.onChange);
  return { tree, applied, input, props, details: () => nodes(tree()).find(node => node.type === 'details'),
    button: label => nodes(tree()).find(node => node.type === 'button' && content(node) === label) };
}

test('journal keeps dates, attention and search outside its initially collapsed optional filters', () => {
  const f = filterHarness(); const disclosure = f.details();
  assert.ok(disclosure, 'optional filters must be disclosed together');
  assert.equal(disclosure.props.open, false);
  assert.equal(content(nodes(disclosure).find(node => node.type === 'summary')), 'Дополнительные фильтры · 0');
  assert.deepEqual(nodes(disclosure).filter(node => node.type === 'select').map(node => node.props.value), ['', '', '', '', '']);
  for (const label of ['С даты', 'По дату включительно', 'Отметки контроля', 'Поиск по записям']) {
    assert.ok(f.input(label), label);
    assert.equal(nodes(disclosure).some(node => node.type === 'label' && content(node).startsWith(label)), false, label);
  }
});

test('valid applied optional selections open the disclosure even when choices are absent', () => {
  const f = filterHarness('kind=ARCHIVE&state=ACTIVE&source=STATUS&division_id=9007199254740993&employee_id=7');
  assert.equal(f.details()?.props.open, true);
  assert.equal(content(nodes(f.details()).find(node => node.type === 'summary')), 'Дополнительные фильтры · 5');
  const invalid = filterHarness('state=bogus&source=bogus&division_id=0&employee_id=9223372036854775808');
  assert.equal(invalid.details()?.props.open, false);
  assert.equal(content(nodes(invalid.details()).find(node => node.type === 'summary')), 'Дополнительные фильтры · 0');
  assert.equal(filterHarness('kind=__missing__').details()?.props.open, true);
});

test('closing optional filters preserves every draft field on apply and period presets', () => {
  const f = filterHarness();
  for (const [label, value] of [['С даты', '2026-10-09'], ['По дату включительно', '2026-10-16'], ['Вид дежурства', '__missing__'], ['Состояние', 'ACTIVE'], ['Источник', 'STATUS'], ['Подразделение', '4'], ['Сотрудник', '7'], ['Отметки контроля', 'ANY'], ['Поиск по записям', 'Пост 2']]) {
    f.input(label).props.onChange({ target: { value } });
  }
  assert.ok(f.details(), 'optional filters remain mounted');
  f.details().props.onToggle({ currentTarget: { open: false } });
  f.tree().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(f.applied[0])), { from: '2026-10-09', to: '2026-10-16', kind: '__missing__', state: 'ACTIVE', source: 'STATUS', division_id: '4', employee_id: '7', attention: 'ANY', search: 'Пост 2' });
  f.button('7 дней').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.applied[1])), { ...f.applied[0], from: '2026-10-10', to: '2026-10-16' });
  f.button('Сбросить отбор').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.applied[2])), { from: '2026-10-10', to: '2026-10-16', kind: '', state: '', source: '', division_id: '', employee_id: '', attention: '', search: '' });
});

test('optional disclosure preserves the inclusive 366-day validation and pending apply guard', () => {
  const f = filterHarness('from=2025-10-16&to=2026-10-16');
  assert.equal(f.button('Применить фильтры').props.disabled, false);
  f.input('С даты').props.onChange({ target: { value: '2025-10-15' } });
  assert.equal(f.button('Применить фильтры').props.disabled, true);
  f.tree().props.onSubmit({ preventDefault() {} }); assert.equal(f.applied.length, 0);
  f.props.busy = true;
  f.input('С даты').props.onChange({ target: { value: '2026-10-16' } });
  f.tree().props.onSubmit({ preventDefault() {} }); assert.equal(f.applied.length, 0);
});

test('empty journal only names the currently available creation or recovery action', () => {
  const Rows = uiHarness().load('@/features/duty-register/ui/DutyRegisterResults').DutyRegisterRows;
  const html = emptyAction => renderToStaticMarkup(Rows({ rows: [], zone: journalData.time_zone, busy: false, emptyAction, onOpen() {} }));
  for (const action of [null, 'create', 'recover']) assert.match(html(action), /Измените период или сбросьте отбор/);
  assert.doesNotMatch(html(null), /Добавить запись|Проверить предыдущее сохранение|только.*чтени/i);
  assert.match(html('create'), /Добавить запись/);
  assert.match(html('recover'), /Проверить предыдущее сохранение/);
  assert.doesNotMatch(html('recover'), /Добавить запись/);
});

test('journal passes header availability to the empty result across recovery and refresh failures', () => {
  const state = { canCreate: true, pending: false, failed: false, fetching: false };
  const h = uiHarness({
    'next/navigation': { useSearchParams: () => new URLSearchParams('from=2026-10-16&to=2026-10-16'), useRouter: () => ({ replace() {} }) },
    'next/link': { default: 'a' }, '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/hooks/use-duty-register': { useDutyRegisterAccess: () => ({ allowed: true, canCreate: state.canCreate, actor: 'actor', scope: 'scope', hasPermission: () => false }),
      useDutyRegister: () => ({ visibleData: { ...journalData, pagination: { count: 0 } }, isError: state.failed, isFetching: state.fetching }),
      useDutyKinds: () => ({}), useInvalidateDutyRegister: () => () => {} },
    '@/components/ops-permissions-unavailable': { isPermissionsCheckFailure: () => false },
    '@/components/ops-access-denied': {}, '@/components/load-failure': { LoadFailure: 'LoadFailure' },
    './DutyRegisterFilters': { DutyRegisterFilters: 'DutyRegisterFilters' },
    './DutyRegisterAppliedFilters': { DutyRegisterAppliedFilters: 'DutyRegisterAppliedFilters' },
    './DutyRegisterResults': { DutyRegisterRows: 'DutyRegisterRows', DutyRegisterSummary: 'DutyRegisterSummary' },
    './DutyRegisterGroups': {}, './DutyLogForm': {}, './DutyRecordDialog': {},
    '../model/pending-creation': { readPendingCreation: () => state.pending, PENDING_DUTY_CREATION_EVENT: 'pending' }, '../model/templates': {},
  });
  const Journal = h.load('@/features/duty-register/ui/DutyJournalRecords').DutyJournalRecords;
  const tree = () => { h.render(Journal); return h.render(Journal); };
  const action = () => nodes(tree()).find(node => node.type === 'DutyRegisterRows').props.emptyAction;
  assert.equal(action(), 'create');
  state.canCreate = false; assert.equal(action(), null);
  state.pending = true; assert.equal(action(), 'recover');
  state.failed = true; assert.equal(action(), null);
  state.failed = false; state.fetching = true; assert.equal(action(), null);
});
