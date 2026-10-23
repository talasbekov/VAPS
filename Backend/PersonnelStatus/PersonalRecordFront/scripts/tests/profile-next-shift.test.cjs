const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
const file = path.join(__dirname, '../../widgets/my-profile/model/profile-next-shift.ts');
if (fs.existsSync(file)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exported, Date, Intl });
const select = (...args) => {
  assert.equal(typeof exported.selectNextProfileShift, 'function', 'next shift selection must be implemented');
  return exported.selectNextProfileShift(...args);
};
const now = new Date('2026-10-20T12:00:00+05:00');
function duty(id, changes = {}) {
  return { id, source: 'STATUS', source_id: 17, source_state: 'PLANNED',
    business_date: '2026-10-20', date_start: '2026-10-20', date_end: '2026-10-20',
    planned_start: '2026-10-20T13:00:00+05:00', planned_end: '2026-10-20T15:00:00+05:00',
    actual_start: null, actual_end: null, acknowledged_at: null,
    object_label: 'Объект А', post_label: 'Пост 2', senior: null, instruction: null, readOnly: true, ...changes };
}
function assignment(changes = {}) {
  return { assignmentId: 'om-1', eventId: '88', eventCode: 'ОМ-88', eventTitle: 'Проверка',
    eventStage: 'CONDUCT', businessDate: '2026-10-20', businessDateEnd: null,
    objectName: 'Площадка', visitObjectId: null, visitObjectName: null, postId: 'p2', postFound: true,
    sector: 'Сектор', post: 'Пост', task: 'Проверить вход', requirements: '', uniform: '', weapon: '',
    roleCode: null, sectionCode: null, employeeHasAccount: true, acknowledgedAt: null,
    acknowledgedVia: '', acknowledgedBy: '', declinedAt: null, declineReason: null,
    declinedVia: '', declinedBy: '', ...changes };
}

test('a recorded active exit wins over a nearer planned start', () => {
  const result = select([duty('next'), duty('active', { source: 'LOG', source_state: 'ACTIVE',
    business_date: '2026-10-19', planned_start: null, planned_end: null,
    actual_start: '2026-10-19T23:00:00+05:00' })], [], now);
  assert.equal(result.key, 'active');
  assert.equal(result.execution, 'STARTED');
  assert.equal(result.actualStart, '2026-10-19T23:00:00+05:00');
});

test('cancelled, completed and finished rows can never be the current exit', () => {
  const result = select([
    duty('cancelled', { source_state: 'CANCELLED', actual_start: '2026-10-20T09:00:00+05:00' }),
    duty('completed', { source_state: 'COMPLETED', actual_start: '2026-10-20T09:00:00+05:00' }),
    duty('ended', { source_state: 'ACTIVE', actual_start: '2026-10-20T09:00:00+05:00', actual_end: '2026-10-20T10:00:00+05:00' }),
    duty('next'),
  ], [assignment({ eventStage: 'CLOSED' })], now);
  assert.equal(result.key, 'next');
});

test('several same-day exits retain their individual interval and the nearest remaining exit is selected', () => {
  const result = select([
    duty('late', { planned_start: '2026-10-20T19:00:00+05:00', planned_end: '2026-10-20T21:00:00+05:00' }),
    duty('past', { planned_start: '2026-10-20T08:00:00+05:00', planned_end: '2026-10-20T10:00:00+05:00' }),
    duty('next'),
  ], [], now);
  assert.equal(result.key, 'next');
  assert.equal(result.plannedStart, '2026-10-20T13:00:00+05:00');
  assert.equal(result.plannedEnd, '2026-10-20T15:00:00+05:00');
  assert.equal(result.execution, 'ASSIGNED');
});

test('an interval ending exactly now is past and a single overnight exit keeps both exact dates', () => {
  const result = select([
    duty('boundary', { planned_start: '2026-10-20T08:00:00+05:00', planned_end: '2026-10-20T12:00:00+05:00' }),
    duty('night', { planned_start: '2026-10-20T23:00:00+05:00', planned_end: '2026-10-21T07:00:00+05:00' }),
  ], [], now);
  assert.equal(result.key, 'night');
  assert.equal(result.plannedEnd, '2026-10-21T07:00:00+05:00');
});

test('acknowledgement and an active planned window do not claim physical presence', () => {
  const result = select([duty('ack', { source: 'PLAN', source_state: 'ACKNOWLEDGED',
    acknowledged_at: '2026-10-19T18:00:00+05:00', planned_start: '2026-10-20T11:00:00+05:00' })], [], now);
  assert.equal(result.execution, 'ACKNOWLEDGED');
  assert.equal(result.actualStart, null);
});

test('date-only personnel and old PLAN rows keep unknown planned hours and never become a 24-hour shift', () => {
  for (const source of ['STATUS', 'PLAN']) {
    const result = select([duty('unknown', { source, source_state: 'ACTIVE', planned_start: null, planned_end: null })], [], now);
    assert.equal(result.plannedStart, null);
    assert.equal(result.plannedEnd, null);
    assert.equal(result.execution, 'ASSIGNED');
    assert.equal(result.senior, null);
  }
});

test('an unknown-hours assignment spanning today remains visible without inventing timestamps', () => {
  const result = select([duty('spanning', { business_date: '2026-10-18', date_start: '2026-10-18', date_end: '2026-10-22',
    planned_start: null, planned_end: null })], [], now);
  assert.equal(result.key, 'spanning');
  assert.equal(result.plannedStart, null);
  assert.equal(result.dateEnd, '2026-10-22');
});

