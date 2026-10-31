const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, name, dependencies) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') + `\nexport { ${name} as Subject };`;
  const component = ({ children }) => React.createElement('div', null, typeof children === 'function' ? children() : children);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: id => dependencies[id] ??
    (id === 'react' || id === 'react/jsx-runtime' ? require(id) : new Proxy({}, { get: () => component })) });
  return exports.Subject;
}
const event = { id: '3', code: 'ОМ-2026-3', title: 'Test visit', kind: 'FOREIGN', stage: 'APPROVAL',
  businessDate: '2026-10-30', protectedPersonName: '', chiefId: '63', vehicles: [] };
const flight = { date: '30.10.2026', time: '', route: '', flight: '', dur: '' };
function summary() { return { filled: false, visit: { status: 'APPROVED', approvedAt: '2026-10-30T10:00:00Z' },
  unspecified: ['arrival.date', 'departure.date'], summary: { country: 'Test', persons: [], arrival: { ...flight }, departure: { ...flight },
    stay: { place: '', room: '' }, responsible: null, senior: null, groups: [], transport: [], visits: [], meet: [], farewell: [], delegation: [] } }; }

function renderPanel(row) {
  const Subject = load('widgets/gvo-summary/ui/GvoSummaryPanel.tsx', 'GvoSummaryPanel', {
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true }) },
    '@/hooks/use-security-event-stages': { usePersonnelMe: () => ({ data: { id: '63' } }) },
    '@/hooks/use-gvo-summaries': { useGvoSummary: () => ({ data: row }) },
    '@/components/page-header': { PageHeader: ({ title, description }) => React.createElement('div', null, title, description) },
    '@/entities/gvo-summary': { canManageGvoSummary: () => true, gvoCountryAbbr: () => 'T', gvoStaffCount: () => 0, UNSPECIFIED: 'уточняется' },
  });
  return renderToStaticMarkup(React.createElement(Subject, { event }));
}
test('flagged flight dates remain unspecified in both the title and read-only flight cards', () => {
  const row = summary(), before = JSON.stringify(row);
  const html = renderPanel(row);
  assert.doesNotMatch(html, /30\.10\.2026/);
  assert.ok((html.match(/уточняется/g) ?? []).length >= 4);
  assert.equal(JSON.stringify(row), before, 'read projection must not mutate query data');
});
test('approved summary status is not replaced by a draft label when there is no manual patch', () => {
  const html = renderPanel(summary());
  assert.match(html, /Сводка утверждена/);
  assert.doesNotMatch(html, /Черновик сводки/);
});

for (const filled of [false, true]) test(`READY visit uses the server filled=${filled} after a manual reset or save`, () => {
  const row = summary(); row.visit.status = 'READY'; row.filled = filled;
  const html = renderPanel(row);
  assert.match(html, filled ? /Сводка заполнена/ : /Черновик сводки/);
  assert.doesNotMatch(html, filled ? /Черновик сводки/ : /Сводка заполнена/);
});
test('PDF generation failure remains visible on the visit page with a meaningful converter error', () => {
  const Subject = load('app/security-ops/visits/[id]/page.tsx', 'VisitCard', {
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: () => true }) },
    '@/hooks/use-gvo-summaries': { useGvoSummary: () => ({ data: summary() }), useApproveVisit: () => ({ error: null }) },
    '@/hooks/use-ops-reports': { useRenderEventDocument: () => ({ error: { message: 'Конвертер PDF недоступен.', errorCode: 'PDF_CONVERTER_MISSING' }, isPending: false }) },
    '@/entities/security-event': { SECURITY_EVENT_KIND_LABEL: { FOREIGN: 'Foreign' } },
    '@/shared/lib/date': { formatIsoDate: x => x, formatIsoDateTime: x => x },
    '@/components/page-header': { PageHeader: ({ actions }) => React.createElement('div', null, actions) },
  });
  const html = renderToStaticMarkup(React.createElement(Subject, { event }));
  assert.match(html, /role="alert"[^>]*>[^<]*Не удалось скачать PDF/);
  assert.match(html, /Конвертер PDF недоступен/);
});
