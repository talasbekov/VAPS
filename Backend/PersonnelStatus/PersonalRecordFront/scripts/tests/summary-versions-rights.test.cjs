const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

class ApiError extends Error { constructor() { super('Incomplete'); this.details = { laggards: [3] }; } }
function setup() {
  const access = { hasPermission: () => true, isLoading: false, error: null };
  const query = { isSuccess: true, isPending: false, isError: false, data: [{ id: 1, version: 1, is_current: true, sent_at: null }] };
  const sends = [];
  const mutation = { error: new ApiError(), isPending: false, isSuccess: false, mutate: body => sends.push(body) };
  const assemble = { error: null, isSuccess: false, isPending: false };
  let contextKey;
  let stateIndex = 0;
  const states = [null, null, 'Waiting for the remaining directorate'];
  const exports = {};
  const dependencies = {
    // This harness evaluates the parent's policy; the child's scoped
    // authority and writes are covered by summary-rebuild.spec.ts.
    './SummaryCorrection': { SummaryCorrection: 'SummaryCorrection' },
    // Snapshot rendering is exercised by workflow-review.spec.ts; this harness
    // keeps evaluating the parent send/correction policy independently.
    './VersionSnapshot': { VersionSnapshot: 'VersionSnapshot' },
    react: { ...require('react'), useMemo: callback => callback(), useState: () => [states[stateIndex++], () => {}] },
    '@tanstack/react-query': { useQuery: () => query },
    '@/hooks/use-daily-expense-read': { useDailyExpenseRead: () => query },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/hooks/use-strength-report': { useTrafficLightTree: () => ({}) },
    '@/hooks/use-daily-summary-write': { SUMMARY_ASSEMBLE_PERMISSION: 'daily_report.generate', useAssembleSummary: () => assemble, useSendSummary: () => mutation },
    '@/entities/daily-grid': { DAILY_SUBMISSIONS_PATH: '/daily', parseSubmissionList: value => value },
    '@/lib/ops-errors': { OpsApiError: ApiError },
    '@/shared/lib/date': { formatIsoDateTime: value => value },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/daily-expense/ui/SummaryVersions.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled + '\nexports.resolveForTest = resolveSummary;', { exports, require: name => dependencies[name] ?? (name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(name)) });
  function render(props = {}) {
    stateIndex = 0;
    const context = exports.SummaryVersions({ businessDate: '2026-10-20', scopeDivisionId: 2, boardDivisionIds: [3], labelOfDivision: String, ...props });
    // Model React's keyed child remount: its state and mutation observers are new.
    if (contextKey !== undefined && context.key !== contextKey) {
      states[1] = null;
      states[2] = '';
      Object.assign(mutation, { error: null, isSuccess: false, isPending: false });
      Object.assign(assemble, { error: null, isSuccess: false, isPending: false });
    }
    contextKey = context.key;
    const tree = context.type(context.props);
    const nodes = [];
    function visit(value) {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      nodes.push(value);
      visit(value.props?.children);
    }
    visit(tree);
    return nodes;
  }
  return { access, query, mutation, assemble, sends, render, resolve: exports.resolveForTest, contextKey: () => contextKey };
}

test('unequal department coverage requires explicit choice and excludes uncovered departments', () => {
  const subject = setup();
  const nodes = [[1, null], [2, 1], [3, 2], [4, 1], [5, 4], [6, 4], [7, 1]].map(([divisionId, parentId]) => ({ divisionId, parentId, name: `Department ${divisionId}`, isSummaryNode: false }));
  const result = subject.resolve(nodes, [3, 5, 6]);
  assert.equal(result.chosen, null);
  assert.equal(result.reason, 'ambiguous');
  assert.deepEqual(Array.from(result.candidates, row => row.id), [2, 4]);
  assert.equal(subject.resolve(nodes, [3]).chosen, 2);
  assert.equal(subject.resolve(nodes, [99]).reason, 'no-coverage');
});

for (const next of [{ businessDate: '2026-10-21' }, { scopeDivisionId: 7 }]) {
  test(`changing ${Object.keys(next)[0]} remounts reason and mutation feedback before rendering`, () => {
    const subject = setup();
    assert.ok(confirmation(subject.render()));
    const previousKey = subject.contextKey();
    subject.mutation.isSuccess = true;
    subject.assemble.isSuccess = true;
    subject.assemble.error = Error('Old assembly error');
    const tree = subject.render(next);
    assert.notEqual(subject.contextKey(), previousKey);
    assert.equal(confirmation(tree), undefined);
    assert.equal(tree.some(node => node.props?.role === 'alert' || node.props?.role === 'status'), false);
    const send = tree.find(node => node.type === 'Button' && node.props.children === 'Отправить дежурному');
    assert.ok(send);
    send.props.onClick();
    assert.equal(subject.sends[0].reason, '');
    assert.equal(subject.sends[0].business_date, next.businessDate ?? '2026-10-20');
    assert.equal(subject.sends[0].division_id, next.scopeDivisionId ?? 2);
  });
}
const confirmation = tree => tree.find(node => node.type === 'Button' && node.props.children === 'Подтвердить отправку');

test('full summary presents one incomplete-send action and sends the selected scope/date', () => {
  const subject = setup();
  const tree = subject.render();
  assert.equal(tree.filter(node => node.type === 'Button').length, 1);
  assert.equal(confirmation(tree).props.disabled, false);
  confirmation(tree).props.onClick();
  assert.equal(subject.sends.length, 1);
  assert.equal(subject.sends[0].division_id, 2);
  assert.equal(subject.sends[0].business_date, '2026-10-20');
});
test('only the full assembled summary mounts correction for its exact context', () => {
  const subject = setup();
  const target = subject.render().find(node => node.props?.['data-slot'] === 'summary-target');
  assert.ok(target, 'automatic explicit scope must remain visible');
  assert.ok(target.props.children.includes('2'), 'target name falls back to the supplied division label');
  const correction = subject.render().find(node => node.type === 'SummaryCorrection');
  assert.ok(correction);
  assert.equal(correction.props.divisionId, 2);
  assert.equal(correction.props.businessDate, '2026-10-20');
  assert.equal(subject.render({ variant: 'history' }).some(node => node.type === 'SummaryCorrection'), false);
  subject.query.data = [];
  assert.equal(subject.render().some(node => node.type === 'SummaryCorrection'), false);
});
for (const scenario of ['revoked', 'permission error', 'permission loading', 'read error', 'sent elsewhere', 'removed', 'history only']) {
  test(`incomplete-send form disappears when ${scenario}`, () => {
    const subject = setup();
    assert.ok(confirmation(subject.render()));
    if (scenario === 'revoked') subject.access.hasPermission = () => false;
    if (scenario === 'permission error') subject.access.error = Error('offline');
    if (scenario === 'permission loading') subject.access.isLoading = true;
    if (scenario === 'read error') { subject.query.isSuccess = false; subject.query.isError = true; }
    if (scenario === 'sent elsewhere') subject.query.data[0].sent_at = '2026-10-20T08:00:00Z';
    if (scenario === 'removed') subject.query.data = [];
    assert.equal(confirmation(subject.render(scenario === 'history only' ? { variant: 'history' } : {})), undefined);
    assert.equal(subject.sends.length, 0);
  });
}
