const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function exportsOfModel() {
  const exports = {};
  const file = path.join(__dirname, 'scene3d-layout.ts');
  assert.ok(fs.existsSync(file), '3D hierarchy model must exist');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  return exports;
}
const model = () => exportsOfModel().buildSceneLayout;
const counts = { staff_units_count: 12, employees_count: 9, vacancies_count: 3 };
const empty = () => ({ scope_division: null, summary: counts, departments: [], directorates: [], divisions: [] });

test('null divisions never become invented 3D identities and are counted for the table fallback', () => {
  const units = [
    { id: 1, division: null, employees: [] },
    { id: 2, division: null, employees: [{ employee: { id: '9007199254740993' } }] },
    { id: 3, division: { id: 30, name: 'Управление' }, employees: [] },
  ];
  const layout = model()(empty(), units);
  assert.deepEqual(Array.from(layout.nodes, node => node.id), [30]);
  assert.equal(layout.unassignedStaffCount, 2);
  assert.equal(units[0].division, null);
});
test('repeated unit names connect by full path and preserve server counts', () => {
  const stats = empty();
  stats.departments = [1, 2].map(id => ({ department_id: id, department_name: 'Департамент ' + id, ancestors: [], ...counts }));
  stats.directorates = [1, 2].map(id => ({ directorate_id: id + 10, directorate_name: 'Управление', ancestors: ['Департамент ' + id], ...counts }));
  stats.divisions = [1, 2].map(id => ({ division_id: id + 20, division_name: 'Отдел', ancestors: ['Департамент ' + id, 'Управление'], ...counts }));
  const layout = model()(stats, []);
  assert.equal(layout.nodes.length, 6);
  assert.equal(layout.nodes.find(n => n.id === 21).parentId, 11);
  assert.equal(layout.nodes.find(n => n.id === 22).parentId, 12);
  assert.equal(layout.nodes.find(n => n.id === 1).employees, 9);
  assert.equal(layout.edges.length, 4);
});
test('null scope, orphans and staff-only divisions are retained without invented counts', () => {
  const stats = empty();
  stats.divisions = [{ division_id: 3, division_name: 'Отдел', ancestors: ['Недоступный родитель'], ...counts }];
  const layout = model()(stats, [{ id: 50, division: { id: 4, name: 'Импортированное подразделение' }, employees: [] }]);
  assert.equal(layout.nodes.length, 2);
  assert.equal(layout.edges.length, 0);
  assert.equal(layout.nodes.find(n => n.id === 4).employees, null);
  assert.equal(layout.nodes.find(n => n.id === 4).source, 'staff');
  assert.ok(layout.nodes.every(n => n.position.every(Number.isFinite)));
});
test('ambiguous paths never attach people to an arbitrary duplicate parent', () => {
  const stats = empty();
  stats.departments = [1, 2].map(id => ({ department_id: id, department_name: 'Одинаковое имя', ancestors: [], ...counts }));
  stats.divisions = [{ division_id: 3, division_name: 'Отдел', ancestors: ['Одинаковое имя'], ...counts }];
  const layout = model()(stats, []);
  assert.equal(layout.nodes.find(n => n.id === 3).parentId, null);
  assert.equal(layout.nodes.length, 3);
});
test('empty and large structures have finite distinct positions and stable identity', () => {
  assert.equal(model()(empty(), []).nodes.length, 0);
  const stats = empty();
  stats.divisions = Array.from({ length: 240 }, (_, id) => ({ division_id: id + 1, division_name: 'Отдел ' + id, ancestors: [], ...counts }));
  const layout = model()(stats, []);
  assert.equal(layout.nodes.length, 240);
  assert.equal(new Set(layout.nodes.map(n => n.position.join(','))).size, 240);
  assert.ok(layout.radius > 0 && Number.isFinite(layout.radius));
  assert.ok(layout.nodes.every(n => n.position.every(Number.isFinite)));
});

const family = () => {
  const stats = empty();
  stats.scope_division = { id: 90, name: 'Service', division_type: 'service' };
  stats.departments = [1, 2].map(id => ({ department_id: id, department_name: 'Department ' + id, ancestors: ['Service'], ...counts }));
  stats.directorates = [{ directorate_id: 11, directorate_name: 'Directorate', ancestors: ['Service', 'Department 1'], ...counts }];
  stats.divisions = [{ division_id: 21, division_name: 'Section', ancestors: ['Service', 'Department 1', 'Directorate'], ...counts }];
  return stats;
};

