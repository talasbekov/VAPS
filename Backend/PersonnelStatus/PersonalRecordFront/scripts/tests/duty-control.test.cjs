const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relative) {
  const filename = path.join(__dirname, '../..', relative);
  const exports = {};
  const source = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, Date, Intl, BigInt, URLSearchParams });
  return exports;
}
const entities = read('entities/duty-register/index.ts');
const execution = read('features/duty-register/model/execution.ts');
const control = read('features/duty-register/model/control.ts');
const now = '2026-10-20T10:00:00+05:00';
const row = { state: 'PLANNED', created_at: '2026-10-19T10:00:00+05:00', acknowledged_at: null, actual_start: null, actual_end: null };
function state(values) {
  assert.equal(typeof execution.executionState, 'function', 'execution state must be derived from explicit facts');
  return execution.executionState({ ...row, ...values }, now);
}

test('each exact STATUS exit has an address that preserves the imported status id', () => {
  const id = 'STATUS:9007199254740993:' + 'ab'.repeat(32);
  assert.equal(entities.dutyRecordPath(id), '/api/ops/duty-register/' + id + '/');
});

test('record URLs reject overflow, incomplete exit identity and injected paths', () => {
  for (const id of ['LOG:9223372036854775808', 'STATUS:1', 'STATUS:0:' + 'a'.repeat(64), 'STATUS:1:' + 'a'.repeat(63), 'STATUS:1:' + 'a'.repeat(64) + '/start', 'PLAN:01']) {
    assert.throws(() => entities.dutyRecordPath(id), /Неверный адрес записи/, id);
  }
  assert.equal(entities.dutyRecordPath('DISPATCH:9223372036854775807'), '/api/ops/duty-register/DISPATCH:9223372036854775807/');
});

test('a planned or acknowledged exit never becomes actual attendance from its scheduled day', () => {
  assert.equal(state({}), 'PLANNED');
  assert.equal(state({ state: 'ACKNOWLEDGED', acknowledged_at: '2026-10-20T08:00:00+05:00' }), 'ACKNOWLEDGED');
});

test('actual start and completion require their own valid facts', () => {
  assert.equal(state({ state: 'ACTIVE', actual_start: '2026-10-20T09:00:00+05:00' }), 'ACTIVE');
  assert.equal(state({ state: 'COMPLETED', actual_start: '2026-10-20T08:00:00+05:00', actual_end: '2026-10-20T09:00:00+05:00' }), 'COMPLETED');
});

test('a state code without its actual timestamp remains incomplete', () => {
  assert.equal(state({ state: 'ACTIVE' }), 'INCOMPLETE');
  assert.equal(state({ state: 'COMPLETED' }), 'INCOMPLETE');
});

test('future, naive and reversed facts cannot claim attendance', () => {
  assert.equal(state({ state: 'ACTIVE', actual_start: '2026-10-20T11:00:00+05:00' }), 'INCOMPLETE');
  assert.equal(state({ state: 'ACTIVE', actual_start: '2026-10-20T09:00:00' }), 'INCOMPLETE');
  assert.equal(state({ state: 'COMPLETED', actual_start: '2026-10-20T09:00:00+05:00', actual_end: '2026-10-20T08:00:00+05:00' }), 'INCOMPLETE');
});

test('cancelled source retains cancellation even with historical actual facts', () => {
  assert.equal(state({ state: 'CANCELLED', actual_start: '2026-10-20T09:00:00+05:00' }), 'CANCELLED');
});

test('the three steps show missing acknowledgement separately from known actual start', () => {
  assert.equal(typeof execution.executionSteps, 'function', 'three phases must expose their independent recorded facts');
  const steps = execution.executionSteps({ ...row, state: 'ACTIVE', actual_start: '2026-10-20T09:00:00+05:00' }, now);
  assert.deepEqual(Array.from(steps, item => [item.code, item.recorded]), [['assigned', true], ['acknowledged', false], ['started', true]]);
});

test('future acknowledgement is not displayed as a confirmed step', () => {
  assert.equal(typeof execution.executionSteps, 'function');
  const steps = execution.executionSteps({ ...row, acknowledged_at: '2026-10-20T11:00:00+05:00' }, now);
  assert.deepEqual(Array.from(steps, item => item.recorded), [true, false, false]);
});

const snapshot = { period: { from: '2026-10-20', to: '2026-10-20' }, time_zone: 'Asia/Almaty', rows: [] };
test('control reads the server day and current shifts as one visible result', async () => {
  assert.equal(typeof control.readDutyControl, 'function');
  const result = await control.readDutyControl(async endpoint => {
    if (endpoint === '/api/ops/duty-register/?preset=TODAY&page_size=1') return { ...snapshot, marker: 'overview' };
    if (endpoint === '/api/ops/duty-register/?preset=TODAY&state=ACTIVE&page_size=5') return { ...snapshot, marker: 'active' };
    throw new Error('Unexpected endpoint');
  });
  assert.equal(result.overview.marker, 'overview'); assert.equal(result.active.marker, 'active');
});

test('a denied half cannot leave a partly successful control snapshot visible', async () => {
  assert.equal(typeof control.readDutyControl, 'function');
  const denied = new Error('Denied');
  await assert.rejects(control.readDutyControl(async endpoint => {
    if (endpoint.includes('state=ACTIVE')) throw denied;
    return snapshot;
  }), error => error === denied);
});

test('two TODAY requests crossing midnight must be retried as a single day', async () => {
  assert.equal(typeof control.readDutyControl, 'function');
  await assert.rejects(control.readDutyControl(async endpoint => endpoint.includes('state=ACTIVE')
    ? { ...snapshot, period: { from: '2026-10-21', to: '2026-10-21' } } : snapshot));
});
