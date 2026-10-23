const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
const source = fs.readFileSync(path.join(__dirname, '../../features/employee-status-update/model/calendar-status-draft.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsForTest });
const { calendarStatusDraft, calendarStatusFingerprint } = exportsForTest;
const catalog = [{ code: 'VACATION', legacy_code: 'vacation' }, { code: 'DUTY', legacy_code: 'on_duty' }, { code: 'CUSTOM_SHIFT', legacy_code: null }];
const vacation = { id: 501, state: 'planned', status_type: 'vacation', start_date: '2026-10-20', end_date: '2026-10-23', comment: 'Приказ', location: 'Астана' };

test('a new assignment uses the selected civil day and canonical-to-personnel code mapping', () => {
  const result = calendarStatusDraft({ date: '2026-10-21', code: 'VACATION' }, catalog, []);
  assert.equal(result.code, 'vacation'); assert.equal(result.target, null);
  assert.equal(result.start, '2026-10-21'); assert.equal(result.end, '2026-10-21');
  assert.equal(result.comment, ''); assert.equal(result.location, '');
});
test('editing any included day retains the exact planned record, whole period and details', () => {
  for (const date of ['2026-10-20', '2026-10-21', '2026-10-23']) {
    const result = calendarStatusDraft({ date, code: 'VACATION' }, catalog, [vacation]);
    assert.equal(result.target, vacation); assert.equal(result.start, '2026-10-20'); assert.equal(result.end, '2026-10-23');
    assert.equal(result.comment, 'Приказ'); assert.equal(result.location, 'Астана');
  }
});
test('another type, an active status or a plan outside the selected day is never patched', () => {
  for (const row of [{ ...vacation, state: 'active' }, { ...vacation, status_type: 'on_duty' }, { ...vacation, start_date: '2026-10-22' }, { ...vacation, end_date: '2026-10-20' }]) {
    assert.equal(calendarStatusDraft({ date: '2026-10-21', code: 'VACATION' }, catalog, [row]).target, null);
  }
});
test('custom codes and indefinite plans keep their catalog code and null end', () => {
  const result = calendarStatusDraft({ date: '2026-11-01', code: 'CUSTOM_SHIFT' }, catalog, [{ ...vacation, status_type: 'CUSTOM_SHIFT', end_date: null }]);
  assert.equal(result.code, 'CUSTOM_SHIFT'); assert.equal(result.target.id, 501); assert.equal(result.end, null);
});
test('ambiguous plans fail closed instead of selecting an arbitrary record', () => {
  assert.throws(() => calendarStatusDraft({ date: '2026-10-21', code: 'VACATION' }, catalog, [vacation, { ...vacation, id: 502 }]), /несколько/);
  assert.throws(() => calendarStatusDraft({ date: '2026-10-21', code: 'MISSING' }, catalog, [vacation]), /Тип статуса недоступен/);
});
test('the exact structured duty placement survives, including large string IDs', () => {
  const placement = { kind: 'POST', object_id: '6', object_name: 'Аккорда', post_id: '9007199254740993', post_name: 'Учебный пост', group_id: null };
  const result = calendarStatusDraft({ date: '2026-10-21', code: 'DUTY' }, catalog, [{ ...vacation, status_type: 'on_duty', duty_assignment: placement }]);
  assert.equal(result.code, 'on_duty'); assert.equal(result.placement, placement); assert.equal(result.placement.post_id, '9007199254740993');
});
test('preflight detects changed or removed targets without depending on response property order', () => {
  const baseline = calendarStatusFingerprint(vacation);
  assert.equal(calendarStatusFingerprint({ comment: 'Приказ', ...vacation }), baseline);
  assert.equal(calendarStatusFingerprint({ ...vacation, status_type_display: 'Другая подпись' }), baseline);
  for (const row of [undefined, { ...vacation, state: 'cancelled' }, { ...vacation, end_date: '2026-10-25' }, { ...vacation, comment: '' }, { ...vacation, location: '' }]) {
    assert.notEqual(calendarStatusFingerprint(row), baseline);
  }
});

test('a time-only concurrent plan change cannot be overwritten', () => {
  const duty = { ...vacation, status_type: 'on_duty', duty_assignment: { kind: 'POST', object_id: '6', post_id: '9',
    time_zone: 'Asia/Almaty', intervals: [{ start_at: '2026-10-21T08:00:00+05:00', end_at: '2026-10-21T12:00:00+05:00' }] } };
  assert.equal(calendarStatusDraft({ date: '2026-10-21', code: 'DUTY' }, catalog, [duty]).placement.intervals, duty.duty_assignment.intervals);
  const changed = { ...duty, duty_assignment: { ...duty.duty_assignment, intervals: [{ ...duty.duty_assignment.intervals[0], end_at: '2026-10-21T13:00:00+05:00' }] } };
  assert.notEqual(calendarStatusFingerprint(duty), calendarStatusFingerprint(changed));
  assert.notEqual(calendarStatusFingerprint(duty), calendarStatusFingerprint({ ...duty, duty_assignment: { ...duty.duty_assignment, time_zone: undefined } }));
  assert.notEqual(calendarStatusFingerprint({ ...duty, duty_assignment: { ...duty.duty_assignment, intervals: undefined } }),
    calendarStatusFingerprint({ ...duty, duty_assignment: { ...duty.duty_assignment, intervals: [] } }));
});
