const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../../features/department-requests/ui/DepartmentRequestCard.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2020,
} }).outputText;

// Execute the real card's hooks with React's dependency comparison semantics.
// Queries stay inert; the loading branch keeps this regression independent of
// the browser and presentation components. Effects still run after rendering.
function card({ ready = false, allocationOverrides = {} } = {}) {
  const answers = [];
  const submissions = [];
  const states = [];
  const previousEffects = [];
  let pendingEffects = [];
  let stateIndex = 0;
  let effectIndex = 0;
  let detail;
  const exports = {};
  const mutations = Object.fromEntries([
    'useNotifyDepartmentDirectorates', 'useRespondDepartmentAllocation',
    'useSplitDirectorateQuotas', 'useSubmitDepartmentAllocation',
    'useWithdrawDepartmentAllocation',
  ].map(name => [name, () => ({})]));
  const dependencies = {
    react: {
      ...require('react'),
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useMemo: callback => callback(),
      useEffect(callback, values) {
        const index = effectIndex++;
        const previous = previousEffects[index];
        if (!previous || values.some((value, i) => !Object.is(value, previous[i]))) pendingEffects.push(callback);
        previousEffects[index] = values;
      },
    },
    '@tanstack/react-query': { useQuery: () => ({ data: [
      { id: 2, parent: 1, name: 'Directorate', type_code: 'directorate', is_active: true },
    ] }) },
    '@/hooks/use-department-requests': {
      ...mutations, useDepartmentRequest: () => ({ data: detail, isPending: !ready }),
      useRespondDepartmentAllocation: () => ({ mutate: answer => answers.push(answer) }),
      useSubmitDepartmentAllocation: () => ({ mutate: body => submissions.push(body) }),
    },
    '@/hooks/use-participation-catalog': { useParticipationCatalog: () => ({}) },
    '@/shared/lib/date': { formatIsoDate: value => value, formatIsoDateTime: value => value },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/dialog': { Dialog: 'Dialog' },
  };
  vm.runInNewContext(compiled, {
    exports,
    require: name => dependencies[name] ?? (name.startsWith('@/') || name === 'lucide-react' ? {} : require(name)),
  }, { filename: 'DepartmentRequestCard.js' });
  return {
    render(id = 'request-a', row = {}) {
      detail = { eventId: 'event-a', allocation: {
        id, departmentId: '1', status: 'DRAFT', notifiedAt: null, members: [], need: 5, allocating: null,
        directorates: [{ divisionId: '2', need: 4, groupDemandIds: ['group-a'], ...row }],
        ...allocationOverrides,
      } };
      stateIndex = 0;
      effectIndex = 0;
      pendingEffects = [];
      const tree = exports.DepartmentRequestCard({ allocationId: id, onBack() {} });
      for (const callback of pendingEffects) callback();
      return tree;
    },
    set answer(value) { states[2] = { allocating: value, comment: '' }; },
    get answers() { return answers; },
    get submissions() { return submissions; },
    set submitOpen(value) { states[0] = value; },
    // The final two state hooks hold the numeric and special-group drafts.
    get quota() { return states.at(-2)['2']; },
    set quota(value) { states.at(-2)['2'] = value; },
    get groups() { return Array.from(states.at(-1)['2']); },
    set groups(value) { states.at(-1)['2'] = value; },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

for (const value of ['2.5', '-1', '9007199254740992']) {
  test(`invalid headcount ${value} is explained and never silently submitted`, () => {
    const subject = card({ ready: true });
    subject.render();
    subject.answer = value;
    const tree = nodes(subject.render());
    const save = tree.find(node => node.type === 'Button' && node.props.children === 'Сохранить ответ');
    assert.equal(save.props.disabled, true);
    assert.ok(tree.some(node => node.props?.id === 'answer-allocating-error'));
    save.props.onClick();
    assert.equal(subject.answers.length, 0);
  });
}

test('numeric exponent headcount is submitted with its actual numeric value', () => {
  const subject = card({ ready: true });
  subject.render();
  subject.answer = '1e2';
  const tree = nodes(subject.render());
  const save = tree.find(node => node.type === 'Button' && node.props.children === 'Сохранить ответ');
  assert.equal(Boolean(save.props.disabled), false);
  save.props.onClick();
  assert.equal(subject.answers[0].allocating, 100);
});

test('empty staff list cannot be sent even from an already-open confirmation', () => {
  const subject = card({ ready: true, allocationOverrides: { status: 'NOTIFIED', notifiedAt: '2026-10-08T08:00:00Z' } });
  subject.render();
  subject.submitOpen = true;
  const tree = nodes(subject.render());
  const send = tree.find(node => node.type === 'Button' && node.props.children === 'Отправить список в штаб');
  assert.equal(send.props.disabled, true);
  const dialog = tree.find(node => node.type === 'Dialog' && node.props.open === true);
  const confirm = nodes(dialog).find(node => node.type === 'Button' && node.props.children === 'Отправить');
  assert.equal(confirm.props.disabled, true);
  confirm.props.onClick();
  assert.equal(subject.submissions.length, 0);
});

test('a partially collected list remains submittable after confirmation', () => {
  const subject = card({ ready: true, allocationOverrides: { status: 'NOTIFIED', notifiedAt: '2026-10-08T08:00:00Z', members: [{ employeeId: '1', name: 'Employee' }] } });
  subject.render();
  subject.submitOpen = true;
  const tree = nodes(subject.render());
  const send = tree.find(node => node.type === 'Button' && node.props.children === 'Отправить список в штаб');
  assert.equal(Boolean(send.props.disabled), false);
  const dialog = tree.find(node => node.type === 'Dialog' && node.props.open === true);
  const confirm = nodes(dialog).find(node => node.type === 'Button' && node.props.children === 'Отправить');
  assert.equal(Boolean(confirm.props.disabled), false);
  confirm.props.onClick();
  assert.equal(subject.submissions.length, 1);
});

test('a server change to special-group assignments replaces stale checkbox values', () => {
  const subject = card();
  subject.render();
  subject.quota = '6';
  subject.render('request-a', { groupDemandIds: ['group-b'] });
  assert.deepEqual(subject.groups, ['group-b']);
  assert.equal(subject.quota, '6', 'group refresh must preserve unsaved numeric quotas');
});

test('another request resets both drafts even when server quotas and groups are identical', () => {
  const subject = card();
  subject.render();
  subject.quota = '6';
  subject.groups = ['unsaved-group'];
  subject.render('request-b');
  assert.equal(subject.quota, '4');
  assert.deepEqual(subject.groups, ['group-a']);
});

test('unrelated server refresh preserves both operator drafts', () => {
  const subject = card();
  subject.render();
  subject.quota = '6';
  subject.groups = ['unsaved-group'];
  subject.render('request-a', { assigned: 3, notifiedAt: '2026-10-08T12:00:00Z' });
  assert.equal(subject.quota, '6');
  assert.deepEqual(subject.groups, ['unsaved-group']);
});

test('changed server quota does not erase an unsaved special-group assignment', () => {
  const subject = card();
  subject.render();
  subject.groups = ['unsaved-group'];
  subject.render('request-a', { need: 5 });
  assert.equal(subject.quota, '5');
  assert.deepEqual(subject.groups, ['unsaved-group']);
});

test('a removed server group clears the previous checkbox selection', () => {
  const subject = card();
  subject.render();
  subject.render('request-a', { groupDemandIds: [] });
  assert.deepEqual(subject.groups, []);
});
