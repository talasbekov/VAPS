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
function card({ ready = false, allocationOverrides = {}, detailOverrides = {} } = {}) {
  const answers = [];
  const submissions = [];
  const splits = [];
  const notifications = [];
  const withdrawals = [];
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
      useSplitDirectorateQuotas: () => ({ mutateAsync: async body => splits.push(body) }),
      useNotifyDepartmentDirectorates: () => ({ mutate: body => notifications.push(body) }),
      useWithdrawDepartmentAllocation: () => ({ mutate: body => withdrawals.push(body) }),
    },
    '@/hooks/use-participation-catalog': { useParticipationCatalog: () => ({}) },
    '@/shared/lib/date': { formatIsoDate: value => value, formatIsoDateTime: value => value },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/badge': { Badge: 'Badge' },
    '@/components/stat-card': { StatCard: 'StatCard' },
    '@/components/ui/dialog': { Dialog: 'Dialog' },
    '@/entities/security-event': stageMeta,
  };
  vm.runInNewContext(compiled, {
    exports,
    require: name => dependencies[name] ?? (name.startsWith('@/') || name === 'lucide-react' ? {} : require(name)),
  }, { filename: 'DepartmentRequestCard.js' });
  return {
    render(id = 'request-a', row = {}) {
      detail = { eventId: 'event-a', stage: 'FORCES', ...detailOverrides, allocation: {
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
    set comment(value) { states[2] = { ...states[2], comment: value }; },
    get answers() { return answers; },
    get submissions() { return submissions; },
    get splits() { return splits; },
    get notifications() { return notifications; },
    get withdrawals() { return withdrawals; },
    set submitOpen(value) { states[0] = value; },
    set notifyOpen(value) { states[1] = value; },
    // The final two state hooks hold the numeric and special-group drafts.
    get quota() { return states.at(-2)['2']; },
    set quota(value) { states.at(-2)['2'] = value; },
    get groups() { return Array.from(states.at(-1)['2']); },
    set groups(value) { states.at(-1)['2'] = value; },
  };
}

const stageMeta = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../entities/security-event/model/stage-meta.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: stageMeta });

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
  assert.equal(send, undefined);
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

const collected = {
  status: 'NOTIFIED', notifiedAt: '2026-10-08T08:00:00Z', submittedAt: null,
  need: 6, allocating: 6,
  members: Array.from({ length: 6 }, (_, i) => ({ employeeId: String(i + 1), name: `Employee ${i + 1}` })),
};
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && node.props.children === label);
function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return text(tree.props?.children);
}
const dialog = (tree, index) => nodes(tree).filter(node => node.type === 'Dialog')[index];

for (const stage of ['APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED']) {
  test(`${stage}: a collected but unsubmitted ledger does not offer response or list submission`, () => {
    const allocation = { ...collected };
    const subject = card({ ready: true, allocationOverrides: allocation, detailOverrides: { stage } });
    subject.render();
    subject.comment = 'Changed after collection';
    const tree = subject.render();
    const save = button(tree, 'Сохранить ответ');
    assert.equal(save.props.disabled, true, 'a comment change cannot bypass the known collection-stage guard');
    save.props.onClick();
    assert.equal(subject.answers.length, 0);
    const send = button(tree, 'Отправить список в штаб');
    assert.ok(!send || send.props.disabled, 'collected headcount must not enable a guaranteed refused command');
    if (send) send.props.onClick();
    assert.equal(dialog(subject.render(), 1).props.open, false);
    assert.equal(subject.submissions.length, 0);
    assert.ok(text(tree).includes(stageMeta.STAGE_LABEL[stage]), 'show the actual event stage');
    assert.equal(nodes(tree).filter(node => node.props?.['aria-current'] === 'step').length, 0, 'historical collection is not an outstanding current step');
    assert.ok(!nodes(tree).some(node => node.type === 'Badge' && text(node) === 'Собираем людей'));
    assert.ok(!text(tree).includes('Можно с недобором после подтверждения'));
    assert.ok(!text(tree).includes('Список у Штаба'), 'six collected people do not prove a submitted command');
    assert.equal(nodes(tree).find(node => node.type === 'StatCard' && node.props.label === 'Собрано').props.value, 6);
    assert.equal(allocation.status, 'NOTIFIED');
    assert.equal(allocation.submittedAt, null);
  });

  test(`${stage}: an unnotified allocation cannot split quotas or notify directorates`, () => {
    const subject = card({ ready: true, detailOverrides: { stage } });
    subject.render();
    const tree = subject.render();
    assert.equal(nodes(tree).find(node => node.props?.id === 'quota-2').props.disabled, true);
    for (const label of ['Сохранить раскладку', 'Отправить в управления']) {
      const action = button(tree, label);
      assert.ok(!action || action.props.disabled, label);
    }
    assert.equal(subject.splits.length, 0);
    assert.equal(subject.notifications.length, 0);
  });
}

