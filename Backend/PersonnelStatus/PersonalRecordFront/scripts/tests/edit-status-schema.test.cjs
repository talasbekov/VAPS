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

const placedDuty = (intervals) => ({ ...draft('on_duty', 'На дежурстве'), startDate: day, endDate: day,
  duty: { dutyKind: 'POST', objectId: '6', objectName: 'Аккорда', postId: '9007199254740993', postName: 'Пост', groupId: '', groupName: '' },
  dutyIntervals: intervals });

test('legacy unknown hours and explicitly empty exits remain distinct', () => {
  assert.equal(editStatusFormSchema.parse(placedDuty(undefined)).dutyIntervals, undefined);
  assert.deepEqual(Array.from(editStatusFormSchema.parse(placedDuty([])).dutyIntervals), []);
});
test('a partially entered exit reports the exact missing clock field', () => {
  const result = editStatusFormSchema.safeParse(placedDuty([{ start: '2026-10-13T08:30', end: '' }]));
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map(issue => Array.from(issue.path)), [['dutyIntervals', 0, 'end']]);
});
test('overnight exits require an explicit next date and stay inside the inclusive status period', () => {
  const overnight = [{ start: '2026-10-13T22:00', end: '2026-10-14T04:00' }];
  assert.equal(editStatusFormSchema.safeParse(placedDuty(overnight)).success, false);
  assert.equal(editStatusFormSchema.safeParse({ ...placedDuty(overnight), endDate: new Date(2026, 9, 14) }).success, true);
  assert.equal(editStatusFormSchema.safeParse(placedDuty([{ start: '2026-10-13T22:00', end: '2026-10-14T00:00' }])).success, true);
  assert.equal(editStatusFormSchema.safeParse(placedDuty([{ start: '2026-10-13T22:00', end: '2026-10-13T04:00' }])).success, false);
});
test('exits reject overlap, zero length, impossible civil dates and more than 256 rows', () => {
  for (const intervals of [
    [{ start: '2026-10-13T08:00', end: '2026-10-13T08:00' }],
    [{ start: '2026-02-30T08:00', end: '2026-10-13T09:00' }],
    [{ start: '2026-10-13T08:00', end: '2026-10-13T12:00' }, { start: '2026-10-13T11:00', end: '2026-10-13T13:00' }],
    Array.from({ length: 257 }, () => ({ start: '', end: '' })),
  ]) assert.equal(editStatusFormSchema.safeParse(placedDuty(intervals)).success, false);
});
test('adjacent exits and unknown-time legacy assignments do not invent a full-day duration', () => {
  const intervals = [{ start: '2026-10-13T12:00', end: '2026-10-13T14:00' }, { start: '2026-10-13T08:00', end: '2026-10-13T12:00' }];
  assert.equal(editStatusFormSchema.safeParse(placedDuty(intervals)).success, true);
  assert.equal(editStatusFormSchema.safeParse({ ...placedDuty([{ start: '', end: '' }]), statusCode: 'vacation' }).success, true);
});

