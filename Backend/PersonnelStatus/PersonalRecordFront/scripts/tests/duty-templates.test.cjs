const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = path.join(__dirname, '../../features/duty-register/model/templates.ts');
const api = {};
if (fs.existsSync(source)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api, require, Date, JSON, Intl });
const draft = { service_duty_code: 'GBR', planned_start: '2026-12-31T20:00', planned_end: '2027-01-01T08:00', location_label: 'Объект', document_basis: 'Приказ 12', note: 'Проверить связь', employee_id: '999', actual_start: '2026-12-31T20:03' };
function storage() { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }
function template(name = 'Ночная ГБР', id = 'first') { return api.templateFromDraft(id, name, draft); }

test('server writes allowlist reusable fields and preserve the same retry id', () => {
  assert.equal(typeof api.serverTemplatePayload, 'function');
  const row = { ...template(), employee_id: '999', can_manage: true, revision: 9 };
  const payload = api.serverTemplatePayload(row, null, 0);
  assert.equal(payload.id, 'first');
  assert.equal(payload.expected_revision, 0);
  assert.equal(payload.owner_division_id, null);
  assert.equal(payload.employee_id, undefined);
  assert.equal(payload.revision, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(api.serverTemplatePayload(row, '692', 9))), { ...JSON.parse(JSON.stringify(payload)), expected_revision: 9, owner_division_id: 692 });
  assert.throws(() => api.serverTemplatePayload(row, 'not-a-division', 0));
});

test('a template contains only reusable planning fields', () => {
  assert.equal(typeof api.templateFromDraft, 'function', 'template creation is missing');
  const row = template();
  assert.equal(row.duration_minutes, 720);
  assert.equal(row.start_time, '20:00');
  assert.equal(row.kind, 'GBR');
  assert.equal(row.employee_id, undefined);
  assert.equal(row.actual_start, undefined);
});
test('night shifts cross month, year and leap-day boundaries without browser timezone conversion', () => {
  assert.equal(typeof api.projectDutyTemplate, 'function', 'template projection is missing');
  for (const [date, end] of [['2026-12-31', '2027-01-01T08:00'], ['2024-02-28', '2024-02-29T08:00'], ['2026-02-28', '2026-03-01T08:00']]) {
    const row = api.projectDutyTemplate(template(), date);
    assert.equal(row.planned_start, date + 'T20:00');
    assert.equal(row.planned_end, end);
    assert.equal(row.location_label, draft.location_label);
  }
});
test('invalid dates and reversed intervals cannot become usable templates', () => {
  assert.equal(typeof api.templateFromDraft, 'function');
  for (const planned_start of ['2026-02-30T20:00', '2026-13-01T20:00', '2026-12-31T24:00']) assert.throws(() => api.templateFromDraft('id', 'Название', { ...draft, planned_start }));
  assert.throws(() => api.templateFromDraft('id', 'Название', { ...draft, planned_end: draft.planned_start }));
  assert.throws(() => api.projectDutyTemplate(template(), '2026-02-30'));
});
test('templates persist and remain separate between users, scopes and time zones', () => {
  assert.equal(typeof api.saveDutyTemplate, 'function', 'template persistence is missing');
  const db = storage();
  api.saveDutyTemplate(db, 'user-a', 'scope-a', 'Asia/Qyzylorda', template());
  assert.equal(api.readDutyTemplates(db, 'user-a', 'scope-a', 'Asia/Qyzylorda')[0].name, 'Ночная ГБР');
  for (const context of [['user-b', 'scope-a', 'Asia/Qyzylorda'], ['user-a', 'scope-b', 'Asia/Qyzylorda'], ['user-a', 'scope-a', 'UTC']]) assert.equal(api.readDutyTemplates(db, ...context).length, 0);
});
test('saving and deleting re-read storage and preserve templates added from another tab', () => {
  assert.equal(typeof api.removeDutyTemplate, 'function', 'template deletion is missing');
  const db = storage();
  api.saveDutyTemplate(db, 'a', 's', 'z', template());
  api.saveDutyTemplate(db, 'a', 's', 'z', template('Дневная ГБР', 'second'));
  assert.throws(() => api.saveDutyTemplate(db, 'a', 's', 'z', template('  ночная   гбр ', 'third')));
  api.removeDutyTemplate(db, 'a', 's', 'z', 'first');
  const rows = api.readDutyTemplates(db, 'a', 's', 'z');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'second');
});
test('damaged storage is reported and cannot be overwritten during saving', () => {
  assert.equal(typeof api.readDutyTemplates, 'function');
  const db = storage();
  api.saveDutyTemplate(db, 'a', 's', 'z', template());
  const key = [...db.data.keys()][0]; db.data.set(key, '{broken');
  assert.throws(() => api.readDutyTemplates(db, 'a', 's', 'z'));
  assert.throws(() => api.saveDutyTemplate(db, 'a', 's', 'z', template('Новый', 'new')));
  assert.equal(db.data.get(key), '{broken');
});
test('a failed browser write never reports a stored template', () => {
  assert.equal(typeof api.saveDutyTemplate, 'function');
  const db = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } };
  assert.throws(() => api.saveDutyTemplate(db, 'a', 's', 'z', template()), /quota exceeded/);
});
