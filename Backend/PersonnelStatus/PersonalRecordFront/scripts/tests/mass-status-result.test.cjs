const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../../features/employee-status-update/model/mass-status-result.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const loaded = new Module(file, module);
loaded.paths = module.paths;
loaded._compile(compiled, file);
const { readMassStatusResult, retainFailedMassSelection } = loaded.exports;
const ids = [11, 29, 7];
const error = index => ({ status: 'Недоступная строка', section: 'employee_statuses', index });

test('complete result confirms every submitted employee', () => {
  assert.equal(readMassStatusResult({ success: true, updated: { statuses: 3 } }, ids).kind, 'complete');
});
test('indexed partial result identifies original request rows and hides transport metadata', () => {
  const result = readMassStatusResult({ success: true, updated: { statuses: 2 }, errors: [error(1)] }, ids);
  assert.equal(result.kind, 'partial');
  assert.deepEqual(result.remainingEmployeeIds, [29]);
  assert.deepEqual(result.messages, ['Недоступная строка']);
});
test('multiple reasons for one failed row do not change its retry target', () => {
  const result = readMassStatusResult({ success: true, updated: { statuses: 2 }, errors: [error(1), { ...error(1), status: 'Другой отказ' }] }, ids);
  assert.equal(result.kind, 'partial');
  assert.deepEqual(result.remainingEmployeeIds, [29]);
});
test('zero applied and explicit atomic rollback retain all request rows', () => {
  for (const response of [{ success: false, updated: { statuses: 0 }, errors: [error(1)] }, { success: false, updated: { statuses: 0 }, errors: [error(1)], rolled_back: true }]) {
    const result = readMassStatusResult(response, ids);
    assert.equal(result.kind, 'rejected');
    assert.deepEqual(result.remainingEmployeeIds, ids);
  }
});
test('partial counts with ambiguous, foreign or out-of-range errors cannot be replayed automatically', () => {
  for (const errors of [['Без индекса'], [{ ...error(1), section: 'staff_units' }], [error(-1)], [error(3)], [error('1')], [error(1), error(2)], []]) {
    assert.equal(readMassStatusResult({ success: true, updated: { statuses: 2 }, errors }, ids).kind, 'unconfirmed');
  }
});
test('invalid counts and contradictory flags remain unconfirmed', () => {
  for (const statuses of [-1, 4, 1.5, '3', null, undefined]) assert.equal(readMassStatusResult({ success: true, updated: { statuses } }, ids).kind, 'unconfirmed');
  assert.equal(readMassStatusResult({ success: false, updated: { statuses: 3 } }, ids).kind, 'unconfirmed');
  assert.equal(readMassStatusResult({ success: true, updated: { statuses: 2 }, errors: [error(1)], rolled_back: true }, ids).kind, 'unconfirmed');
});
test('failed selection survives ordering changes and does not overwrite a later user selection', () => {
  assert.deepEqual(retainFailedMassSelection(['2-29', '1-11'], ['1-11', '2-29'], ['2-29']), ['2-29']);
  const later = ['3-7'];
  assert.strictEqual(retainFailedMassSelection(later, ['1-11', '2-29'], ['2-29']), later);
  assert.strictEqual(retainFailedMassSelection(later, ['3-7'], ['99-99']), later);
});
