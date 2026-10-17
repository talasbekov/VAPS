const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../features/daily-expense/model/report-range.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, URLSearchParams });
const { reportRangeQuery } = moduleExports;

test('moving period after the displayed day selects its first day and preserves filters', () => {
  const query = new URLSearchParams('businessDate=2026-10-09&view=daily&search=Иванов&submitDivision=3');
  const next = reportRangeQuery(query, '2026-10-09', '2026-10-15', '2026-10-20');
  assert.equal(next.get('businessDate'), '2026-10-15');
  assert.equal(next.get('dateFrom'), '2026-10-15');
  assert.equal(next.get('dateTo'), '2026-10-20');
  for (const key of ['view', 'search', 'submitDivision']) assert.equal(next.get(key), query.get(key));
  assert.equal(query.get('businessDate'), '2026-10-09');
});
test('moving period before displayed day selects its final day', () => {
  const next = reportRangeQuery(new URLSearchParams('businessDate=2026-10-25'), '2026-10-25', '2026-10-15', '2026-10-20');
  assert.equal(next.get('businessDate'), '2026-10-20');
});
test('period edits keep the chosen day when it is still inside including either boundary', () => {
  for (const day of ['2026-10-15', '2026-10-17', '2026-10-20']) {
    const next = reportRangeQuery(new URLSearchParams(`businessDate=${day}`), day, '2026-10-15', '2026-10-20');
    assert.equal(next.get('businessDate'), day);
  }
});
test('server default remains implicit when it is inside the period', () => {
  const next = reportRangeQuery(new URLSearchParams(), '2026-10-16', '2026-10-15', '2026-10-20');
  assert.equal(next.has('businessDate'), false);
});
test('returning to day mode retains active day and other URL state', () => {
  const next = reportRangeQuery(new URLSearchParams('businessDate=2026-10-17&dateFrom=2026-10-15&dateTo=2026-10-20&search=kept'), '2026-10-17', null, null);
  assert.equal(next.get('businessDate'), '2026-10-17');
  assert.equal(next.get('search'), 'kept');
  assert.equal(next.has('dateFrom'), false);
  assert.equal(next.has('dateTo'), false);
});
test('an invalid period does not replace any of the current dates', () => {
  const query = new URLSearchParams('businessDate=2026-10-17&dateFrom=2026-10-15&dateTo=2026-10-20');
  for (const [from, to] of [['2026-10-21', '2026-10-20'], ['invalid', '2026-10-20']]) {
    assert.equal(reportRangeQuery(query, '2026-10-17', from, to).toString(), query.toString());
  }
});
