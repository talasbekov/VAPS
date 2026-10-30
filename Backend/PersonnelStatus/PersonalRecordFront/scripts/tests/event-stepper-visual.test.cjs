const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const stages = load('entities/security-event/model/stage-meta.ts');
const { EventStepper } = load('widgets/security-event-stepper/ui/EventStepper.tsx', {
  '@/entities/security-event': stages,
  react: { ...React, useId: () => 'stepper-test' },
  './EventStepper.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
});
function nodes(tree) {
  const result = [];
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; result.push(node); visit(node.props?.children); }
  visit(tree); return result;
}
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(''); if (tree == null || typeof tree === 'boolean') return ''; return typeof tree === 'object' ? text(tree.props?.children) : String(tree); }
test('all nine real stages retain the existing five-step mapping and one actual current marker', () => {
  for (const stage of stages.STAGE_ORDER) {
    const tree = EventStepper({ stage });
    assert.equal(tree.props['data-stage'], stage);
    const all = nodes(tree), cards = all.filter(n => n.type === 'li');
    assert.equal(cards.length, 5);
    assert.equal(cards[stages.stepIndexOfStage(stage)].props['data-state'], 'current');
    assert.equal(all.filter(n => n.props?.['aria-current'] === 'step').length, 1);
    for (const step of stages.EVENT_STEPS) assert.ok(text(tree).includes(step.label));
  }
});
test('reader retains static cards and cannot acquire navigation through visual styling', () => {
  const tree = EventStepper({ stage: 'APPROVAL' });
  assert.equal(nodes(tree).filter(n => n.type === 'button').length, 0);
  assert.equal(nodes(tree).filter(n => n.type === 'li').map(n => n.props['data-state']).join('|'), 'done|done|current|future|future');
  assert.ok(text(tree).includes('Текущий этап'));
});
test('privileged cards preserve callback index and viewed versus actual-current semantics', () => {
  const selected = [];
  const tree = EventStepper({ stage: 'APPROVAL', viewedIndex: 0, onSelect: index => selected.push(index) });
  const buttons = nodes(tree).filter(n => n.type === 'button');
  assert.equal(buttons.length, 5);
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(selected, [0, 1, 2, 3, 4]);
  assert.equal(buttons[0].props['aria-pressed'], true);
  assert.equal(buttons[2].props['aria-current'], 'step');
  assert.equal(buttons[2].props['aria-pressed'], false);
  assert.equal(nodes(tree).filter(n => n.type === 'li')[0].props['data-state'], 'viewed');
  assert.match(text(tree), /Просмотр шага 1 из 5/);
});
test('existing internal captions including deliberately empty automatic stages are preserved', () => {
  for (const stage of ['BULLETIN', 'DEMAND', 'FORCES', 'CONDUCT']) {
    const tree = EventStepper({ stage });
    assert.ok(text(tree).includes(stages.STAGE_WITHIN_STEP[stage]));
    if (stages.STAGE_WITHIN_STEP[stage]) assert.match(text(tree), /Шаг \d из 5/);
  }
});
test('closed event has an explicit closed caption without losing its final current-step marker', () => {
  const tree = EventStepper({ stage: 'CLOSED' });
  assert.match(text(tree), /Закрыто/);
  assert.equal(nodes(tree).filter(n => n.props?.['aria-current'] === 'step').length, 1);
});
