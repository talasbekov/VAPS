const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function model() {
  const exports = {};
  const file = path.join(__dirname, '../../features/object-passport/model/inspections.ts');
  assert.ok(fs.existsSync(file), 'Inspection workflow model is implemented');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports });
  return exports;
}
test('passport exposes only functional tabs and old prototype links open general', () => {
  const m = model();
  assert.deepEqual(Array.from(m.PASSPORT_TABS, tab => tab.code), ['general', 'posts', 'check', 'history']);
  for (const legacy of ['infra', 'groups', 'unknown', null]) assert.equal(m.passportTab(legacy), 'general');
  assert.equal(m.passportTab('check'), 'check');
});
test('inspection editing preserves input identity but never sends server resolution fields', () => {
  const m = model();
  const draft = m.inspectionDraft({ inspectedOn: '2026-10-20', items: [
    { id: 'q1', question: 'Question', answer: 'no', finding: 'Issue', responsibleUsername: 'inspector', dueOn: '2026-11-01',
      resolvedBy: {id: '3'}, resolvedAt: '2026-10-21', resolution: 'Done' },
  ] });
  assert.equal(draft.items[0].id, 'q1');
  assert.equal(draft.items[0].dueOn, '2026-11-01');
  assert.equal('resolvedAt' in draft.items[0], false);
  assert.equal('resolvedBy' in draft.items[0], false);
});
test('completion explains missing answers and finding ownership', () => {
  const m = model();
  assert.ok(m.inspectionCompletionIssue({items: []}));
  const item = {id: 'q1', question: 'Question', answer: '', finding: '', responsibleUsername: '', dueOn: null};
  assert.ok(m.inspectionCompletionIssue({items: [item]}));
  item.answer = 'no';
  assert.ok(m.inspectionCompletionIssue({items: [item]}));
  item.finding = 'Issue'; item.responsibleUsername = 'inspector'; item.dueOn = '2026-11-01';
  assert.equal(m.inspectionCompletionIssue({items: [item]}), null);
});

