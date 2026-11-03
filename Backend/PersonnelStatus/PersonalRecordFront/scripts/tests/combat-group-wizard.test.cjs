const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Exercise the real component's rendered controls and handlers. Only host UI,
// network and navigation are substituted; no live database or browser is needed.
function setup({ noGroups = false, fail = false } = {}) {
  const slots = []; let cursor = 0; const writes = []; let closed = false; let configured = false; let candidatesFailed = false;
  const people = ['Асан', 'Болат', 'Вера'].map((employeeName, i) => ({ employeeId: String(i + 1), employeeName,
    divisionId: '3', unitName: 'Отдел', inService: i !== 2, blockReason: i === 2 ? 'Отпуск' : '', eventWarning: false }));
  const choices = { groups: noGroups ? [] : [{ id: 'g', divisionId: '3', name: 'Группа 1', maxMembers: 2 }, { id: 'foreign', divisionId: '4', name: 'Чужая', maxMembers: 4 }],
    types: [{ id: 't', divisionId: '3', name: 'Дневное' }], places: [], routes: [], divisions: [], events: [{ id: 'om', title: 'Проверочное ОМ' }], objectChoices: [], permissions: { roster: true, manageCatalogs: true } };
  const deps = {
    react: { ...React, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; } },
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
    '@/components/ui/dialog': { Dialog: 'dialog', DialogContent: 'div', DialogHeader: 'header', DialogTitle: 'h2' },
    '@/entities/combat-duty': { COMBAT_PATH: '/api/ops/combat-duty-board/' },
    '@/hooks/use-combat-duty': { useCombatRead: () => ({ data: candidatesFailed ? undefined : { results: people }, isError: candidatesFailed, refetch: () => { candidatesFailed = false; } }), useCombatRefresh: () => async () => {} },
    '@/lib/ops-api': { opsApiClient: { post: async (...args) => { writes.push(args); if (fail) throw Error('Проверочная ошибка'); } } },
    './CombatLocationFields': { CombatLocationFields: () => null },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../features/combat-duty/ui/CombatGroupForm.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: n => deps[n] ?? require(n), URLSearchParams, Number, Error });
  const tree = () => { cursor = 0; return exports.CombatGroupForm({ date: '2026-11-03', divisionId: '3', choices,
    onClose: () => { closed = true; }, onConfigure: () => { configured = true; } }); };
  const all = node => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
  const nodes = () => all(tree());
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node ?? '';
  const button = label => { const n = nodes().find(n => n.type === 'button' && text(n) === label); assert.ok(n, `button ${label}`); return n; };
  const change = (label, value) => { const n = nodes().find(n => n.props['aria-label'] === label); assert.ok(n, label); n.props.onChange({ target: { value, checked: value } }); };
  const submit = async () => { await nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); };
  const group = () => { change('Группа', 'g'); change('Вид дежурства', 't'); button('Далее: люди').props.onClick(); };
  const member = () => { group(); change('Добавить: Асан', true); };
  const location = value => { const n = nodes().find(n => n.props.onChange && n.props.divisionId === '3'); assert.ok(n, 'location fields'); n.props.onChange(value); };
  return { nodes, text, button, change, submit, group, member, location, writes, closed: () => closed, configured: () => configured, failCandidates: () => { candidatesFailed = true; } };
}

test('new assignment starts with group only; own catalog choices and explicit setup recovery', () => {
  const h = setup();
  assert.equal(h.button('Далее: люди').props.disabled, true);
  assert.equal(h.nodes().some(n => n.props['aria-label'] === 'Добавить: Асан'), false);
  assert.equal(h.nodes().some(n => n.type === 'option' && n.props.value === 'foreign'), false);
  const empty = setup({ noGroups: true }); empty.button('Настроить справочники').props.onClick();
  assert.equal(empty.configured(), true);
});

test('a step button cancels the native click default so changing it into a submit cannot send the draft', () => {
  const h = setup(); h.change('Группа', 'g'); h.change('Вид дежурства', 't');
  const click = new Event('click', { cancelable: true });
  h.button('Далее: люди').props.onClick(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(h.writes.length, 0);
});

test('selection stays visible, blocked people and capacity remain disabled, leader is explicit', () => {
  const h = setup(); h.member();
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Добавить: Асан').props.checked, true);
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Добавить: Вера').props.disabled, true);
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Старший: Асан').props.checked, true);
  h.change('Добавить: Болат', true);
  h.change('Старший: Болат', true);
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Старший: Асан').props.checked, false);
  h.button('Назад').props.onClick(); h.button('Далее: люди').props.onClick();
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Добавить: Болат').props.checked, true);
});

test('Enter cannot send at the first steps and a common place is required before sending', async () => {
  const h = setup(); await h.submit(); assert.equal(h.writes.length, 0);
  h.member(); await h.submit(); assert.equal(h.writes.length, 0);
  assert.equal(h.button('Отправить состав').props.disabled, true);
  await h.submit(); assert.equal(h.writes.length, 0);
  h.location({ kind: 'POINT', latitude: 51.1, longitude: 71.4 });
  assert.equal(h.button('Отправить состав').props.disabled, false);
  await h.submit(); assert.equal(h.writes.length, 1); assert.equal(h.closed(), true);
  assert.equal(h.writes[0][1].eventId, null);
  assert.equal(h.writes[0][1].location.kind, 'POINT');
});

test('a candidate refresh failure on the last step explains the block and can recover without losing the place', () => {
  const h = setup(); h.member(); h.button('Далее: место').props.onClick();
  h.location({ kind: 'POINT', latitude: 51.1, longitude: 71.4 }); h.failCandidates();
  assert.equal(h.button('Отправить состав').props.disabled, true);
  assert.ok(h.nodes().some(n => n.props.role === 'alert' && h.text(n).includes('сотрудников')));
  h.button('Повторить').props.onClick();
  assert.equal(h.button('Отправить состав').props.disabled, false);
});

test('back navigation preserves the common place and optional OM; failed submit keeps the draft', async () => {
  const h = setup({ fail: true }); h.member(); h.button('Далее: место').props.onClick();
  h.location({ kind: 'POINT', latitude: 51.1, longitude: 71.4 }); h.change('Охранное мероприятие группы', 'om');
  h.button('Назад').props.onClick(); h.button('Далее: место').props.onClick();
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Охранное мероприятие группы').props.value, 'om');
  await h.submit(); assert.equal(h.closed(), false); assert.equal(h.writes[0][1].location.latitude, 51.1);
  assert.ok(h.nodes().some(n => n.props.role === 'alert' && h.text(n).includes('Проверочная ошибка')));
});
