const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Exercise the real page, debounce hook, and outgoing registry query together.
// Navigation and network are boundaries; no DOM/auth/production server is needed.
function fixture(initialQuery = '', grants = ['event.view', 'event.create', 'assistant.use']) {
  const state = { query: initialQuery, requests: [], routes: [], clock: 0, timers: new Map() };
  const slots = []; let index = 0; let effects = []; let changed = false; let timerId = 0;
  const react = { ...React,
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => {
        const next = typeof value === 'function' ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; changed = true; }
      }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useId() { return react.useRef('filters-test-id').current; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) {
      const slot = index++;
      const old = slots[slot];
      if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
        slots[slot] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[slot].cleanup = fn(); });
      }
    },
  };
  const dependencies = {
    react,
    'next/navigation': {
      usePathname: () => '/security-ops/events/',
      useSearchParams: () => new URLSearchParams(state.query),
      useRouter: () => ({ replace: href => {
        state.routes.push(href); state.query = href.split('?')[1] ?? ''; changed = true;
      } }),
    },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: permission => grants.includes(permission), isLoading: false, error: null }) },
    '@/entities/portal-access': { MODULE_PERMISSION: { '/security-ops/events': 'event.view' }, moduleOpenFor: (_, hasPermission) => hasPermission('assistant.use') },
    '@/entities/security-event': { SECURITY_EVENT_STAGES: ['BULLETIN', 'RECON', 'DEMAND', 'FORCES', 'CLOSED'], STAGE_LABEL: { BULLETIN: 'Бюллетень', RECON: 'Рекогносцировка', CLOSED: 'Закрыто' } },
    '@tanstack/react-query': { useQuery: options => {
      if (options.enabled !== false) options.queryFn();
      return { data: { results: [], count: 0, owners: ['Ведущий А', 'Ведущий Б'] }, isLoading: false, isError: false };
    } },
    '@/lib/ops-api': { opsApiClient: { get: url => { state.requests.push(url); return Promise.resolve({}); } } },
  };
  function load(file, appendix = '') {
    const exported = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') + appendix, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports: exported, URLSearchParams, Date,
      setTimeout: (fn, delay) => { const id = ++timerId; state.timers.set(id, { fn, due: state.clock + delay }); return id; },
      clearTimeout: id => state.timers.delete(id),
      require: name => dependencies[name] ?? (name.startsWith('@/') || name === 'lucide-react' || name === 'next/link'
        ? new Proxy({}, { get: (_, key) => key }) : require(name)),
    });
    return exported;
  }
  dependencies['@/hooks/use-debounced-commit'] = load('hooks/use-debounced-commit.ts');
  // Keep the actual serialization rather than reimplementing the API contract in this test.
  dependencies['@/entities/security-event'].SECURITY_EVENTS_PATH = '/api/ops/security-events/';
  dependencies['@/hooks/use-security-events'] = load('hooks/use-security-events.ts');
  const page = load('app/security-ops/events/page.tsx', '\nexports.screen = SecurityEventsScreen;');
  let tree;
  function render() {
    let count = 0;
    do {
      changed = false; index = 0; effects = [];
      tree = page.screen(); effects.forEach(fn => fn());
      assert.ok(++count < 10, 'page effects did not settle');
    } while (changed);
    return tree;
  }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.actions)];
  }
  const all = () => nodes(render());
  const control = label => all().find(node => node.props?.['aria-label'] === label);
  const toggle = () => {
    const node = control('Дополнительные фильтры');
    assert.ok(node, 'registry needs an accessible disclosure for optional filters');
    return node;
  };
  const advanced = () => all().find(node => node.props?.id === toggle().props['aria-controls']);
  const search = () => all().find(node => node.props?.placeholder === 'Поиск по названию, объекту или ответственному');
  const reset = () => {
    const bar = all().find(node => node.type === 'FilterBar');
    assert.equal(typeof bar?.props.onReset, 'function', 'active filters need a reset action');
    bar.props.onReset(); render();
  };
  const advance = ms => {
    state.clock += ms;
    for (const [id, timer] of [...state.timers]) if (timer.due <= state.clock) { state.timers.delete(id); timer.fn(); }
    render();
  };
  render();
  return { state, all, control, toggle, advanced, search, reset, render, advance,
    navigate(query) { state.query = query; render(); },
    query() { return new URLSearchParams(state.query); },
    apiQuery() { return new URLSearchParams(state.requests.at(-1)?.split('?')[1]); },
  };
}

test('new registry visit exposes search and keeps optional filters collapsed', () => {
  const subject = fixture();
  assert.equal(subject.search().props.value, '');
  assert.equal(subject.toggle().props['aria-expanded'], false);
  assert.equal(subject.advanced().props.hidden, true);
});

for (const query of ['stage=RECON', 'from=2026-10-22', 'to=2026-10-23', 'owner=%D0%92%D0%B5%D0%B4%D1%83%D1%89%D0%B8%D0%B9+%D0%90']) {
  test(`shared link reveals its active filter: ${query}`, () => {
    const subject = fixture(query);
    assert.equal(subject.toggle().props['aria-expanded'], true);
    assert.equal(subject.advanced().props.hidden, false);
    for (const [key, value] of new URLSearchParams(query)) assert.equal(subject.apiQuery().get(key), value);
  });
}

