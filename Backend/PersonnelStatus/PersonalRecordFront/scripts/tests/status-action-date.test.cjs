const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../features/employee-status-update/model/status-action-date.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsForTest = {};
vm.runInNewContext(compiled, { exports: exportsForTest, Date }, { filename: 'status-action-date.js' });
const { statusServerDates, statusStartForSave, opsExclusiveEndDate } = exportsForTest;
const current = { mode: 'change', today: '2026-10-08', inService: true };

test('current in-service starts on server today, including a browser on another day', () => {
  assert.equal(statusStartForSave({ ...current, chosenStartDate: new Date('2026-10-07T00:00:00') }), '2026-10-08');
});
test('future in-service preserves the selected future start', () => {
  assert.equal(statusStartForSave({ ...current, mode: 'schedule', chosenStartDate: new Date('2026-10-09T00:00:00') }), '2026-10-09');
});
test('in-service from a summary respects an explicit selected business day', () => {
  assert.equal(statusStartForSave({ ...current, initialStartDate: new Date('2026-10-11T00:00:00') }), '2026-10-11');
  assert.equal(statusStartForSave({ ...current, initialStartDate: new Date('2026-10-02T00:00:00') }), '2026-10-02');
});
test('planning cannot submit today, a past date or a missing date', () => {
  for (const value of ['2026-10-08', '2026-10-07', undefined]) {
    assert.throws(() => statusStartForSave({ ...current, mode: 'schedule', chosenStartDate: value ? new Date(`${value}T00:00:00`) : undefined }));
  }
});
test('current row edits do not silently create a future period', () => {
  assert.throws(() => statusStartForSave({ ...current, inService: false, chosenStartDate: new Date('2026-10-09T00:00:00') }));
  assert.equal(statusStartForSave({ ...current, inService: false, chosenStartDate: new Date('2026-10-08T00:00:00') }), '2026-10-08');
});
test('server tomorrow handles month/year transitions and rejects invalid calendar dates', () => {
  assert.equal(statusServerDates('2027-01-01').today, '2026-12-31');
  assert.equal(statusServerDates('2024-03-01').today, '2024-02-29');
  for (const value of ['2026-02-30', 'broken', '2026-10-08T00:00:00']) assert.throws(() => statusServerDates(value));
});

test('one-day event participation includes the selected last day', () => {
  assert.equal(opsExclusiveEndDate(new Date(2026, 9, 16)), '2026-10-17');
});

test('event last-day conversion handles calendar boundaries and leap years', () => {
  for (const [year, month, day, expected] of [
    [2026, 11, 31, '2027-01-01'], [2024, 1, 28, '2024-02-29'],
    [2024, 1, 29, '2024-03-01'], [2026, 1, 28, '2026-03-01'],
  ]) assert.equal(opsExclusiveEndDate(new Date(year, month, day)), expected);
});

test('the selected civil day is stable in positive, negative and DST time zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Almaty', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Berlin']) {
      process.env.TZ = zone;
      assert.equal(opsExclusiveEndDate(new Date(2026, 2, 28)), '2026-03-29', zone);
      assert.equal(opsExclusiveEndDate(new Date(2026, 9, 16)), '2026-10-17', zone);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('missing or unrepresentable event last days fail before sending a request', () => {
  for (const date of [undefined, new Date(NaN), new Date(9999, 11, 31)]) assert.throws(() => opsExclusiveEndDate(date));
});
