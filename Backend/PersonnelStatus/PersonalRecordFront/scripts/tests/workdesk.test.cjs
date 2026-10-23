const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load() {
  const filename = path.join(__dirname, '../../features/portal-workspace/desk-model.ts');
  if (!fs.existsSync(filename)) return {};
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URLSearchParams });
  return exports;
}
test('workdesk follows actual authorized destinations and retains mixed-role department priority', () => {
  const { workdeskKind } = load();
  const tasks = (...ids) => ids.map(id => ({ id }));
  assert.equal(workdeskKind(tasks('assistant', 'users'), true), 'admin');
  assert.equal(workdeskKind(tasks('assistant', 'headquarters', 'department-forces'), false), 'department');
  assert.equal(workdeskKind(tasks('headquarters', 'assistant'), false), 'commander');
  assert.equal(workdeskKind(tasks('statuses'), false), 'status');
  assert.equal(workdeskKind(tasks('personal'), false), 'personal');
});
const request = { allocationId: 'a/1', title: 'Встреча', businessDate: '2026-10-25', need: 20, allocating: null, assigned: 0, status: 'NOTIFIED', stage: 'FORCES', overdue: false, departmentName: 'Шестой департамент' };
test('request links target exact allocation and preserve business date without injecting query parameters', () => {
  const result = load().departmentWorkRow(request);
  const q = new URLSearchParams(result.href.split('?')[1]);
  assert.equal(q.get('request'), 'a/1'); assert.equal(q.get('businessDate'), '2026-10-25');
  assert.equal(q.get('tab'), 'requests'); assert.equal(result.action, 'Подготовить ответ');
});
test('zero response is distinct from unanswered, returned work is highlighted and sent work is read-only navigation', () => {
  const { departmentWorkRow } = load();
  assert.equal(departmentWorkRow({ ...request, allocating: 0, status: 'DECLINED' }).action, 'Посмотреть ответ');
  assert.equal(departmentWorkRow({ ...request, status: 'RETURNED' }).action, 'Исправить ответ');
  assert.equal(departmentWorkRow({ ...request, status: 'SUBMITTED', allocating: 12 }).action, 'Посмотреть ответ');
  assert.equal(departmentWorkRow({ ...request, status: 'ACCEPTED' }).tone, 'quiet');
  assert.equal(departmentWorkRow({ ...request, overdue: true }).tone, 'attention');
  assert.equal(departmentWorkRow({ ...request, allocating: 12 }).status, 'Идёт подбор');
});
test('closed events never ask for new responses even when an old request is overdue', () => {
  const { departmentWorkRow } = load();
  for (const stage of ['APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED']) {
    const result = departmentWorkRow({ ...request, stage, overdue: true });
    assert.equal(result.action, 'Посмотреть запрос'); assert.equal(result.tone, 'quiet');
  }
});
