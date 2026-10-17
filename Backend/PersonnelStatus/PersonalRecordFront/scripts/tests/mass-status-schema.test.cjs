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
  const exported = {};
  cache.set(file, exported);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports: exported, Date, require(name) {
    return name.startsWith('@/') ? load(name.slice(2)) : require(name);
  } }, { filename: file });
  return exported;
}
const { massStatusSchema, EMPTY_MASS_STATUS_FORM } = load('features/employee-status-update/model/mass-status-schema');
const startDate = new Date(2026, 9, 20);
const endDate = new Date(2026, 9, 10);

test('switching to in-service ignores a reversed draft period that will not be submitted', () => {
  const parsed = massStatusSchema.safeParse({ ...EMPTY_MASS_STATUS_FORM, status: 'in_service', startDate, endDate });
  assert.equal(parsed.success, true);
});

test('a temporary status rejects a reversed period and points to the ending date', () => {
  const parsed = massStatusSchema.safeParse({ ...EMPTY_MASS_STATUS_FORM, status: 'business_trip', startDate, endDate });
  assert.equal(parsed.success, false);
  assert.deepEqual(parsed.error.issues.map(issue => Array.from(issue.path)), [['endDate']]);
});

test('a temporary status needs both dates while in-service can be saved without them', () => {
  const temporary = massStatusSchema.safeParse({ ...EMPTY_MASS_STATUS_FORM, status: 'business_trip' });
  assert.equal(temporary.success, false);
  assert.deepEqual(temporary.error.issues.map(issue => Array.from(issue.path)), [['startDate'], ['endDate']]);
  assert.equal(massStatusSchema.safeParse({ ...EMPTY_MASS_STATUS_FORM, status: 'in_service' }).success, true);
});

test('a one-day temporary status is valid', () => {
  assert.equal(massStatusSchema.safeParse({ ...EMPTY_MASS_STATUS_FORM, status: 'sick_leave', startDate, endDate: startDate }).success, true);
});