const intervalModel = load('features/employee-status-update/model/duty-intervals');
test('aware interval roundtrip uses Astana historic offsets independently of browser time zone', () => {
  const previousZone = process.env.TZ;
  const previousEffectiveZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = 'America/Los_Angeles';
  try {
    for (const [start, expected] of [['2026-10-13T03:30:17Z', '2026-10-13T08:30:17+05:00'], ['2023-10-13T02:30:17Z', '2023-10-13T08:30:17+06:00']]) {
      const end = new Date(Date.parse(start) + 3600000).toISOString();
      const rows = intervalModel.dutyIntervalDrafts({ intervals: [{ start_at: start, end_at: end }] });
      assert.equal(rows[0].start, expected.slice(0, 19));
      assert.equal(intervalModel.dutyIntervalsPayload(rows).intervals[0].start_at, expected);
    }
    assert.deepEqual(Object.keys(intervalModel.dutyIntervalsPayload(undefined)), []);
    assert.equal(intervalModel.dutyIntervalsPayload([]).intervals.length, 0);
  } finally {
    process.env.TZ = previousZone ?? previousEffectiveZone;
    if (previousZone === undefined) delete process.env.TZ;
  }
});
test('read views select intersecting exits without treating end midnight as another occupied day', () => {
  const intervals = [
    { start_at: '2026-10-12T22:00:00+05:00', end_at: '2026-10-13T04:00:00+05:00' },
    { start_at: '2026-10-13T22:00:00+05:00', end_at: '2026-10-14T00:00:00+05:00' },
    { start_at: '2026-10-15T08:00:00+05:00', end_at: '2026-10-15T12:00:00+05:00' },
  ];
  assert.equal(typeof intervalModel.dutyIntervalsOnDate, 'function');
  assert.deepEqual(Array.from(intervalModel.dutyIntervalsOnDate(intervals, '2026-10-13')), intervals.slice(0, 2));
  assert.equal(intervalModel.dutyIntervalsOnDate(intervals, '2026-10-14').length, 0);
});

test('millisecond exits retain their exact endpoints through hydration and validation', () => {
  const placement = { intervals: [{ start_at: '2026-10-13T03:30:00.001Z', end_at: '2026-10-13T03:30:00.002Z' }] };
  const rows = intervalModel.dutyIntervalDrafts(placement);
  assert.equal(rows[0].start, '2026-10-13T08:30:00.001');
  assert.equal(rows[0].end, '2026-10-13T08:30:00.002');
  const saved = intervalModel.dutyIntervalsPayload(rows).intervals[0];
  assert.equal(Date.parse(saved.start_at), Date.parse(placement.intervals[0].start_at));
  assert.equal(Date.parse(saved.end_at), Date.parse(placement.intervals[0].end_at));
  const validation = editStatusFormSchema.safeParse(placedDuty(rows));
  assert.equal(validation.success, true, JSON.stringify(validation.error?.issues));
});
test('a saved timestamp disambiguates historic repeated clocks without changing the original exit', () => {
  const placement = { intervals: [{ start_at: '2024-02-29T23:30:00+06:00', end_at: '2024-03-01T00:30:00+05:00' }] };
  const rows = intervalModel.dutyIntervalDrafts(placement);
  assert.equal(Date.parse(intervalModel.dutyIntervalsPayload(rows).intervals[0].start_at), Date.parse(placement.intervals[0].start_at));
  assert.throws(() => intervalModel.dutyTimestampForSave('2024-02-29T23:30'), /неоднозначно/);
});

test('a new replacement clips only its copied draft at the selected day while the saved schedule remains intact', () => {
  const placement = { intervals: [
    { start_at: '2026-10-12T08:00:00+05:00', end_at: '2026-10-12T12:00:00+05:00' },
    { start_at: '2026-10-12T22:00:00+05:00', end_at: '2026-10-13T04:00:00+05:00' },
    { start_at: '2026-10-13T08:00:00+05:00', end_at: '2026-10-13T12:00:00+05:00' },
  ] };
  const saved = JSON.stringify(placement);
  assert.equal(typeof intervalModel.dutyIntervalsForNewStatus, 'function');
  const result = intervalModel.dutyIntervalsForNewStatus(placement, '2026-10-13');
  assert.equal(result.adjusted, true);
  assert.equal(result.intervals.length, 2);
  assert.equal(result.intervals[0].start, '2026-10-13T00:00:00');
  assert.equal(result.intervals[0].end, '2026-10-13T04:00:00');
  assert.equal(JSON.stringify(placement), saved);
  assert.equal(intervalModel.dutyIntervalsForNewStatus(placement, '2026-10-14').intervals.length, 0);
  assert.equal(intervalModel.dutyIntervalsForNewStatus({}, '2026-10-13').intervals, undefined);
});