const departmentsFamily = (size = 12) => {
  const stats = empty();
  stats.scope_division = { id: 90, name: 'Service', division_type: 'service' };
  stats.departments = Array.from({ length: size }, (_, index) => ({ department_id: index + 1, department_name: 'Department ' + (index + 1), ancestors: ['Service'], ...counts }));
  stats.directorates = stats.departments.flatMap(row => Array.from({ length: 4 }, (_, index) => ({ directorate_id: 100 + row.department_id * 4 + index, directorate_name: 'Directorate ' + index, ancestors: ['Service', row.department_name], ...counts })));
  return stats;
};

for (const size of [1, 2, 5, 12, 17, 40]) test(`${size} departments share exactly one generation without wrapping`, () => {
  const full = model()(departmentsFamily(size), []);
  const initial = exportsOfModel().selectSceneTree(full.nodes);
  assert.equal(full.nodes.length, size * 5 + 1);
  assert.equal(initial.nodes.length, size + 1);
  assert.equal(initial.edges.length, size);
  const departments = initial.nodes.filter(node => node.kind === 'department');
  assert.equal(new Set(departments.map(node => node.position[1])).size, 1);
  assert.equal(new Set(departments.map(node => node.position[2])).size, 1);
  for (const a of initial.nodes) for (const b of initial.nodes) if (a.id !== b.id) {
    assert.ok(Math.abs(a.position[0] - b.position[0]) >= 13 || Math.abs(a.position[1] - b.position[1]) >= 7, 'front-view plaques must not overlap');
  }
});

test('opening the third department centers its children directly underneath and separates neighboring branches', () => {
  const full = model()(departmentsFamily(), []);
  const { selectSceneTree } = exportsOfModel();
  const initial = selectSceneTree(full.nodes);
  const expanded = selectSceneTree(full.nodes, [90, 3]);
  assert.equal(expanded.nodes.length, 17);
  assert.equal(expanded.edges.length, 16);
  for (const node of initial.nodes) assert.ok(expanded.nodes.some(row => row.id === node.id));
  for (const open of [[90, 3], [90, 2, 3, 7], full.nodes.map(node => node.id)]) {
    const layout = selectSceneTree(full.nodes, open);
    for (const parent of layout.nodes) {
      const children = layout.nodes.filter(node => node.parentId === parent.id);
      if (!children.length) continue;
      const xs = children.map(node => node.position[0]);
      assert.equal(parent.position[0], (Math.min(...xs) + Math.max(...xs)) / 2, 'parent centered over its actual children');
      assert.equal(new Set(children.map(node => node.position[1])).size, 1);
      assert.ok(children.every(node => node.position[1] < parent.position[1] - 7));
    }
    for (const a of layout.nodes) for (const b of layout.nodes) if (a.id !== b.id) {
      assert.ok(Math.abs(a.position[0] - b.position[0]) >= 14 || Math.abs(a.position[1] - b.position[1]) >= 7, 'cards must not overlap');
    }
    const departments = layout.nodes.filter(node => node.kind === 'department');
    assert.equal(new Set(departments.map(node => node.position[1])).size, 1);
  }
});
test('real scope root connects the complete family without fabricated counts or duplicate IDs', () => {
  const layout = model()(family(), [{ division: { id: 90, name: 'Service' }, employees: [] }]);
  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.nodes.find(n => n.id === 1).parentId, 90);
  assert.equal(layout.nodes.find(n => n.id === 90).employees, 9);
  assert.equal(layout.edges.length, 4);
});

