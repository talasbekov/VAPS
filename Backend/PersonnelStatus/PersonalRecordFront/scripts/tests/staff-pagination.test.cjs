const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function client(responses, base = '') {
  const exports = {}, calls = [];
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../lib/api.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, URL, URLSearchParams, console: { log() {}, error() {} },
    require(name) {
      if (name === '@/shared/config/env') return { BACKEND_URL: base };
      if (name === '@/entities/employee/model/photo-src') return { photoSrc: value => value };
      if (name === '@/lib/access-token') return { getAccessToken: async () => 'test-token' };
      // These scenarios exercise GET pagination; write authority has its
      // own real-transport suite and does not restrict read requests.
      if (name === '@/lib/ops-write-authority') return { captureOpsWriteAuthority: () => () => {} };
      throw Error('Unexpected import: ' + name);
    },
    async fetch(url, options) {
      calls.push({ url, authorization: options.headers.Authorization });
      let response = responses.get(url);
      if (!response) throw Error('Unrouted or unexpected request: ' + url);
      options.signal?.throwIfAborted();
      if (typeof response === 'function') response = await response(options);
      return { ok: true, json: async () => structuredClone(response) };
    },
  });
  return { ...exports, api: exports.apiClient, calls };
}
const first = '/api/staff_unit/staff-units/?page_size=500';
const second = '/api/staff_unit/staff-units/?page=2&page_size=500';
const row = id => ({ id, division: { id: 3, name: 'Управление' }, index: id, employee: null, position: null });

test('staff without a division retain their employee in list and tree responses', async () => {
  const employee = { id: '9007199254740993', first_name: 'Имя', last_name: 'Без подразделения' };
  const position = { id: 1, name: 'Инспектор', level: 8 };
  for (const response of [
    { results: [{ ...row(10), division: null, employee, position }], next: null },
    { id: 10, division: null, employees: [{ employee, position, index: 1, vacancy: null }], children: [] },
  ]) {
    const units = await client(new Map([[first, response]])).api.getStaffUnits();
    assert.equal(units.length, 1);
    assert.equal(units[0].division, null);
    assert.equal(units[0].employees[0].employee.id, '9007199254740993');
  }
});

test('unassigned staff form a separate root without inheriting a real division or losing vacancies', () => {
  const h = client(new Map());
  const person = id => ({ position: { id: 1, name: 'Инспектор', level: 8 }, employee: { id, first_name: 'Имя', last_name: 'Фамилия' } });
  const units = [
    { ...row(10), division: null, parent_id: 20, employees: [person('9007199254740993')] },
    { ...row(11), division: null, parent_id: null, employees: [{ ...person(2), employee: null }] },
    { ...row(20), parent_id: null, employees: [person(3)] },
  ];
  const merged = h.mergeStaffUnitsByDivision(units);
  assert.equal(merged.length, 2);
  const unassigned = merged.find(unit => unit.division === null);
  assert.ok(unassigned);
  assert.equal(unassigned.parent_id, null);
  assert.deepEqual(Array.from(unassigned.employees, row => row.employee?.id ?? null), ['9007199254740993', null]);
  const node = h.convertStaffUnitToOrgUnit(unassigned);
  assert.equal(node.name, 'Без подразделения');
  assert.equal(node.divisionId, undefined);
  assert.equal(node.head.id, '9007199254740993');
  assert.equal(node.employees[0].name, 'Вакантная должность');
  assert.equal(units[0].division, null);
});

test('the complete organization converter keeps unassigned and real roots as independent siblings', () => {
  const h = client(new Map());
  for (const [missingId, realId] of [[10, 20], [20, 10]]) {
    const employee = { position: { id: 1, name: 'Инспектор', level: 8 }, employee: { id: '9007199254740993', first_name: 'Имя', last_name: 'Фамилия' } };
    const units = [
      { ...row(missingId), division: null, parent_id: null, employees: [employee] },
      { ...row(realId), parent_id: null, employees: [] },
    ];
    const root = h.convertStaffUnitsResponseToOrgUnit(units);
    assert.equal(root.divisionId, undefined);
    assert.equal(root.head, null);
    assert.equal(root.children.length, 2);
    const missing = root.children.find(node => node.divisionId === undefined);
    const real = root.children.find(node => node.divisionId === 3);
    assert.equal(missing.name, 'Без подразделения');
    assert.equal(missing.head.id, '9007199254740993');
    assert.equal(real.name, 'Управление');
    assert.equal(missing.children, undefined);
    assert.equal(real.children, undefined);
  }
});

