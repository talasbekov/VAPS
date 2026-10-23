const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '../..');
const campaign = (id, status) => ({
  id, code: `РМ-${id}`, title: `Распределение ${id}`, status,
  events: [{ eventId: '201', code: 'ОМ-201', title: 'Визит', businessDate: '2026-10-23', businessDateEnd: null,
    eventTime: null, visitObjects: [], demandRows: [] }],
  pool: [], assignments: [], warnings: [],
});
const query = data => ({ data, isPending: false, isError: false });
const mutation = () => ({ isPending: false, isError: false, mutate() {}, reset() {} });

function panel({ rows = [], snapshot = {}, opened = null, detail = null } = {}) {
  const exports = {};
  const button = ({ children, variant, ...props }) => React.createElement('button', props, children);
  const dependencies = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'lucide-react': { ArrowLeft: () => null, ChevronRight: () => null, Plus: () => null },
    '@/components/ui/badge': { Badge: ({ children, variant, ...props }) => React.createElement('span', props, children) },
    '@/components/ui/button': { Button: button },
    '@/components/ui/input': { Input: props => React.createElement('input', props) },
    '@/components/ui/textarea': { Textarea: props => React.createElement('textarea', props) },
    '@/hooks/use-force-campaigns': {
      useForceCampaigns: () => ({ ...query({ results: rows }), ...snapshot }),
      useForceCampaign: () => query(detail),
      useCreateForceCampaign: mutation,
      useAssignForceCampaign: mutation,
      useHandOverForceCampaign: mutation,
    },
    '@/hooks/use-force-collections': { useForceCollection: () => ({ isPending: true }) },
    '@/hooks/use-participation-catalog': { useParticipationCatalog: () => query([]) },
    '@/shared/lib/date': { formatIsoDate: date => date.split('-').reverse().join('.') },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'features/force-collections/ui/ForceCampaignsPanel.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return renderToStaticMarkup(React.createElement(exports.ForceCampaignsPanel, {
    enabled: true, collectionRows: [], openedId: opened, onOpen() {},
  }));
}

// A terminal-status allowlist must never swallow a newly introduced status.
test('only handed-over and closed campaigns are inside an initially closed disclosure', () => {
  const html = panel({ rows: [campaign('11', 'HANDED_OVER'), campaign('12', 'GATHERING'), campaign('13', 'CLOSED'), campaign('14', 'RETURNED'), campaign('15', 'DRAFT'), campaign('16', 'DISTRIBUTING')] });
  const disclosure = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(disclosure, 'terminal campaigns need an expandable completed section');
  assert.doesNotMatch(disclosure.split('>')[0], /\bopen(?:=|\s|$)/);
  assert.match(disclosure, /Завершённые в этом списке[^<]*2/);
  assert.match(disclosure, /Открыть распределение РМ-11/);
  assert.match(disclosure, /Открыть распределение РМ-13/);
  const visible = html.replace(disclosure, '');
  for (const id of ['12', '14', '15', '16']) assert.match(visible, new RegExp(`Открыть распределение РМ-${id}`));
  assert.doesNotMatch(visible, /Открыть распределение РМ-(11|13)/);
  assert.ok(visible.indexOf('РМ-12') < visible.indexOf('РМ-14'), 'active rows retain server order');
  assert.match(visible, /Статус уточняется/);
});

test('an active-only list has no empty completed disclosure', () => {
  const html = panel({ rows: [campaign('21', 'DISTRIBUTING')] });
  assert.match(html, /Открыть распределение РМ-21/);
  assert.doesNotMatch(html, /<details\b|Завершённые в этом списке/);
});

test('a completed-only loaded list explains where the entries went without claiming the whole queue is empty', () => {
  const html = panel({ rows: [campaign('31', 'HANDED_OVER')] });
  assert.match(html, /В этом списке нет распределений в работе/);
  assert.match(html, /Открыть распределение РМ-31/);
  assert.doesNotMatch(html, /Отдельных распределений пока нет/);
});

test('a pending list does not claim that there is no active work', () => {
  const html = panel({ snapshot: { isPending: true } });
  assert.match(html, /Загрузка распределений/);
  assert.doesNotMatch(html, /нет распределений в работе|Отдельных распределений пока нет/);
});

test('a failed list preserves the failure message instead of an empty-queue conclusion', () => {
  const html = panel({ snapshot: { isError: true } });
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /нет распределений в работе|Отдельных распределений пока нет/);
});

test('an empty successful response retains the actual empty-list message', () => {
  assert.match(panel(), /Отдельных распределений пока нет/);
});

test('a direct link opens a handed-over campaign and retains the collection follow-up link and back control', () => {
  const html = panel({ opened: '41', detail: campaign('41', 'HANDED_OVER') });
  assert.match(html, /Назад к распределениям/);
  assert.match(html, /Распределение 41/);
  assert.match(html, /href="\/employees\?view=forces&amp;tab=collections&amp;collection=201"/);
  assert.doesNotMatch(html, /<details\b|Создать распределение|Передать в расстановку<\/button>/);
});
