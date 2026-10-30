const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const state = [], refs = [], posts = [];
  let slot = 0, refSlot = 0;
  const grants = new Set(['status.view', 'daily_report.correct', 'daily_report.override_block']);
  const query = { isSuccess: true, isFetching: false, data: { status: 'STALE', can_rebuild: true }, refetch: async () => {} };
  const exports = {};
  const deps = {
    react: { useState: initial => { const i = slot++; if (!(i in state)) state[i] = initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef: initial => refs[refSlot++] ?? (refs[refSlot - 1] = { current: initial }) },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@tanstack/react-query': { useIsFetching: () => 0, useQuery: () => query, useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, error: null, hasPermission: code => grants.has(code) }) },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/dialog': Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(x => [x, x])),
    '@/lib/ops-api': { opsApiClient: { post: async (url, body) => { posts.push(body); } } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/daily-expense/ui/SummaryCorrection.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  let nodes;
  function render() { slot = 0; refSlot = 0; nodes = [];
    const visit = node => { if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      nodes.push(node); visit(node.props?.children); };
    visit(exports.SummaryCorrection({ divisionId: 1, businessDate: '2026-10-31' }));
    return nodes;
  }
  const find = label => nodes.find(node => node.props?.['aria-label'] === label || node.props?.children === label);
  function open() { render(); find('Исправить свод').props.onClick(); render();
    find('Причина исправления').props.onChange({ target: { value: 'Missing submissions explicitly accepted' } });
    find('Санкция на исправление').props.onChange({ target: { value: 'Test authority' } }); render(); }
  return { render, find, open, grants, query, posts };
}

test('partial correction is opt-in and sends explicit confirmation with reason and sanction', async () => {
  const f = setup(); f.open();
  const confirm = f.find('Подтверждаю пересборку неполного свода');
  assert.ok(confirm, 'partial correction requires a separate confirmation');
  assert.equal(confirm.props.checked, false);
  confirm.props.onChange({ target: { checked: true } }); f.render();
  await f.find('Создать исправленную версию').props.onClick();
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].allow_incomplete, true);
  assert.equal(f.posts[0].reason, 'Missing submissions explicitly accepted');
});

test('a revoked override grant cannot be submitted through a retained checked form', async () => {
  const f = setup(); f.open();
  const confirm = f.find('Подтверждаю пересборку неполного свода'); assert.ok(confirm);
  confirm.props.onChange({ target: { checked: true } });
  f.grants.delete('daily_report.override_block'); f.render();
  await f.find('Создать исправленную версию').props.onClick();
  assert.equal(f.posts.length, 0);
});