test('independent assigned roots remain siblings with their own descendants and personnel', () => {
  const h = client(new Map());
  const person = (id, level, current_status) => ({
    position: { id: level, name: 'Должность ' + level, level },
    employee: { id, first_name: 'Имя ' + id, last_name: 'Фамилия', current_status },
  });
  for (const [aId, bId] of [[10, 20], [20, 10]]) {
    // Distinct division IDs are essential: row() otherwise merges both roots into division3.
    const a = { ...row(aId), division: { id: 11, name: 'A' }, parent_id: null, employees: [
      person('9007199254740993', 2, null),
      person('102', 8, { status_type: null, state: null, start_date: null, end_date: null }),
      { position: { id: 99, name: 'Вакантная ставка', level: 9 }, employee: null },
    ] };
    const b = { ...row(bId), division: { id: 22, name: 'B' }, parent_id: null, employees: [
      person('201', 2, { status_type: 'leave', state: 'active', start_date: '2026-10-20', end_date: null }),
    ] };
    const aChild = { ...row(100), division: { id: 111, name: 'A child' }, parent_id: aId,
      employees: [person('301', 8, undefined)] };
    const bChild = { ...row(200), division: { id: 222, name: 'B child' }, parent_id: bId,
      employees: [person('401', 8, null)] };
    const units = [a, b, aChild, bChild];
    const original = structuredClone(units);
    const root = h.convertStaffUnitsResponseToOrgUnit(units);
    assert.equal(root.id, 'organization-structure-root', 'minimum staff ID must not become a parent');
    assert.equal(root.divisionId, undefined);
    assert.equal(root.head, null);
    assert.equal(root.employees.length, 0);
    assert.deepEqual(Array.from(root.children, node => node.id), [String(aId), String(bId)]);
    const aNode = root.children.find(node => node.divisionId === 11);
    const bNode = root.children.find(node => node.divisionId === 22);
    const expectedA = h.convertStaffUnitToOrgUnit({ ...a, children: [aChild] });
    const expectedB = h.convertStaffUnitToOrgUnit({ ...b, children: [bChild] });
    assert.deepEqual(structuredClone(aNode), structuredClone(expectedA));
    assert.deepEqual(structuredClone(bNode), structuredClone(expectedB));
    assert.deepEqual(Array.from(aNode.children, node => node.id), ['100']);
    assert.deepEqual(Array.from(bNode.children, node => node.id), ['200']);
    const descendants = node => [node, ...Array.from(node.children ?? []).flatMap(descendants)];
    const realNodes = Array.from(root.children).flatMap(descendants);
    assert.deepEqual(realNodes.map(node => node.id).sort(), [String(aId), String(bId), '100', '200'].sort());
    assert.deepEqual(realNodes.map(node => node.divisionId).sort((a, b) => a - b), [11, 22, 111, 222]);
    const people = realNodes.flatMap(node => [node.head, ...node.employees].filter(Boolean));
    assert.deepEqual(people.filter(person => person.name !== 'Вакантная должность').map(person => person.id).sort(),
      ['9007199254740993', '102', '201', '301', '401'].sort());
    assert.equal(people.filter(person => person.name === 'Вакантная должность').length, 1);
    assert.equal(aNode.head.id, '9007199254740993');
    assert.equal(aNode.head.status, undefined);
    const withoutStatus = aNode.employees.find(person => person.id === '102');
    assert.equal(withoutStatus.status, null);
    assert.equal(withoutStatus.statusStartDate, null);
    assert.equal(withoutStatus.statusEndDate, undefined);
    assert.equal(bNode.head.status, 'leave');
    assert.equal(bNode.head.statusStartDate, '2026-10-20');
    assert.equal(bNode.head.statusEndDate, undefined);
    assert.equal(aNode.children[0].head.status, undefined);
    // A genuine single-root tree still has its real root, not a neutral wrapper.
    assert.deepEqual(structuredClone(h.convertStaffUnitsResponseToOrgUnit([a, aChild])), structuredClone(expectedA));
    assert.deepEqual(units, original);
  }
  assert.equal(h.calls.length, 0);
});

