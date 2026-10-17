// Regression from audit A9: preserve canonical organization ancestors without staffing rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const front = path.resolve(__dirname, '../../../PersonnelStatus/PersonalRecordFront');
const ts = require(path.join(front, 'node_modules/typescript'));
const model = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(front,
  'features/organization-structure/scene3d-layout.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: model });

test('available hospital and service departments keep their canonical organization parents even without root staffing', () => {
  const counts = { staff_units_count: 2, employees_count: 1, vacancies_count: 1 };
  const stats = { scope_division: null, summary: counts,
    departments: [{ department_id: 10, department_name: 'Департамент службы', ancestors: [], ...counts }],
    directorates: [{ directorate_id: 21, directorate_name: '1 управление госпиталя', ancestors: [], ...counts }],
    divisions: [{ division_id: 22, division_name: '2 отдел', ancestors: ['1 управление госпиталя'], ...counts }],
  };
  const branch = (id, name, kind, parent, children = []) => ({ id, name, division_type: kind, parent, children });
  const tree = branch(0, 'Доступные подразделения', 'organization', null, [
    branch(1, 'Служба', 'organization', null, [branch(10, 'Департамент службы', 'department', 1)]),
    branch(2, 'Госпиталь', 'organization', null, [branch(21, '1 управление госпиталя', 'directorate', 2, [
      branch(22, '2 отдел', 'division', 21),
    ])]),
  ]);
  const layout = model.buildSceneLayout(stats, [], tree);
  const hospital = layout.nodes.find(node => node.id === 2);
  assert.ok(hospital, 'The canonical hospital ancestor must not disappear because it has no staffing row');
  assert.ok(layout.nodes.some(node => node.id === 1), 'The canonical service ancestor must remain available');
  assert.equal(layout.nodes.find(node => node.id === 10).parentId, 1);
  assert.equal(layout.nodes.find(node => node.id === 21).parentId, 2);
  assert.equal(layout.nodes.find(node => node.id === 22).parentId, 21);
  assert.equal(hospital.employees, null, 'Absent aggregate counts stay unknown');
  assert.equal(hospital.staffCount, null);
  assert.equal(layout.nodes.some(node => node.id === 0), false, 'Virtual API forest wrapper is not an organization');
});
