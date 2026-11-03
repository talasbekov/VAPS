const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '../..');
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
  }, { filename: relative });
  return exports;
}
const daily = load('entities/daily-grid/index.ts');
const row = (version, extra = {}) => ({
  id: 100 + version, division_id: '9101', business_date: '2026-10-09',
  version, is_current: true, event: 'CHANGED', submitted_by: 'Operator',
  submitted_at: '2026-10-08T07:00:00Z', late: false,
  sent_at: null, sent_by: '', incomplete_reason: '', ...extra,
});

// Keep network/query hooks inert and supply the component's persisted state.
// Assertions inspect its real rendered headline, not a copy of its selection logic.
function render({ submission = null, submitted = null, amended = null, confirming = false, canSubmit = false, ...props } = {}) {
  const state = [confirming, submitted, null, false, amended];
  const { DaySubmissionPanel } = load('features/ops-daily/day-submission-panel.tsx', {
    react: { ...require('react'), useState: () => [state.shift(), () => {}],
      useMemo: fn => fn(), useEffect: () => {} },
    '@tanstack/react-query': { useQuery: () => ({}), useQueryClient: () => ({}) },
    '@/lib/ops-api': { opsApiClient: {} },
    '@/lib/ops-errors': load('lib/ops-errors.ts'),
    '@/hooks/use-ops-mutation': { useOpsMutation: () => ({ error: null, isPending: false }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, error: null, hasPermission: code => canSubmit && code === 'daily_report.mark_update' }) },
    '@/entities/daily-grid': daily,
    '@/shared/lib/date': load('shared/lib/date.ts'),
  });
  return renderToStaticMarkup(DaySubmissionPanel({
    divisionId: '9101', businessDate: '2026-10-09', dateValid: true,
    rowCount: 2, dirtyCount: 0, localDrift: [], submission, submissions: [],
    isLoading: false, isError: false, canCorrect: false, ...props,
  }));
}

test('server amendment replaces a previous successful local submission in the headline', () => {
  assert.match(render({ submitted: row(1), submission: row(2) }), /День сдан: v2/);
});
test('server amendment replaces a previous successful local amendment in the headline', () => {
  assert.match(render({ submitted: row(1), amended: row(2), submission: row(3) }), /День сдан: v3/);
});
test('new local amendment remains visible while the parent still has the older server version', () => {
  assert.match(render({ amended: row(2), submission: row(1) }), /День сдан: v2/);
});
test('a successful local submission remains visible before the list refetch completes', () => {
  assert.match(render({ submitted: row(1) }), /День сдан: v1/);
});
test('equal-version refresh uses fresh server metadata', () => {
  const html = render({ submitted: row(1), submission: row(1, { submitted_by: 'Updated author' }) });
  assert.match(html, /Updated author/);
});
test('a previous division cannot mark the newly selected division as submitted', () => {
  assert.match(render({ submitted: row(1), divisionId: '9102' }), /День не сдан/);
});
test('a previous date cannot mark the newly selected day as submitted', () => {
  assert.match(render({ amended: row(2), businessDate: '2026-10-10' }), /День не сдан/);
});

test('confirmation names the report date and canonical selected-unit count', () => {
  const html = render({ confirming: true, canSubmit: true, rowCount: 7 });
  assert.match(html, /Сдать расход за 09\.10\.2026\? Сотрудников по списку: 7/);
  assert.match(html, /Подтвердить сдачу/);
  assert.doesNotMatch(html, /Изменено 0|станет зелёным|Категория — ожидается/);
});

test('read-only users see day state without a submit button or stale confirmation', () => {
  assert.doesNotMatch(render(), /<button/);
  assert.match(render(), /нет права сдавать день/);
  assert.doesNotMatch(render({ confirming: true }), /Подтвердить сдачу/);
});

test('loading and failed reads never leave a confirm action active', () => {
  for (const props of [{ isLoading: true }, { isError: true }]) {
    assert.doesNotMatch(render({ confirming: true, canSubmit: true, ...props }), /Подтвердить сдачу/);
  }
});

test('history keeps both versions available while the current headline stays visible', () => {
  const html = render({ submission: row(2), submissions: [row(1, { is_current: false }), row(2)] });
  assert.match(html, /День сдан: v2/);
  assert.match(html, /<details class="text-sm"><summary/);
  assert.match(html, /История сдачи за 09\.10\.2026 · 2/);
  assert.match(html, /v1 ·/);
  assert.match(html, /действующая/);
});