test('OM conduct and acknowledgement expose instruction but never imply physical start or exact hours', () => {
  const result = select([], [assignment({ acknowledgedAt: '2026-10-19T10:00:00Z' })], now);
  assert.equal(result.source, 'OM');
  assert.equal(result.execution, 'ACKNOWLEDGED');
  assert.equal(result.plannedStart, null);
  assert.equal(result.plannedEnd, null);
  assert.equal(result.actualStart, null);
  assert.equal(result.senior, null);
  assert.equal(result.instruction, 'Проверить вход');
  assert.equal(result.eventId, '88');
});

test('a multi-day OM still covers the current day and keeps the actual assigned visit object', () => {
  const result = select([], [assignment({ businessDate: '2026-10-18', businessDateEnd: '2026-10-22',
    visitObjectName: 'Вторая площадка' })], now);
  assert.equal(result.objectLabel, 'Вторая площадка');
  assert.equal(result.execution, 'ASSIGNED');
});

test('past unknown dates are excluded using Astana date even when UTC is on the previous day', () => {
  const result = select([
    duty('old', { business_date: '2026-10-19', date_start: '2026-10-19', date_end: '2026-10-19', planned_start: null, planned_end: null }),
    duty('today', { planned_start: null, planned_end: null }),
  ], [], new Date('2026-10-19T21:00:00Z'));
  assert.equal(result.key, 'today');
});

test('declined OM and missing post retain their limits instead of borrowing instruction or a senior', () => {
  const result = select([], [assignment({ postFound: false, declinedAt: '2026-10-20T06:00:00Z', declineReason: 'Болею' })], now);
  assert.equal(result.execution, 'DECLINED');
  assert.equal(result.declineReason, 'Болею');
  assert.equal(result.postLabel, null);
  assert.equal(result.instruction, null);
});

test('empty, past and malformed dated rows give no next shift', () => {
  assert.equal(select([], [], now), null);
  assert.equal(select([duty('bad', { business_date: 'bad', date_start: null, date_end: null, planned_start: null, planned_end: null })],
    [assignment({ businessDate: '2026-10-19' })], now), null);
});

test('a later exit from a multiday personnel assignment cannot jump ahead of a nearer exact exit', () => {
  const result = select([
    duty('far', { business_date: '2026-10-22', date_start: '2026-10-20', date_end: '2026-10-22',
      planned_start: '2026-10-22T08:00:00+05:00', planned_end: '2026-10-22T10:00:00+05:00' }),
    duty('near', { business_date: '2026-10-21', date_start: '2026-10-21', date_end: '2026-10-21',
      planned_start: '2026-10-21T08:00:00+05:00', planned_end: '2026-10-21T10:00:00+05:00' }),
  ], [], now);
  assert.equal(result.key, 'near');
});

test('a current date-only OM is nearer than a later exact exit under a multiday personnel period', () => {
  const result = select([duty('far', { business_date: '2026-10-22', date_start: '2026-10-20', date_end: '2026-10-22',
    planned_start: '2026-10-22T08:00:00+05:00', planned_end: '2026-10-22T10:00:00+05:00' })], [assignment()], now);
  assert.equal(result.key, 'OM:om-1');
});

test('server time advances by monotonic elapsed time instead of the workstation calendar', () => {
  assert.equal(typeof exported.profileServerNow, 'function', 'server time must be implemented');
  const result = exported.profileServerNow('2026-10-20T07:00:00Z', 10_000, 40_000);
  assert.equal(result.toISOString(), '2026-10-20T07:00:30.000Z');
  const next = select([
    duty('first', { planned_start: '2026-10-20T11:59:00+05:00', planned_end: '2026-10-20T12:00:20+05:00' }),
    duty('second'),
  ], [], result);
  assert.equal(next.key, 'second');
});

test('missing or invalid server clock metadata never falls back to the workstation time', () => {
  assert.equal(typeof exported.profileServerNow, 'function', 'server time must be implemented');
  for (const [at, received, current] of [[undefined, 100, 200], ['bad', 100, 200], ['2026-10-20', 100, 200],
    ['2026-10-20T07:00:00Z', undefined, 200], ['2026-10-20T07:00:00Z', 100, NaN]]) {
    assert.equal(exported.profileServerNow(at, received, current), null);
  }
});

test('future naive or malformed acknowledgement is never a confirmed fact in either personal source', () => {
  for (const stamp of ['2026-10-20T13:00:00+05:00', '2026-10-20T11:00:00', 'invalid']) {
    const personal = select([duty('ack', { acknowledged_at: stamp, source_state: 'ACKNOWLEDGED' })], [], now);
    const event = select([], [assignment({ acknowledgedAt: stamp })], now);
    for (const selected of [personal, event]) {
      assert.equal(selected.acknowledgedAt, null);
      assert.equal(selected.execution, 'ASSIGNED');
    }
  }
});

test('own acknowledgement needs an explicit server action and token; it never becomes a start action', () => {
  const token = 'a'.repeat(64);
  const allowed = select([duty('ack', { canAcknowledge: true, acknowledgementToken: token })], [], now);
  assert.equal(allowed.canAcknowledge, true);
  assert.equal(allowed.acknowledgementToken, token);
  assert.equal(allowed.execution, 'ASSIGNED');
  for (const changes of [{ canAcknowledge: false, acknowledgementToken: token }, { canAcknowledge: true, acknowledgementToken: null },
    { canAcknowledge: true, acknowledgementToken: token, acknowledged_at: '2026-10-20T11:00:00+05:00' }]) {
    assert.equal(select([duty('ack', changes)], [], now).canAcknowledge, false);
  }
  assert.equal(select([], [assignment()], now).canAcknowledge, false);
});