test('uneven nested branches reserve separate intervals and collapse deterministically', () => {
  const stats = departmentsFamily(7);
  stats.directorates = stats.directorates.filter(row => row.directorate_id % 3 !== 0);
  stats.divisions = Array.from({ length: 9 }, (_, index) => ({ division_id: 500 + index, division_name: 'Section ' + index, ancestors: ['Service', 'Department 3', 'Directorate 0'], ...counts }));
  const { selectSceneTree } = exportsOfModel();
  const full = model()(stats, []);
  const initial = selectSceneTree(full.nodes);
  const open = selectSceneTree(full.nodes, full.nodes.map(row => row.id));
  for (const parent of open.nodes) {
    const children = open.nodes.filter(row => row.parentId === parent.id);
    if (children.length) {
      assert.equal(new Set(children.map(row => row.position[1])).size, 1);
      assert.equal(parent.position[0], (children[0].position[0] + children.at(-1).position[0]) / 2);
    }
  }
  for (const a of open.nodes) for (const b of open.nodes) if (a.id !== b.id && a.position[1] === b.position[1]) assert.ok(Math.abs(a.position[0] - b.position[0]) >= 14);
  assert.deepEqual(selectSceneTree(full.nodes, [90]).nodes, initial.nodes);
});
test('unique real staff service can supply a missing ancestor while ambiguous identities stay disconnected', () => {
  const stats = family(); stats.scope_division = null;
  const roster = [{ division: { id: 90, name: 'Service' }, employees: [] }];
  const layout = model()(stats, roster);
  assert.equal(layout.nodes.find(n => n.id === 1).parentId, 90);
  assert.equal(layout.nodes.find(n => n.id === 90).employees, null);
  const ambiguous = model()(stats, [...roster, { division: { id: 91, name: 'Service' }, employees: [] }]);
  assert.equal(ambiguous.nodes.find(n => n.id === 1).parentId, null);
});
test('progressive expansion retains root, ancestors, siblings and every connecting edge', () => {
  const { selectSceneTree } = exportsOfModel();
  assert.equal(typeof selectSceneTree, 'function', 'connected progressive tree must exist');
  const full = model()(family(), []);
  const initial = selectSceneTree(full.nodes);
  assert.deepEqual(Array.from(initial.nodes, n => n.id).sort((a,b)=>a-b), [1, 2, 90]);
  const expanded = selectSceneTree(full.nodes, [90, 1, 11]);
  assert.equal(expanded.nodes.length, 5);
  assert.equal(expanded.edges.length, 4);
  for (const edge of expanded.edges) {
    const parent = expanded.nodes.find(n => n.id === edge.from);
    const child = expanded.nodes.find(n => n.id === edge.to);
    assert.ok(parent.position[1] > child.position[1], 'parent must be visibly above child');
  }
  const collapsed = selectSceneTree(full.nodes, [90]);
  assert.equal(collapsed.nodes.length, 3);
  const revealed = selectSceneTree(full.nodes, [], 21);
  assert.equal(revealed.nodes.length, 5);
  assert.equal(revealed.edges.length, 4);
});
test('578 units remain discoverable, never paged into disconnected six-card scenes', () => {
  const stats = family();
  stats.divisions = Array.from({length: 574}, (_, i) => ({division_id: i+100, division_name: 'Section '+i, ancestors: ['Service', 'Department 1', 'Directorate'], ...counts}));
  const full = model()(stats, []);
  const { selectSceneTree } = exportsOfModel();
  assert.equal(typeof selectSceneTree, 'function');
  assert.equal(full.nodes.length, 578);
  assert.equal(selectSceneTree(full.nodes).nodes.length, 3);
  const expanded = selectSceneTree(full.nodes, [90, 1, 11]);
  assert.equal(expanded.nodes.length, 578);
  assert.equal(expanded.edges.length, 577);
  assert.equal(new Set(expanded.nodes.map(n=>n.position.join(','))).size, 578);
});

test('canonical parent IDs connect the service omitted from statistics ancestry without importing hidden units', () => {
  const stats = empty();
  stats.scope_division = { id: 1, name: 'Service', division_type: 'organization' };
  stats.departments = [{ department_id: 2, department_name: 'Department', ancestors: [], ...counts }];
  const tree = { id: 1, parent: null, division_type: 'organization', children: [
    { id: 2, parent: 1, division_type: 'department', children: [] },
    { id: 999, parent: 1, division_type: 'department', children: [] },
  ] };
  const layout = model()(stats, [], tree);
  assert.equal(layout.nodes.length, 2);
  assert.equal(layout.nodes.find(n => n.id === 2).parentId, 1);
  assert.equal(layout.nodes.find(n => n.id === 1).kind, 'service');
  assert.equal(layout.edges.length, 1);
});

test('disconnected department roots begin collapsed instead of exploding into hundreds of tiny cards', () => {
  const stats = family(); stats.scope_division = null;
  stats.departments.forEach(row => row.ancestors = []);
  stats.directorates[0].ancestors = ['Department 1'];
  stats.divisions[0].ancestors = ['Department 1', 'Directorate'];
  const full = model()(stats, []);
  const initial = exportsOfModel().selectSceneTree(full.nodes);
  assert.deepEqual(Array.from(initial.nodes, n => n.id), [1, 2]);
});

test('canonical parent IDs override stale name paths and inaccessible parents stay roots', () => {
  const stats = family();
  const tree = { id: 90, parent: null, division_type: 'organization', children: [
    { id: 1, parent: 90, division_type: 'department', children: [] },
    { id: 2, parent: 90, division_type: 'department', children: [
      { id: 11, parent: 2, division_type: 'directorate', children: [] },
    ] },
    { id: 21, parent: 999, division_type: 'division', children: [] },
  ] };
  const layout = model()(stats, [], tree);
  assert.equal(layout.nodes.find(n => n.id === 11).parentId, 2);
  assert.equal(layout.nodes.find(n => n.id === 21).parentId, null);
  assert.equal(layout.nodes.length, 5);
});

