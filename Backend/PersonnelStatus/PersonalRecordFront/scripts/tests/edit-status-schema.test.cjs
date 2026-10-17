const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(relative) {
  const file = path.join(root, relative + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, Date, require: name => name.startsWith('@/') ? load(name.slice(2)) : require(name) }, { filename: file });
  return exports;
}
const { editStatusFormSchema, EMPTY_EDIT_STATUS_FORM } = load('features/employee-status-update/model/edit-status-schema');
const day = new Date(2026, 9, 13);
const draft = (statusCode, status) => ({ ...EMPTY_EDIT_STATUS_FORM, statusCode, status });

test('renamed in-service is indefinite without dates', () => {
  assert.equal(editStatusFormSchema.safeParse(draft('in_service', 'На службе')).success, true);
});
test('in-service ignores a reversed hidden temporary period', () => {
  assert.equal(editStatusFormSchema.safeParse({ ...draft('in_service', 'В строю'), startDate: new Date(2026, 9, 20), endDate: day }).success, true);
});
test('a different code with the old in-service label still requires its period', () => {
  const result = editStatusFormSchema.safeParse(draft('custom_status', 'В строю'));
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map(issue => Array.from(issue.path)), [['startDate'], ['endDate']]);
});
test('a one-day temporary status remains valid', () => {
  assert.equal(editStatusFormSchema.safeParse({ ...draft('business_trip', 'Командировка'), startDate: day, endDate: day }).success, true);
});
test('renamed original duty still requires its placement', () => {
  const result = editStatusFormSchema.safeParse({ ...draft('on_duty', 'Дежурный на посту'), startDate: day, endDate: day });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map(issue => Array.from(issue.path)), [['duty', 'dutyKind'], ['duty', 'objectId']]);
});
test('dated duty variants remain independent of original duty placement', () => {
  for (const code of ['DUTY_COMBAT', 'DUTY_DAILY', 'DUTY_OPERATIONAL']) assert.equal(editStatusFormSchema.safeParse({ ...draft(code, 'Дежурство'), startDate: day, endDate: day }).success, true);
});
