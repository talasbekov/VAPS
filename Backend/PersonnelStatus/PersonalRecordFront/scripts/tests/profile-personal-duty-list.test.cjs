const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const exportsOf = {};
const component = ({ children }) => React.createElement('div', null, children);
const deps = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '../model/assignment-filters': { profileBusinessDate: () => '2026-10-30', matchesAssignmentPeriod: (from, to, period, today) =>
    period === 'all' || (period === 'upcoming' ? from > today : from <= today && today <= (to || from)) },
  '@/shared/lib/date': { formatIsoDate: x => x, formatIsoDateTime: x => x },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../widgets/my-profile/ui/ProfileBody.tsx'), 'utf8') + '\nexport { EventsTab as Subject };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exportsOf, require: id => deps[id] ?? new Proxy({}, { get: () => component }) });

const row = { id: 'STATUS:1', source: 'STATUS', source_id: 1, source_state: 'PLANNED', business_date: '2026-10-31',
  date_start: '2026-10-31', date_end: '2026-10-31', object_label: 'OBJ-002', post_label: 'Пост 1',
  planned_start: '2026-10-31T08:00:00+05:00', planned_end: '2026-10-31T12:00:00+05:00', actual_start: null,
  acknowledged_at: '2026-10-30T12:08:00+05:00', instruction: 'Test duty', readOnly: true };
function render(shifts, period = 'all', extra = {}) {
  return renderToStaticMarkup(React.createElement(exportsOf.Subject, {
    assignments: [], note: null, loading: false, failed: false, available: true, onRetry() {},
    shifts: [], personalDuties: shifts, shiftsNote: null, shiftsLoading: false, shiftsFailed: false, shiftsAvailable: true,
    onRetryShifts() {}, filters: { kind: 'shifts', period }, onFiltersChange() {}, ...extra,
  }));
}
test('a status-based duty from the nearest-shift source appears in assignments with plan and acknowledgement', () => {
  const html = render([row]);
  assert.match(html, /OBJ-002/); assert.match(html, /Пост 1/); assert.match(html, /2026-10-31/);
  assert.match(html, /Ознакомлен/); assert.match(html, /2026-10-31T08:00/);
});
test('personal duties preserve period filters and omit cancelled or completed rows', () => {
  assert.doesNotMatch(render([row], 'current'), /OBJ-002/);
  assert.match(render([row], 'upcoming'), /OBJ-002/);
  assert.doesNotMatch(render([{ ...row, source_state: 'CANCELLED' }]), /OBJ-002/);
  assert.doesNotMatch(render([row], 'all', { readOnly: true }), /OBJ-002/);
});

test('an acknowledged personal duty uses a readable state label', () => {
  const html = render([{ ...row, source_state: 'ACKNOWLEDGED' }]);
  assert.doesNotMatch(html, /ACKNOWLEDGED/);
  assert.match(html, /Ознакомлен/);
});