for (const stage of ['APPROVAL', 'ACKNOWLEDGEMENT']) {
  test(`${stage}: a confirmation already open during collection cannot submit after the stage refresh`, () => {
    const context = { stage: 'FORCES' };
    const subject = card({ ready: true, allocationOverrides: collected, detailOverrides: context });
    subject.render();
    button(subject.render(), 'Отправить список в штаб').props.onClick();
    assert.equal(dialog(subject.render(), 1).props.open, true);
    context.stage = stage;
    const tree = subject.render();
    assert.equal(dialog(tree, 1).props.open, false);
    const confirm = button(dialog(tree, 1), 'Отправить');
    assert.equal(confirm.props.disabled, true);
    confirm.props.onClick();
    assert.equal(subject.submissions.length, 0);
  });
}

test('an already-open directorate confirmation cannot save its draft or notify after collection closes', async () => {
  const context = { stage: 'FORCES' };
  const subject = card({ ready: true, detailOverrides: context });
  subject.render();
  subject.quota = '5';
  button(subject.render(), 'Отправить в управления').props.onClick();
  assert.equal(dialog(subject.render(), 0).props.open, true);
  context.stage = 'ACKNOWLEDGEMENT';
  const tree = subject.render();
  assert.equal(dialog(tree, 0).props.open, false);
  const confirm = button(dialog(tree, 0), 'Сохранить и отправить');
  assert.equal(confirm.props.disabled, true);
  confirm.props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(subject.splits.length, 0);
  assert.equal(subject.notifications.length, 0);
});

for (const stage of ['RECON', 'DEMAND', 'FORCES', 'PLACEMENT']) {
  test(`${stage}: existing collection actions and independent notification locks remain available`, async () => {
    for (const status of ['NOTIFIED', 'RETURNED']) {
      const subject = card({ ready: true, detailOverrides: { stage }, allocationOverrides: { ...collected, status } });
      subject.render();
      subject.comment = 'Collection update';
      const tree = subject.render();
      const save = button(tree, 'Сохранить ответ');
      assert.equal(Boolean(save.props.disabled), false);
      save.props.onClick();
      assert.equal(subject.answers.length, 1);
      assert.equal(nodes(tree).find(node => node.props?.id === 'quota-2').props.disabled, true, 'notification/status still locks quotas');
      assert.equal(button(tree, 'Отправить в управления'), undefined);
      button(tree, 'Отправить список в штаб').props.onClick();
      const confirm = button(dialog(subject.render(), 1), 'Отправить');
      assert.equal(Boolean(confirm.props.disabled), false);
      confirm.props.onClick();
      assert.equal(subject.submissions.length, 1);
    }
    // In particular RECON must not be rejected by an inaccurate stage-only allowlist:
    // published object demand may already permit collection under the server guard.
    const draft = card({ ready: true, detailOverrides: { stage } });
    draft.render();
    const tree = draft.render();
    assert.equal(Boolean(nodes(tree).find(node => node.props?.id === 'quota-2').props.disabled), false);
    button(tree, 'Сохранить раскладку').props.onClick();
    await Promise.resolve();
    assert.equal(draft.splits.length, 1);
    button(tree, 'Отправить в управления').props.onClick();
    const confirm = button(dialog(draft.render(), 0), 'Отправить');
    assert.equal(Boolean(confirm.props.disabled), false);
    confirm.props.onClick();
    await Promise.resolve();
    assert.equal(draft.notifications.length, 1);
  });
}

for (const stage of [undefined, null, 'FUTURE_STAGE']) {
  test(`unknown stage ${String(stage)} stays explicit and does not invent a collection prohibition or completion`, () => {
    const subject = card({ ready: true, detailOverrides: { stage }, allocationOverrides: collected });
    subject.render();
    const tree = subject.render();
    assert.ok(text(tree).includes('Этап мероприятия не определён'));
    assert.ok(!text(tree).includes('Сбор завершён'));
    assert.ok(!text(tree).includes('Список у Штаба'));
    assert.equal(Boolean(button(tree, 'Отправить список в штаб').props.disabled), false);
  });
}

test('known closed collection preserves a separately submitted ledger and its independent withdrawal', () => {
  const subject = card({ ready: true, detailOverrides: { stage: 'ACKNOWLEDGEMENT' },
    allocationOverrides: { ...collected, status: 'SUBMITTED', submittedAt: '2026-10-08T09:00:00Z' } });
  subject.render();
  const tree = subject.render();
  assert.ok(nodes(tree).some(node => node.type === 'Badge' && text(node) === 'Отправлено в Штаб'));
  assert.ok(text(tree).includes('Список у Штаба'));
  const withdraw = button(tree, 'Отозвать список');
  assert.equal(Boolean(withdraw.props.disabled), false);
  withdraw.props.onClick();
  assert.equal(subject.withdrawals.length, 1);
});