test('service, hospital and military ancestors survive without their own staffing rows', () => {
  const stats = empty();
  stats.departments = [{ department_id: 10, department_name: 'Департамент', ancestors: [], ...counts }];
  stats.directorates = [{ directorate_id: 21, directorate_name: '1 управление', ancestors: [], ...counts }];
  stats.divisions = [
    { division_id: 22, division_name: '2 отдел', ancestors: ['1 управление'], ...counts },
    { division_id: 31, division_name: 'Подразделение части', ancestors: [], ...counts },
  ];
  const branch = (id, name, type, parent, children = []) => ({ id, name, division_type: type, parent, children });
  const tree = branch(0, 'Доступные подразделения', 'organization', null, [
    branch(1, 'Служба', 'organization', null, [branch(10, 'Департамент', 'department', 1)]),
    branch(2, 'Госпиталь', 'organization', null, [branch(21, '1 управление', 'directorate', 2, [
      branch(22, '2 отдел', 'division', 21),
    ])]),
    branch(3, 'Воинская часть', 'organization', null, [branch(31, 'Подразделение части', 'division', 3)]),
    branch(999, 'Неиспользуемая ветвь', 'organization', null),
  ]);
  const layout = model()(stats, [], tree);
  assert.deepEqual(Array.from(layout.nodes, node => node.id).sort((a, b) => a - b), [1, 2, 3, 10, 21, 22, 31]);
  assert.equal(layout.nodes.find(node => node.id === 10).parentId, 1);
  assert.equal(layout.nodes.find(node => node.id === 21).parentId, 2);
  assert.equal(layout.nodes.find(node => node.id === 22).parentId, 21);
  assert.equal(layout.nodes.find(node => node.id === 31).parentId, 3);
  for (const id of [1, 2, 3]) {
    const organization = layout.nodes.find(node => node.id === id);
    assert.equal(organization.employees, null);
    assert.equal(organization.staffCount, null);
    assert.equal(organization.vacancies, null);
  }
  assert.deepEqual(Array.from(layout.nodes.find(node => node.id === 22).ancestors), ['Госпиталь', '1 управление']);
  assert.equal(layout.nodes.find(node => node.id === 22).employees, counts.employees_count);
  const overview = exportsOfModel().selectSceneTree(layout.nodes);
  assert.equal(overview.rootCount, 3);
  assert.deepEqual(Array.from(overview.nodes, node => node.id).sort((a, b) => a - b), [1, 2, 3, 10, 21, 31]);
  assert.equal(layout.nodes.some(node => node.id === 0 || node.id === 999), false);
});

test('a canonical ancestor chain includes only authorized parents and disambiguates repeated organization names', () => {
  const stats = empty();
  stats.divisions = [{ division_id: 40, division_name: 'Отдел', ancestors: ['Старое имя'], ...counts }];
  const tree = { id: 0, name: 'Доступные подразделения', parent: null, children: [
    { id: 1, name: 'Организация', division_type: 'organization', parent: null, children: [] },
    { id: 2, name: 'Организация', division_type: 'organization', parent: null, children: [
      { id: 20, name: 'Управление', division_type: 'directorate', parent: 2, children: [
        { id: 40, name: 'Отдел', division_type: 'division', parent: 20, children: [] },
      ] },
    ] },
  ] };
  const layout = model()(stats, [], tree);
  assert.deepEqual(Array.from(layout.nodes, node => node.id).sort((a, b) => a - b), [2, 20, 40]);
  assert.equal(layout.nodes.find(node => node.id === 40).parentId, 20);
  assert.equal(layout.nodes.find(node => node.id === 20).parentId, 2);
  assert.deepEqual(Array.from(layout.nodes.find(node => node.id === 40).ancestors), ['Организация', 'Управление']);
  assert.equal(layout.nodes.find(node => node.id === 20).kind, 'directorate');
});

test('hidden ancestors remain hidden and canonical scope cuts do not display stale ancestor names', () => {
  const stats = empty();
  stats.divisions = [{ division_id: 40, division_name: 'Доступный отдел', ancestors: ['Скрытый госпиталь'], ...counts }];
  const tree = { id: 40, name: 'Доступный отдел', division_type: 'division', parent: null, children: [] };
  const layout = model()(stats, [], tree);
  assert.deepEqual(Array.from(layout.nodes, node => node.id), [40]);
  assert.equal(layout.nodes[0].parentId, null);
  assert.deepEqual(Array.from(layout.nodes[0].ancestors), []);
});
