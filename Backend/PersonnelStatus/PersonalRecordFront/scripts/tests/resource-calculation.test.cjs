const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const exportsModel = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/force-calculation/model.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsModel });
const m = exportsModel;
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return { schemaVersion: 1, groups: [
    { id: 'g1', organization: 'A', callsign: 'One', vehicle: 'Car', vehicleType: 'PASSENGER' },
    { id: 'g2', organization: 'A', callsign: 'Two', vehicle: 'APC', vehicleType: 'ARMORED' },
    { id: 'g3', organization: 'B', callsign: 'Three', vehicle: 'Bus', vehicleType: 'OTHER' },
  ], segments: [{ id: 's1', name: 'Bridge', type: 'Road', pointA: 'A', pointB: 'B' }, { id: 's2', name: 'Square', type: 'Road', pointA: 'B', pointB: 'C' }], routes: [
    { id: 'r1', name: 'One', rows: [{ id: 'a', segmentId: 's1' }, { id: 'b', segmentId: 's2' }] },
    { id: 'r2', name: 'Two', rows: [{ id: 'c', segmentId: 's1', reversed: true }] },
  ], assignments: { s1: 'g1', s2: 'g2' } };
}
test('summary counts unique assigned groups across repeated physical segments', () => {
  const summary = plain(m.summarize(fixture()));
  assert.equal(summary.groups, 2);
  assert.equal(summary.vehicles, 2);
  assert.equal(summary.organizations[0].name, 'A');
  assert.equal(summary.organizations[0].count, 2);
  assert.deepEqual(summary.categories, { PASSENGER: 1, ARMORED: 1, OTHER: 0 });
});
test('removing one shared row retains assignment; removing last use releases it without touching saved input', () => {
  const saved = fixture();
  const first = m.removeRow(saved, 'r1', 'a');
  assert.equal(first.assignments.s1, 'g1');
  const last = m.removeRoute(first, 'r2');
  assert.equal(last.assignments.s1, undefined);
  assert.equal(last.assignments.s2, 'g2');
  assert.equal(saved.routes[0].rows.length, 2);
  assert.equal(saved.assignments.s1, 'g1');
});
test('removing final route clears assignments and permits an empty draft', () => {
  const next = m.removeRoute(m.removeRoute(fixture(), 'r1'), 'r2');
  assert.deepEqual(plain(next.routes), []);
  assert.deepEqual(plain(next.assignments), {});
});
test('group selection keeps current choice and excludes groups used on other segments', () => {
  assert.deepEqual(plain(m.availableGroups(fixture(), 's1')).map(g => g.id), ['g1', 'g3']);
  assert.equal(m.segmentRouteCount(fixture(), 's1'), 2);
});
test('draft includes independent catalogs and assignment maps so cancel restores everything', () => {
  const saved = fixture();
  const draft = m.cloneDocument(saved);
  draft.groups[0].callsign = 'Changed'; draft.segments[0].name = 'Changed';
  draft.routes[0].rows[0].reversed = true; delete draft.assignments.s1;
  assert.equal(saved.groups[0].callsign, 'One');
  assert.equal(saved.segments[0].name, 'Bridge');
  assert.equal(saved.routes[0].rows[0].reversed, undefined);
  assert.equal(saved.assignments.s1, 'g1');
});
test('active route falls back after removal and returns no selection for empty document', () => {
  assert.equal(m.selectedRouteId(fixture(), 'r2'), 'r2');
  assert.equal(m.selectedRouteId(fixture(), 'missing'), 'r1');
  assert.equal(m.selectedRouteId({ routes: [] }, 'r1'), '');
});
test('print completeness rejects empty routes and missing assignments while drafts stay editable', () => {
  assert.ok(m.completionIssues(m.emptyDocument()).length);
  const document = fixture();
  for (const route of document.routes) Object.assign(route, { start: 'A', end: 'B', date: '2026-10-23', time: '10:00' });
  assert.equal(m.completionIssues(document).length, 0);
  delete document.assignments.s1;
  assert.ok(m.completionIssues(document).some(issue => issue.path.includes('assignments')));
});
test('summary distinguishes catalog reserve, selected route coverage and organization vehicle breakdown', () => {
  const document = fixture();
  const global = m.summarize(document);
  assert.equal(global.catalogGroups, 3);
  assert.equal(global.reserveGroups, 1);
  const route = m.summarize(document, 'r2');
  assert.equal(route.rows, 1);
  assert.equal(route.groups, 1);
  assert.equal(route.assignedSegments, 1);
  assert.equal(route.unassignedSegments, 0);
  assert.equal(route.sharedSegments, 1);
  assert.deepEqual(plain(route.organizationVehicles), [{ organization: 'A', vehicle: 'Car', vehicleType: 'PASSENGER', count: 1 }]);
});
test('export completeness requires referenced catalog fields and assigned group fields', () => {
  const document = fixture();
  for (const route of document.routes) Object.assign(route, { start: 'A', end: 'B', date: '2026-10-23', time: '10:00' });
  document.segments[0].pointA = '';
  document.groups[0].vehicle = '';
  const issues = m.completionIssues(document);
  assert.ok(issues.some(issue => issue.path.startsWith('segments')));
  assert.ok(issues.some(issue => issue.path.startsWith('groups')));
});
