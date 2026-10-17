const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function readMap(rows) {
  const exports = {};
  const dependencies = {
    react: { useContext: () => 1 },
    './workspace-context': { ServiceSummaryRootContext: {} },
    '@tanstack/react-query': { useQuery: options => ({ isPending: false, isError: false,
      data: options.queryKey[1] === 'tree' ? { nodes: [{ division_id: 1, parent_id: null }] } : rows }) },
    '@/entities/daily-grid': { DAILY_SUBMISSIONS_PATH: '/daily', buildDivisionForest: () => ({ childrenOf: new Map() }), parseSubmissionList: value => value },
    '@/lib/api': {}, '@/lib/ops-api': {},
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/service-summary/model/use-service-tree.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => dependencies[name] ?? require(name) });
  return exports.useServiceTree('2026-12-01').submissionByDivision;
}
for (const reverse of [false, true]) test(`root and department current versions survive full history in ${reverse ? 'ascending' : 'descending'} order`, () => {
  const rows = [1, 2].flatMap(division => [
    { division_id: String(division), business_date: '2026-12-01', is_current: true, version: 2 },
    { division_id: String(division), business_date: '2026-12-01', is_current: false, version: 1 },
  ]);
  const map = readMap(reverse ? rows.reverse() : rows);
  assert.equal(map.get('1').version, 2); assert.equal(map.get('2').version, 2);
});
test('history-only and another business date do not count as submitted today', () => {
  const map = readMap([
    { division_id: '1', business_date: '2026-12-01', is_current: false, version: 1 },
    { division_id: '2', business_date: '2026-11-30', is_current: true, version: 3 },
  ]);
  assert.equal(map.size, 0);
});