function staffQuery(api) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../hooks/use-staff-units.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === '@/hooks/use-ops-protected-read') return {
        useOpsReadAccess: () => ({ allowed: true, scope: 'test' }),
        useOpsProtectedRead: (prefix, parts, access, read) => ({
          queryKey: [...prefix, access.scope, ...parts], queryFn: ({ signal }) => read(signal),
        }),
      };
      if (name === '@/lib/api') return { apiClient: api };
      throw Error('Unexpected import: ' + name);
    },
  });
  return exports.useStaffUnits();
}

test('an already cancelled staff query makes no network request', async () => {
  const controller = new AbortController();
  controller.abort();
  const h = client(new Map([[first, { results: [row(1)], next: null }]]));
  await assert.rejects(staffQuery(h.api).queryFn({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(h.calls.length, 0);
});

test('cancelling after page one prevents the next page and rejects partial staff', async () => {
  const controller = new AbortController();
  const h = client(new Map([
    [first, () => {
      controller.abort();
      return { results: [row(1)], next: second };
    }],
    [second, { results: [row(2)], next: null }],
  ]));
  await assert.rejects(staffQuery(h.api).queryFn({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(h.calls.map(call => call.url), [first]);
});

test('cancellation aborts an in-flight later page without completing the staff query', async () => {
  const controller = new AbortController();
  const h = client(new Map([
    [first, { results: [row(1)], next: second }],
    [second, async ({ signal }) => {
      // The response arrives after navigation cancels the query. A fetch
      // supplied with that signal rejects instead of returning its body.
      await Promise.resolve();
      controller.abort();
      signal?.throwIfAborted();
      return { results: [row(2)], next: null };
    }],
  ]));
  await assert.rejects(staffQuery(h.api).queryFn({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(h.calls.map(call => call.url), [first, second]);
});

for (const base of ['', 'http://localhost:18349']) {
  test('all staff pages stay on configured API route: ' + (base || 'portal origin'), async () => {
    const h = client(new Map([
      [base + first, { results: [row(1)], next: 'http://127.0.0.1:18345' + second }],
      [base + second, { results: [row(2)], next: null }],
    ]), base);
    assert.deepEqual(Array.from(await h.api.getStaffUnits(), unit => unit.id), [1, 2]);
    assert.deepEqual(h.calls.map(call => call.url), [base + first, base + second]);
  });
}
test('an explicit staff page does not follow pagination', async () => {
  const address = '/api/staff_unit/staff-units/?page=1&page_size=50';
  const h = client(new Map([[address, { results: [row(1)], next: 'https://external.invalid/secret' }]]));
  assert.equal((await h.api.getStaffUnits(1)).length, 1);
  assert.equal(h.calls.length, 1);
});
test('pagination cannot send the token to another path', async () => {
  const h = client(new Map([[first, { results: [row(1)], next: 'https://external.invalid/secret' }]]));
  await assert.rejects(h.api.getStaffUnits(), /Некорректный адрес следующей страницы/);
  assert.equal(h.calls.length, 1);
});
test('repeated page is rejected instead of yielding a truncated or duplicated staff list', async () => {
  const h = client(new Map([
    [first, { results: [row(1)], next: second }],
    [second, { results: [row(2)], next: second }],
  ]));
  await assert.rejects(h.api.getStaffUnits(), /Повтор страницы штатного расписания/);
  assert.equal(h.calls.length, 2);
});

for (const next of [
  'http://user:password@backend.invalid' + second,
  'file:///api/staff_unit/staff-units/?page=2',
  'https://backend.invalid' + second + '#fragment',
]) {
  test('rejects invalid pagination authority/protocol/fragment: ' + next, async () => {
    const h = client(new Map([[first, { results: [row(1)], next }]]));
    await assert.rejects(h.api.getStaffUnits(), /Некорректный адрес следующей страницы/);
    assert.equal(h.calls.length, 1);
  });
}
test('page safety limit raises an error instead of silently returning partial staff', async () => {
  const responses = new Map([[first, { results: [row(1)], next: second }]]);
  for (let page = 2; page <= 201; page++) {
    responses.set('/api/staff_unit/staff-units/?page=' + page + '&page_size=500', {
      results: [row(page)], next: '/api/staff_unit/staff-units/?page=' + (page + 1) + '&page_size=500',
    });
  }
  const h = client(responses);
  await assert.rejects(h.api.getStaffUnits(), /Не удалось загрузить штатное расписание полностью/);
  assert.equal(h.calls.length, 201);
});
