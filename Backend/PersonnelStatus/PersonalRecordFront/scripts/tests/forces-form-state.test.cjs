const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(file, component, initial = []) {
  const state = [...initial], refs = [], calls = [];
  let slot = 0, ref = 0, nodes = [];
  const mutation = { isPending: false, error: null, reset() {}, mutate: (body, options) => calls.push({ body, options }) };
  const deps = {
    react: { useState: value => { const i = slot++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useMemo: fn => fn(), useEffect() {}, useRef: value => refs[ref++] ?? (refs[ref - 1] = { current: value }) },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@tanstack/react-query': { useQuery: () => ({ data: [{ id: 2, name: 'Department', type_code: 'department' }], isPending: false }) },
    '@/hooks/use-force-collections': { useSplitCollection: () => mutation },
    '@/hooks/use-force-campaigns': { useAssignForceCampaign: () => mutation, useHandOverForceCampaign: () => ({ isPending: false }) },
    '@/hooks/use-participation-catalog': { useParticipationCatalog: () => ({ data: [] }) },
    '@/shared/lib/date': { formatIsoDate: x => x },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../features/force-collections/ui', file), 'utf8') + `\nexport { ${component} as Subject };`;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => deps[name] ?? new Proxy({}, { get: (_, key) => String(key) }) });
  function render(props) { slot = 0; ref = 0; nodes = [];
    const walk = value => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(walk);
      nodes.push(value); walk(value.props?.children); };
    walk(exports.Subject(props)); return nodes;
  }
  const find = label => nodes.find(node => node.props?.['aria-label'] === label) ?? nodes.find(node =>
    (Array.isArray(node.props?.children) ? node.props.children.filter(x => typeof x === 'string').join('').trim() : node.props?.children) === label);
  return { render, find, calls };
}

test('sending a newly created split clears its accepted draft even when the server had no draft before', () => {
  const f = fixture('ForceCollectionCard.tsx', 'SplitEditor');
  const props = { data: { eventId: '3', need: 4, allocations: [] }, sentRows: [], onSavingChange() {} };
  f.render(props); f.find('Департамент').props.onClick(); f.render(props);
  f.find('Департамент, строка 1').props.onChange({ target: { value: '2' } }); f.render(props);
  f.find('Отправить').props.onClick();
  assert.equal(f.calls[0].body.rows[0].need, 4);
  f.calls[0].options.onSuccess(); f.calls[0].options.onSettled();
  props.sentRows = [{ departmentId: '2', need: 4 }];
  const nodes = f.render(props);
  assert.equal(nodes.filter(node => node.props?.['data-slot'] === 'draft-row').length, 0);
});

test('a failed split preserves the entered draft for correction', () => {
  const f = fixture('ForceCollectionCard.tsx', 'SplitEditor');
  const props = { data: { eventId: '3', need: 4, allocations: [] }, sentRows: [], onSavingChange() {} };
  f.render(props); f.find('Департамент').props.onClick(); f.render(props);
  f.find('Отправить').props.onClick(); f.calls[0].options.onError({ kind: 'validation', details: {} }); f.calls[0].options.onSettled();
  assert.equal(f.render(props).filter(node => node.props?.['data-slot'] === 'draft-row').length, 1);
});

test('accepted campaign assignment clears the selected person and conflict form, preserving the target', () => {
  const f = fixture('ForceCampaignsPanel.tsx', 'ForceCampaignWorkspace', ['63','3','5','p1','',false,'']);
  const props = { campaign: { id: '1', status: 'DISTRIBUTING', pool: [{ employeeId: '63', kindCode: 'PHYSICAL_SQUAD' }],
    assignments: [], warnings: [], events: [{ eventId: '3', businessDate: '2026-10-30', visitObjects: [{ visitObjectId: '5' }],
      demandRows: [{ id: 'p1', visitObjectId: '5', kindCode: 'PHYSICAL_SQUAD', need: 1 }] }] }, onBack() {} };
  const nodes = f.render(props);
  nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.length, 1);
  f.calls[0].options.onSuccess();
  f.render(props);
  assert.equal(f.find('Сотрудник').props.value, '');
  assert.equal(f.find('Объект').props.value, '5');
});
