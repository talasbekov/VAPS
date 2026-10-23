const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { exports, URLSearchParams, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const portal = load('entities/portal-access/index.ts');
const portalTasks = load('features/portal-workspace/model.ts', { '@/entities/portal-access': portal });
const workspace = load('features/forces-workspace/model/workspace.ts');
function render({ pathname = '/employees/', query = '', permissions = [], permissionsAvailable = true, roles = [], ...state } = {}) {
  const access = { permissions: permissionsAvailable ? new Set(permissions) : undefined, roles: roles.map(code => ({ code })), hasPermission: code => permissions.includes('*') || permissions.includes(code), isLoading: false, error: null, ...state };
  const { Breadcrumbs } = load('components/navigation/breadcrumbs.tsx', {
    'next/link': { default: 'a' }, 'lucide-react': { ChevronRight: 'ChevronRight' },
    'next/navigation': { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/entities/portal-access': portal,
    '@/features/portal-workspace/model': portalTasks,
    '@/features/forces-workspace/model/workspace': workspace,
  });
  const wrapper = Breadcrumbs();
  assert.equal(wrapper.type, require('react').Suspense, 'search parameters have a local Suspense boundary');
  const tree = wrapper.props.children.type();
  const nodes = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    nodes.push(value); visit(value.props?.children);
  }
  visit(tree);
  return nodes;
}
const brand = nodes => nodes.find(node => node.type === 'a' && node.props.children === 'Smart Жоспарлау');
const current = nodes => nodes.find(node => node.props?.['aria-current'] === 'page')?.props.children;
const hrefs = nodes => nodes.filter(node => node.type === 'a').map(node => node.props.href);
const hasParent = (nodes, href) => hrefs(nodes).includes(href);
const parentIsText = nodes => {
  const items = nodes.filter(node => node.type === 'li');
  return items.at(-2)?.props.children.at(-1)?.type === 'span';
};

test('analytics trails identify independent sources across slash and authority variants', () => {
  const labels = nodes => nodes.filter(node => node.type === 'li').map(node => node.props.children.at(-1).props.children);
  const authorities = [
    { permissions: ['analytics.operations'] },
    { permissions: ['analytics.operations', 'analytics.view', 'rating.view_aggregate'] },
    { permissions: ['*'] },
    { permissions: [] },
    { permissions: ['*'], isLoading: true },
    { permissions: ['*'], error: Error('offline') },
    { permissions: ['*'], permissionsAvailable: false },
  ];
  for (const slash of ['', '/']) {
    for (const authority of authorities) {
      const operations = render({ ...authority, pathname: '/security-ops/analytics/operations' + slash });
      assert.deepEqual(labels(operations), ['Smart Жоспарлау', 'Охранные мероприятия', 'Аналитика мероприятий']);
      assert.equal(hasParent(operations, '/security-ops/analytics/'), false, 'a peer source is never an operations ancestor');
      const service = render({ ...authority, pathname: '/security-ops/analytics' + slash });
      assert.deepEqual(labels(service), ['Smart Жоспарлау', 'Охранные мероприятия', 'Аналитика службы']);
      const rating = render({ ...authority, pathname: '/security-ops/ratings/analytics' + slash });
      assert.deepEqual(labels(rating), ['Smart Жоспарлау', 'Охранные мероприятия', 'Оперативный рейтинг', 'Аналитика рейтинга']);
      assert.equal(current(rating), 'Аналитика рейтинга');
    }
  }
});

test('known assistant and participant screens retain their identity without changing workspace or unknown trails', () => {
  const labels = nodes => nodes.filter(node => node.type === 'li').map(node => node.props.children.at(-1).props.children);
  for (const slash of ['', '/']) {
    for (const authority of [
      { permissions: ['event.create', 'rating.view_aggregate'] }, { permissions: ['*'] }, { permissions: [] },
      { permissions: ['*'], isLoading: true }, { permissions: ['*'], error: Error('offline') },
      { permissions: ['*'], permissionsAvailable: false },
    ]) {
      const assistant = render({ ...authority, pathname: '/security-ops/assistant' + slash });
      assert.deepEqual(labels(assistant), ['Smart Жоспарлау', 'Охранные мероприятия', 'Помощник по ОМ']);
      assert.equal(current(assistant), 'Помощник по ОМ');
      assert.equal(hasParent(assistant, '/security-ops/'), false);
      for (const participant of ['42', '9007199254740993']) {
        const rating = render({ ...authority, pathname: '/security-ops/ratings/employees/' + participant + slash });
        assert.deepEqual(labels(rating), ['Smart Жоспарлау', 'Охранные мероприятия', 'Оперативный рейтинг', 'Агрегированный рейтинг участника']);
        const trusted = !authority.isLoading && !authority.error && authority.permissionsAvailable !== false;
        const aggregate = authority.permissions.includes('*') || authority.permissions.includes('rating.view_aggregate');
        assert.equal(hasParent(rating, '/security-ops/ratings/'), trusted && aggregate);
        assert.equal(hasParent(rating, '/security-ops/ratings/employees/'), false);
      }
    }
  }
  assert.equal(current(render({ permissions: ['*'], query: 'view=forces' })), 'Сбор сил на ОМ');
  assert.equal(current(render({ permissions: ['*'], query: 'view=department-summary' })), 'Свод департамента');
  assert.equal(current(render({ pathname: '/unregistered/employees/42/', permissions: ['*'] })), 'Сбор сил на ОМ');
  assert.equal(current(render({ pathname: '/unregistered/assistant/', permissions: ['*'] })), undefined);
});

test('brand takes head, duty and admin to their permitted starting screens', () => {
  assert.equal(brand(render({ pathname: '/statuses/', permissions: ['status.view', 'status.workspace', 'status.manage'] })).props.href, '/workspace');
  assert.equal(brand(render({ permissions: ['status.view', 'service_summary.view'], roles: ['DUTY_OFFICER'] })).props.href, '/workspace');
  assert.equal(brand(render({ permissions: ['*'] })).props.href, '/workspace');
});
test('pending, failed and unavailable authority never offers a cached brand destination', () => {
  for (const state of [{ isLoading: true }, { error: Error('offline') }, { permissionsAvailable: false }]) {
    assert.equal(brand(render({ permissions: ['*'], ...state })), undefined);
  }
});
test('expense current label follows daily default, summary alias and explicit forces request', () => {
  const props = { roles: ['DEPARTMENT_EXPENSE_OFFICER'], permissions: ['status.view', 'forces.allocate'] };
  assert.equal(current(render(props)), 'Ежедневный расход');
  assert.equal(current(render({ ...props, query: 'view=department-summary&businessDate=2026-10-20' })), 'Ежедневный расход');
  assert.equal(current(render({ ...props, query: 'view=daily&request=123' })), 'Сбор сил на ОМ');
  assert.equal(current(render({ roles: props.roles, permissions: ['forces.allocate'] })), 'Сбор сил на ОМ');
});
test('legacy, headquarters and responsible titles match their existing page variants', () => {
  assert.equal(current(render({ permissions: ['*'], query: 'view=daily' })), 'Ежедневный расход организации');
  assert.equal(current(render({ permissions: ['*'], query: '' })), 'Ежедневный расход организации');
  assert.equal(current(render({ permissions: ['*'], query: 'view=forces' })), 'Сбор сил на ОМ');
  assert.equal(current(render({ permissions: ['*'], query: 'view=department-summary' })), 'Свод департамента');
  assert.equal(current(render({ permissions: ['forces.command'], roles: ['OPS_STAFF'] })), 'Распределения');
  assert.equal(current(render({ permissions: ['forces.allocate'], roles: ['FORCES_GATHERING_OFFICER'] })), 'Рабочий стол');
  assert.equal(current(render({ pathname: '/statuses/', permissions: ['status.view'] })), 'Управление статусами');
});

test('brand returns each permitted role to the simple home', () => {
  assert.equal(brand(render({ permissions: ['status.view', 'service_summary.view'], roles: ['CUSTOM_READER'] })).props.href, '/workspace');
  assert.equal(brand(render({ permissions: ['status.view'], roles: ['DUTY_OFFICER'] })).props.href, '/workspace');
  assert.equal(brand(render({ permissions: ['status.view', 'status.workspace'], roles: ['DUTY_OFFICER', 'CUSTOM_READER'] })).props.href, '/workspace');
});

test('operations analytics omits the service peer for restricted and complete readers', () => {
  for (const pathname of ['/security-ops/analytics/operations', '/security-ops/analytics/operations/']) {
    const restricted = render({ pathname, permissions: ['analytics.operations'] });
    const complete = render({ pathname, permissions: ['analytics.operations', 'analytics.view'] });
    assert.equal(hasParent(restricted, '/security-ops/analytics/'), false);
    assert.equal(parentIsText(restricted), true, 'the section without a page remains a label');
    assert.equal(current(restricted), current(complete), 'permission filtering must not change the current leaf');
    assert.equal(hasParent(complete, '/security-ops/analytics/'), false, 'a service peer is not an ancestor with broader rights either');
    assert.equal(hasParent(render({ pathname, permissions: ['*'] }), '/security-ops/analytics/'), false);
  }
});

for (const [leaf, permission] of [['export', 'rating.export'], ['audit', 'rating.view_audit'],
  ['workspace', 'rating.evaluate'], ['analytics', 'analytics.view']]) {
  test(`independent rating ${leaf} access does not offer the aggregate parent`, () => {
    const pathname = `/security-ops/ratings/${leaf}/`;
    const restricted = render({ pathname, permissions: [permission] });
    const complete = render({ pathname, permissions: [permission, 'rating.view_aggregate'] });
    assert.equal(hasParent(restricted, '/security-ops/ratings/'), false);
    assert.equal(parentIsText(restricted), true);
    assert.equal(current(restricted), current(complete));
    assert.equal(hasParent(complete, '/security-ops/ratings/'), true);
  });
}

test('aggregate readers retain their parent and no-page ancestors never become links', () => {
  for (const pathname of ['/security-ops/ratings/evaluations/', '/security-ops/ratings/employees/42/']) {
    const trail = render({ pathname, permissions: ['rating.view_aggregate'] });
    assert.equal(hasParent(trail, '/security-ops/ratings/'), true);
    assert.equal(hasParent(trail, '/security-ops/'), false);
  }
  assert.equal(hasParent(render({ pathname: '/security-ops/events/42/', permissions: ['*'] }), '/security-ops/'), false);
});

test('untrusted authority removes protected parent links as well as the cached brand', () => {
  for (const state of [{ isLoading: true }, { error: Error('offline') }, { permissionsAvailable: false }]) {
    const trail = render({ pathname: '/security-ops/analytics/operations/', permissions: ['*'], ...state });
    assert.deepEqual(hrefs(trail), []);
    assert.equal(parentIsText(trail), true);
    assert.ok(current(trail));
  }
});

test('an unregistered parent stays text even when a labelled segment and wildcard resemble a real module', () => {
  const trail = render({ pathname: '/unregistered/analytics/operations/', permissions: ['*'] });
  assert.deepEqual(hrefs(trail), ['/workspace']);
  assert.equal(parentIsText(trail), true);
});

test('settings leaf routes retain the disproved-W09 no-parent-link control and alias checking uses the policy grant', () => {
  for (const leaf of ['roles', 'users', 'permissions']) {
    const trail = render({ pathname: `/settings/${leaf}/`, permissions: ['admin.roles'] });
    assert.equal(hasParent(trail, '/settings/'), false, 'an unrecognised leaf must not turn current settings into a link');
    assert.equal(trail.find(node => node.props?.['aria-current'] === 'page').type, 'span');
  }
  // Synthetic recognised descendant exercises the existing alias if it is a
  // parent; this is not a claim that /settings/history is an application page.
  const denied = render({ pathname: '/settings/history/', permissions: ['admin.roles'] });
  assert.equal(hasParent(denied, '/settings/'), false);
  assert.equal(parentIsText(denied), true);
  assert.equal(hasParent(render({ pathname: '/settings/history/', permissions: ['settings.view'] }), '/settings/'), true);
});

test('parent navigation honours the shared conjunctive and optional role rules', t => {
  // The parent /statuses is a real module; a synthetic recognised child makes
  // the component exercise its all-of rule without adding a route or label.
  assert.equal(hasParent(render({ pathname: '/statuses/history/', permissions: ['status.view'] }), '/statuses/'), false);
  assert.equal(hasParent(render({ pathname: '/statuses/history/', permissions: ['status.view', 'status.workspace'] }), '/statuses/'), true);
  portal.MODULE_ROLE['/security-ops/analytics'] = 'NAV_READER';
  t.after(() => { delete portal.MODULE_ROLE['/security-ops/analytics']; });
  // Policy-control fixture: recognised history child, not an application route.
  const props = { pathname: '/security-ops/analytics/history/', permissions: ['analytics.view', 'analytics.operations'] };
  assert.equal(hasParent(render(props), '/security-ops/analytics/'), false);
  assert.equal(hasParent(render({ ...props, roles: ['NAV_READER'] }), '/security-ops/analytics/'), true);
  assert.equal(hasParent(render({ ...props, permissions: ['*'] }), '/security-ops/analytics/'), true);
});
