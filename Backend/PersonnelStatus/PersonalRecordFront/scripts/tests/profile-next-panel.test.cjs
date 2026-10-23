const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function fixture() {
  let dutyRetries = 0, assignmentRetries = 0, permissionRetries = 0;
  const row = { id: 'STATUS:17:exit', source: 'STATUS', source_id: 17, source_state: 'PLANNED',
    business_date: '2026-10-20', date_start: '2026-10-20', date_end: '2026-10-20',
    planned_start: '2026-10-20T13:00:00+05:00', planned_end: '2026-10-20T17:00:00+05:00',
    actual_start: null, actual_end: null, acknowledged_at: null, object_label: 'Личный объект', post_label: 'Пост 2',
    senior: null, instruction: null, readOnly: true };
  const state = { authorityAvailable: true, monotonicMs: 5000, browserNow: '2026-10-20T12:00:00+05:00',
    duties: { data: { employeeId: '17', unlinkedReason: null, time_zone: 'Asia/Almaty', generated_at: '2026-10-20T07:00:00Z', receivedMonotonicMs: 5000, results: [row] },
      isPending: false, isError: false, isFetching: false, readAccessBlocked: false, refetch: () => dutyRetries++ },
    assignments: { data: { employeeId: '17', unlinkedReason: null, results: [] },
      isPending: false, isError: false, isFetching: false, readAccessBlocked: false, refetch: () => assignmentRetries++ },
  };
  const overrides = {
    'react': { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {} },
    '@tanstack/react-query': { useQueryClient: () => ({ refetchQueries: () => permissionRetries++ }) },
    '@/hooks/use-profile-next-shift': { useProfileNextShiftSources: () => state,
      useAcknowledgePersonalDuty: () => ({ canSubmit: false, pending: false, busy: false, succeeded: false, errorMessage: null, submit: async () => {} }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => false, roles: [], isLoading: false, error: null }) },
    'next/link': { default: props => React.createElement('a', props) },
  };
  const loaded = new Map();
  const front = path.join(__dirname, '../..');
  class FixedDate extends Date { constructor(...values) { super(...(values.length ? values : [state.browserNow])); } }
  function load(id, from = front) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(front, id.slice(2)) : path.resolve(from, id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    const exports = {};
    if (!file) return exports;
    if (loaded.has(file)) return loaded.get(file);
    loaded.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: child => load(child, path.dirname(file)), Date: FixedDate, Intl,
      performance: { now: () => state.monotonicMs } });
    return exports;
  }
  const subject = load('@/widgets/my-profile/ui/MyNextShift');
  const tree = () => {
    assert.equal(typeof subject.MyNextShift, 'function', 'personal next shift panel must be implemented');
    return subject.MyNextShift({ employeeId: '17' });
  };
  return { state, row, tree, html: () => renderToStaticMarkup(tree()),
    retries: () => [dutyRetries, assignmentRetries, permissionRetries] };
}

test('personal panel binds exact personnel hours into the compact top card', () => {
  const f = fixture();
  const result = f.html();
  assert.match(result, /Личный объект/);
  assert.match(result, /Пост 2/);
  assert.match(result, /13:00/);
  assert.match(result, /17:00/);
});

test('a blocked personal source hides its retained private payload and leaves a clear incomplete result', () => {
  const f = fixture();
  f.state.duties.readAccessBlocked = true;
  const result = f.html();
  assert.doesNotMatch(result, /Личный объект/);
  assert.match(result, /определить не удалось/);
});

test('a failed current permission check hides every retained source in the panel', () => {
  const f = fixture();
  f.state.authorityAvailable = false;
  const result = f.html();
  assert.doesNotMatch(result, /Личный объект/);
  assert.match(result, /доступ/);
});

test('a transient refresh failure labels the retained result as incomplete', () => {
  const f = fixture();
  f.state.duties.isError = true;
  const result = f.html();
  assert.match(result, /Личный объект/);
  assert.match(result, /сохранённые данные/);
  assert.match(result, /по всем источникам подтвердить не удалось/);
});

test('personal recovery refreshes both self sources and retries permission authority first when unavailable', () => {
  const f = fixture();
  f.tree().props.onRetry();
  assert.deepEqual(f.retries(), [1, 1, 0]);
  f.state.authorityAvailable = false;
  f.tree().props.onRetry();
  assert.deepEqual(f.retries(), [1, 1, 1]);
});

test('a workstation on another year cannot hide a shift selected from the server instant', () => {
  const f = fixture();
  f.state.browserNow = '2031-01-01T12:00:00Z';
  assert.match(f.html(), /Личный объект/);
});

test('monotonic elapsed time advances the next exit even if the workstation clock moves backwards', () => {
  const f = fixture();
  f.row.planned_start = '2026-10-20T11:00:00+05:00';
  f.row.planned_end = '2026-10-20T12:00:20+05:00';
  f.state.duties.data.results.push({ ...f.row, id: 'next', object_label: 'Следующий объект',
    planned_start: '2026-10-20T13:00:00+05:00', planned_end: '2026-10-20T14:00:00+05:00' });
  assert.match(f.html(), /Личный объект/);
  f.state.monotonicMs += 30_000;
  f.state.browserNow = '2020-01-01T00:00:00Z';
  const result = f.html();
  assert.match(result, /Следующий объект/);
  assert.doesNotMatch(result, /Личный объект/);
});

test('without a valid server time anchor the panel shows incomplete data instead of guessing the current shift', () => {
  const f = fixture();
  delete f.state.duties.data.receivedMonotonicMs;
  const result = f.html();
  assert.doesNotMatch(result, /Личный объект/);
  assert.match(result, /серверное время/);
  assert.match(result, /определить не удалось/);
});
