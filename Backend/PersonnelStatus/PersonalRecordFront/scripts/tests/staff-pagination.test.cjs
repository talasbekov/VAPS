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

function staffQuery(api) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../hooks/use-staff-units.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === '@tanstack/react-query') return { useQuery: options => options };
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
