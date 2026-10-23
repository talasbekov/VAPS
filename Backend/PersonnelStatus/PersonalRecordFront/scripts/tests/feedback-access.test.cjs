const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(relative, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: name => dependencies[name] ?? (name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(name)),
  });
  return exports;
}

function setup(codes = ['feedback.view']) {
  const access = { permissions: new Set(codes), isLoading: false, error: null };
  access.hasPermission = code => access.permissions !== undefined && (access.permissions.has('*') || access.permissions.has(code));
  const created = [], submitted = [];
  const registry = {
    types: [{ code: 'BUG', label: 'Ошибка' }],
    priorities: [{ code: 'NORMAL', label: 'Обычный' }],
    statuses: [{ code: 'DRAFT', label: 'Черновик' }],
    modules: [{ moduleCode: 'OTHER', label: 'Другое' }], registryVersion: 'test',
  };
  const request = {
    feedbackId: 'own-draft', subject: 'My saved draft', typeCode: 'BUG', priorityCode: 'NORMAL',
    statusCode: 'DRAFT', moduleCode: 'OTHER', authorLabel: 'Author', createdAt: '2026-10-22T00:00:00Z',
    isOwn: true, confidential: false, restrictedReason: null, descriptionPreview: 'Saved text',
    attachments: null, technicalInfo: null,
  };
  const data = {
    registry, stats: { byStatus: [], total: 1 }, results: [request], totalVisible: 1,
    totalMatched: 1, page: 1, pageCount: 1, unavailableCapabilities: [], serverTime: '2026-10-22T00:00:00Z',
  };
  const portal = compile('entities/portal-access/index.ts');
  const dependencies = {
    react: { ...require('react'), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'next/link': { default: 'Link' },
    'next/navigation': { usePathname: () => '/feedback' },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/entities/portal-access': portal,
    '@/hooks/use-debounced-commit': { useDebouncedCommit: initial => [initial, () => {}] },
    '@/hooks/use-ops-feedback': {
      useFeedbackRequests: () => ({ data, isError: false }),
      useCreateFeedback: () => ({ isPending: false, error: null, mutate: body => created.push(body) }),
      useSubmitFeedback: () => ({ isPending: false, error: null, mutate: body => submitted.push(body) }),
    },
    '@/entities/ops-changelog': { PORT_VERSION: 'test' },
  };
  const Page = compile('app/security-ops/feedback/page.tsx', dependencies).default;
  function render() {
    const nodes = [];
    function visit(value) {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      nodes.push(value);
      visit(value.props?.children);
    }
    visit(Page());
    return nodes;
  }
  return { access, request, created, submitted, render };
}
const journal = nodes => nodes.find(node => node.type === 'Link' && node.props.href === '/security-ops/changelog');
const form = nodes => nodes.find(node => typeof node.type === 'function' && node.type.name === 'FeedbackForm');
const sendDraft = nodes => nodes.find(node => node.type === 'button' && node.props.children === 'Отправить в работу');

test('feedback viewer is not offered the settings-only journal', () => {
  assert.equal(journal(setup().render()), undefined);
});

test('a real creator keeps its form without gaining the journal destination', () => {
  const nodes = setup(['feedback.view', 'feedback.create']).render();
  assert.ok(form(nodes));
  assert.equal(journal(nodes), undefined);
});

test('canonical journal grant opens only the journal, independently of creation', () => {
  const nodes = setup(['feedback.view', 'settings.view']).render();
  assert.ok(journal(nodes));
  assert.equal(form(nodes), undefined);
});

test('reading the registry does not authorize a new request or saved draft', () => {
  const nodes = setup().render();
  assert.equal(form(nodes), undefined);
  assert.equal(sendDraft(nodes), undefined);
});

test('own DRAFT still requires the create permission independently of ownership', () => {
  assert.equal(sendDraft(setup(['feedback.view', 'settings.view']).render()), undefined);
});

test('authorized creator preserves both create and own-draft payloads', () => {
  const subject = setup(['feedback.view', 'feedback.create']);
  const nodes = subject.render();
  const body = { subject: 'New request', description: 'Human text', saveAsDraft: false };
  form(nodes).props.onSubmit(body);
  sendDraft(nodes).props.onClick();
  assert.equal(subject.created.length, 1);
  assert.equal(subject.created[0], body);
  assert.deepEqual(JSON.parse(JSON.stringify(subject.submitted)), [{ feedbackId: 'own-draft' }]);
});

test('wildcard administrator preserves the journal, form and own-draft action', () => {
  const nodes = setup(['*']).render();
  assert.ok(journal(nodes));
  assert.ok(form(nodes));
  assert.ok(sendDraft(nodes));
});

test('unrelated analytics and event rights cannot authorize journal or request writes', () => {
  const nodes = setup(['feedback.view', 'analytics.view', 'event.create', 'forces.command']).render();
  assert.equal(journal(nodes), undefined);
  assert.equal(form(nodes), undefined);
  assert.equal(sendDraft(nodes), undefined);
});

for (const state of ['loading', 'unknown', 'failed-refresh']) {
  test(`${state} does not supply positive authority despite a stale permission predicate`, () => {
    const subject = setup(['*']);
    // Deliberately adversarial adapter: test the page's positive readiness gate,
    // separately from the real hook's own denial of cached grants after errors.
    subject.access.hasPermission = () => true;
    if (state === 'loading') subject.access.isLoading = true;
    if (state === 'unknown') subject.access.permissions = undefined;
    if (state === 'failed-refresh') subject.access.error = { kind: 'network' };
    const nodes = subject.render();
    assert.equal(journal(nodes), undefined);
    assert.equal(form(nodes), undefined);
    assert.equal(sendDraft(nodes), undefined);
    assert.equal(subject.created.length + subject.submitted.length, 0);
  });
}

test('revoking create removes writes while preserving the separately authorized journal', () => {
  const subject = setup(['feedback.view', 'feedback.create', 'settings.view']);
  assert.ok(form(subject.render()));
  subject.access.permissions.delete('feedback.create');
  const nodes = subject.render();
  assert.ok(journal(nodes));
  assert.equal(form(nodes), undefined);
  assert.equal(sendDraft(nodes), undefined);
});

test('revoking settings removes the destination while preserving authorized creation', () => {
  const subject = setup(['feedback.view', 'feedback.create', 'settings.view']);
  assert.ok(journal(subject.render()));
  subject.access.permissions.delete('settings.view');
  const nodes = subject.render();
  assert.equal(journal(nodes), undefined);
  assert.ok(form(nodes));
  assert.ok(sendDraft(nodes));
});

for (const patch of [{ isOwn: false }, { statusCode: 'NEW' }, { statusCode: 'CLOSED' }]) {
  test(`create grant does not replace own-DRAFT guard ${JSON.stringify(patch)}`, () => {
    const subject = setup(['feedback.view', 'feedback.create']);
    Object.assign(subject.request, patch);
    assert.equal(sendDraft(subject.render()), undefined);
  });
}

test('create and settings grants do not replace the page view permission', () => {
  const nodes = setup(['feedback.create', 'settings.view']).render();
  assert.ok(nodes.some(node => node.type === 'OpsAccessDenied'));
  assert.equal(journal(nodes), undefined);
  assert.equal(form(nodes), undefined);
  assert.equal(sendDraft(nodes), undefined);
});