test('unsupported stages and malformed dates do not create hidden server filters', () => {
  const subject = fixture('stage=DEMAND&from=2026-02-31&to=not-a-date');
  assert.equal(subject.toggle().props['aria-expanded'], false);
  assert.equal(subject.apiQuery().has('stage'), false);
  assert.equal(subject.apiQuery().has('from'), false);
  assert.equal(subject.apiQuery().has('to'), false);
});

test('an owner from a shared link remains visible before its server option is available', () => {
  const subject = fixture('owner=Другой ведущий');
  const owner = subject.control('Ведущий');
  const options = React.Children.toArray(owner.props.children);
  assert.ok(options.some(option => option.props?.value === 'Другой ведущий'));
  assert.equal(subject.apiQuery().get('owner'), 'Другой ведущий');
});

test('collapse retains current values, server filtering, and draft search', () => {
  const subject = fixture('stage=RECON&from=2026-10-22&owner=%D0%92%D0%B5%D0%B4%D1%83%D1%89%D0%B8%D0%B9+%D0%90');
  subject.search().props.onChange({ target: { value: 'Аккорда' } });
  subject.toggle().props.onClick(); subject.render();
  assert.equal(subject.advanced().props.hidden, true);
  assert.equal(subject.control('Этап').props.value, 'RECON');
  assert.equal(subject.control('Период с').props.value, '2026-10-22');
  assert.equal(subject.control('Ведущий').props.value, 'Ведущий А');
  assert.equal(subject.search().props.value, 'Аккорда');
  assert.equal(subject.apiQuery().get('owner'), 'Ведущий А');
  subject.advance(350);
  assert.equal(subject.apiQuery().get('search'), 'Аккорда');
  assert.equal(subject.apiQuery().get('stage'), 'RECON');
});

test('URL navigation reveals active filters and updates an existing mounted screen', () => {
  const subject = fixture();
  subject.navigate('stage=RECON&search=старое&page=3');
  assert.equal(subject.toggle().props['aria-expanded'], true);
  assert.equal(subject.search().props.value, 'старое');
  subject.toggle().props.onClick(); subject.render();
  assert.equal(subject.toggle().props['aria-expanded'], false);
  subject.navigate('owner=%D0%92%D0%B5%D0%B4%D1%83%D1%89%D0%B8%D0%B9+%D0%91&search=новое');
  assert.equal(subject.toggle().props['aria-expanded'], true);
  assert.equal(subject.search().props.value, 'новое');
  assert.equal(subject.control('Ведущий').props.value, 'Ведущий Б');
});

test('filter changes reset page and retain calendar, other filters, and pending search', () => {
  const subject = fixture('view=calendar&page=3&from=2026-10-22');
  subject.search().props.onChange({ target: { value: 'Аккорда' } }); subject.render();
  subject.control('Этап').props.onChange({ target: { value: 'RECON' } }); subject.render();
  subject.advance(350);
  assert.equal(subject.query().has('page'), false);
  assert.equal(subject.query().get('view'), 'calendar');
  assert.equal(subject.apiQuery().get('page_size'), '200');
  assert.equal(subject.apiQuery().get('stage'), 'RECON');
  assert.equal(subject.apiQuery().get('from'), '2026-10-22');
  assert.equal(subject.apiQuery().get('search'), 'Аккорда');
});

test('reset cancels a draft search before debounce and keeps the selected view', () => {
  const subject = fixture('view=calendar&stage=RECON&page=3&search=старое');
  subject.search().props.onChange({ target: { value: 'новое' } }); subject.render();
  subject.reset(); subject.advance(1000);
  assert.equal(subject.state.query, 'view=calendar');
  assert.equal(subject.search().props.value, '');
  assert.equal(subject.toggle().props['aria-expanded'], false);
  for (const key of ['stage', 'from', 'to', 'owner', 'search']) assert.equal(subject.apiQuery().has(key), false);
});

test('draft-only search can be reset before it ever reaches the URL', () => {
  const subject = fixture();
  subject.search().props.onChange({ target: { value: 'пока печатаю' } }); subject.render();
  subject.reset(); subject.advance(1000);
  assert.equal(subject.state.query, '');
  assert.equal(subject.search().props.value, '');
  assert.equal(subject.apiQuery().has('search'), false);
});

test('registry read, create, and assistant actions retain separate permission gates', () => {
  const readOnly = fixture('', ['event.view']);
  assert.equal(readOnly.all().some(node => node.props?.href === '/security-ops/assistant/'), false);
  assert.equal(readOnly.all().some(node => node.props?.children === '+ Создать бюллетень'), false);
  const denied = fixture('', []);
  assert.equal(denied.state.requests.length, 0);
  assert.equal(denied.all().some(node => node.type === 'OpsAccessDenied'), true);
});
