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
