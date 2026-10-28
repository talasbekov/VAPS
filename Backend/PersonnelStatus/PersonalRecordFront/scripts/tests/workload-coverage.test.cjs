const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, URLSearchParams, Intl, Date, FormData, require: id => {
    if (id in dependencies) return dependencies[id];
    if (id === '@/features/service-analytics/model/workload-coverage') return model();
    if (id === '@/entities/service-analytics') return load('entities/service-analytics/index.ts');
    return require(id);
  } });
  return exports;
}
function model() { return load('features/service-analytics/model/workload-coverage.ts'); }

test('coverage dates reject invalid calendar days and windows beyond 31 inclusive days', () => {
  const { validateCoveragePeriod } = model();
  assert.equal(validateCoveragePeriod('2026-10-01', '2026-10-31'), null);
  assert.equal(validateCoveragePeriod('2028-02-29', '2028-02-29'), null);
  for (const [from, to] of [['2026-02-29', '2026-02-29'], ['2026-10-01', '2026-11-01'],
    ['2026-10-14', '2026-10-13'], ['', '2026-10-13'], ['2026-1-1', '2026-01-01'], ['0000-01-01', '0000-01-01']]) {
    assert.equal(typeof validateCoveragePeriod(from, to), 'string');
  }
});

test('unknown minutes remain different from measured zero', () => {
  const { coverageMinutes } = model();
  assert.equal(coverageMinutes(null), 'Неизвестно');
  assert.equal(coverageMinutes(0), '0 мин');
  assert.equal(coverageMinutes(90), '1 ч 30 мин');
});

const record = { id: 'OM:71', employeeId: '1', source: 'OM', sourceLabel: 'Участие в ОМ по статусу',
  label: 'Участие в ОМ по статусу', state: 'PLANNED', dateFrom: '2026-10-13', dateTo: '2026-10-14', timing: 'DATE_ONLY',
  plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null,
  plannedMinutes: null, actualMinutes: null, sourceChanged: false, includedInPlan: true };
function fixture() {
  return { state: 'AVAILABLE', period: { from: '2026-10-13', to: '2026-10-14' },
    timeZone: 'Asia/Almaty', generatedAt: '2026-10-13T09:00:00Z', maxPeriodDays: 31,
    calculationVersion: 'workload-coverage-2026.10.27', scopeLabel: 'Доступная область', reason: null,
    limitations: ['Даты участия не задают длительность.'],
    sources: [{ code: 'DUTY', label: 'Дежурства', state: 'INCLUDED', reason: 'Журнал и план.' },
      { code: 'STATUS', label: 'Статусы', state: 'UNAVAILABLE', reason: 'Нет права просмотра статусов.' }],
    employees: [{ employeeId: '1', safeLabel: 'Тестовый сотрудник', organizationUnitId: '10', divisionLabel: 'Подразделение А',
      knownPlannedMinutes: 90, confirmedActualMinutes: null, unknownPlannedRecords: 1, unknownActualRecords: 1,
      records: [record] }] };
}
function render(data, extra = {}) {
  const { WorkloadCoverage } = load('features/service-analytics/ui/WorkloadCoverage.tsx');
  return renderToStaticMarkup(React.createElement(WorkloadCoverage, { data, onPeriodChange() {}, ...extra }));
}

test('coverage shows server totals, unknown facts, source restrictions and dated evidence together', () => {
  const html = render(fixture());
  assert.match(html, /1 ч 30 мин/); // Server result; the only visible source has unknown duration.
  assert.match(html, /Неизвестно/);
  assert.match(html, /Нет права просмотра статусов/);
  assert.match(html, /2026-10-13/);
  assert.match(html, /2026-10-14/);
  assert.match(html, /Участие в ОМ по статусу/);
  assert.match(html, /Запланировано/);
  assert.match(html, /Время не задано/);
  assert.match(html, /Тестовый сотрудник/);
  assert.doesNotMatch(html, /Доступен для назначения/);
});

test('empty or unavailable coverage never claims that employees are free', () => {
  const data = fixture();
  data.employees = [];
  assert.match(render(data), /доступных источниках/);
  data.state = 'PERSONAL_DETAIL_REQUIRED';
  data.reason = 'Нужно отдельное право персональной детализации.';
  const html = render(data);
  assert.match(html, /отдельное право персональной детализации/);
  assert.doesNotMatch(html, /Свободны|Доступны для назначения/);
  assert.match(render(undefined), /Сводка источников пока недоступна/);
  assert.doesNotMatch(render(data), /Страницы сотрудников/);
});

test('large employee lists show twenty people and page controls only when needed', () => {
  const data = fixture();
  const original = data.employees[0];
  data.employees = Array.from({ length: 43 }, (_, index) => ({ ...original, employeeId: String(index + 1),
    safeLabel: `Person-${index + 1}`, records: [] }));
  const html = render(data);
  assert.match(html, /Person-20/);
  assert.doesNotMatch(html, /Person-21/);
  assert.match(html, /Страницы сотрудников/);
  const { paginateCoverage } = model();
  const last = paginateCoverage(data.employees, 3);
  assert.equal(last.rows.length, 3);
  assert.equal(last.rows[0].safeLabel, 'Person-41');
  assert.equal(paginateCoverage([], 3).pages, 1);
  assert.equal(paginateCoverage(data.employees.slice(0, 1), 3).page, 1);
});

test('source omissions remain visible while the detailed explanation is collapsed', () => {
  const html = render(fixture());
  assert.match(html, /aria-label="Не включённые источники"[^>]*>Не включены: Статусы/);
  assert.match(html, /<details[^>]*aria-label="Источники и ограничения"/);
  assert.doesNotMatch(html, /<details[^>]*aria-label="Источники и ограничения"[^>]* open/);
});

test('failed period refresh retains dates and retry without stale people or pagination', () => {
  const html = render(undefined, { period: { from: '2026-10-01', to: '2026-10-02' },
    errorMessage: 'Сводка не обновлена.', onRetry() {} });
  assert.match(html, /value="2026-10-01"/);
  assert.match(html, /value="2026-10-02"/);
  assert.match(html, /Сводка не обновлена/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /Тестовый сотрудник|Страницы сотрудников/);
});

test('load request and protected cache distinguish each factual coverage period', async () => {
  const reads = [];
  const requests = [];
  const hooks = load('hooks/use-ops-analytics.ts', {
    '@/lib/ops-api': { opsApiClient: { get: async url => { requests.push(url); return {}; } } },
    '@/hooks/use-ops-protected-read': {
      useOpsReadAccess: () => ({ actor: 'u1', scope: 'authority-2', allowed: true }),
      useOpsProtectedRead: (prefix, parts, access, read) => { reads.push({ parts, access }); return read(); },
    },
  });
  await hooks.useLoadAnalytics({ from: '2026-10-13', to: '2026-10-14' });
  await hooks.useLoadAnalytics({ from: '2026-10-15', to: '2026-10-15' });
  assert.match(requests[0], /coverage_from=2026-10-13/);
  assert.match(requests[0], /coverage_to=2026-10-14/);
  assert.notDeepEqual(reads[0].parts, reads[1].parts);
  assert.equal(reads[0].access.scope, 'authority-2');
});
