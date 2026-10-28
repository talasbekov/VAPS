const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function model() {
  const exports = {};
  const file = path.join(__dirname, '../../entities/service-employee/qualifications.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports });
  return exports;
}
const draft = () => ({ skill: 'shooting', score: '4', assessed_on: '2026-10-20', valid_until: '2027-10-20', basis: 'Test record' });
test('assessment keeps explicit dates and trims evidence; absent expiry stays unknown', () => {
  const m = model();
  const data = m.assessmentFromDraft({ ...draft(), basis: '  Test  ', valid_until: '' }, '2026-10-27');
  assert.equal(data.basis, 'Test');
  assert.equal(data.valid_until, null);
  assert.equal(data.score, 4);
});
test('rejects future examination and expiry before assessment', () => {
  const m = model();
  assert.throws(() => m.assessmentFromDraft({ ...draft(), assessed_on: '2026-10-28' }, '2026-10-27'));
  assert.throws(() => m.assessmentFromDraft({ ...draft(), valid_until: '2026-10-19' }, '2026-10-27'));
});
test('rejects impossible dates, missing evidence and ambiguous scores', () => {
  const m = model();
  for (const patch of [{assessed_on:'2026-02-30'}, {assessed_on:'20261020'}, {basis:' '}, {basis:'x'.repeat(1001)}, {basis:'a\u0000'}, {score:'4.0'}, {score:'6'}, {skill:'unknown'}]) {
    assert.throws(() => m.assessmentFromDraft({...draft(), ...patch}, '2026-10-27'));
  }
});
test('current status never turns legacy numbers or unspecified expiry into confirmed validity', () => {
  const m = model();
  assert.match(m.qualificationStateLabel('unknown'), /Не подтверждена/);
  assert.match(m.qualificationStateLabel('expired'), /Истёк/);
  assert.match(m.qualificationStateLabel('valid'), /Срок не истёк/);
});
