const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function fixture() {
  const unread = [
    { id: 7, source: 'legacy', notification_type: 'request', title: 'Кадровая заявка', message: 'Открыть заявку',
      link: '/statuses', is_read: false, created_at: '2026-10-01T10:00:00Z' },
    { id: 7, source: 'ops', notification_type: 'request', title: 'Сбор сил', message: 'Выделить людей',
      link: '/employees', is_read: false, created_at: '2026-10-02T10:00:00Z' },
  ];
  const state = { unread: { data: { items: unread, failed: [] }, isLoading: false, isError: false, isFetching: false,
      refetch: async () => { calls.push(['retry', 'unread']); } },
    rating: { data: { results: [{ id: 'personal-event', createdAt: '2026-10-03T10:00:00Z', recipientUserId: 'actor',
      code: 'EVALUATION_AVAILABLE', deepLink: '/security-ops/ratings/workspace?event=one', securityEventId: 'one' }],
      unavailableViews: [] }, error: null, authorityError: null, readAccessBlocked: false,
      isPending: false, isLoading: false, isError: false, isFetching: false,
      refetch: async () => { calls.push(['retry', 'rating']); },
      retryNotifications: async () => { calls.push(['retry', 'rating']); } } };
  const calls = [], modules = new Map(), stores = new Map(), messageListeners = new Set();
  let current, cursor = 0; const pendingEffects = [];
  function slot(initial) { const index = cursor++; if (!(index in current)) current[index] = initial; return index; }
  function invoke(fn, props = {}) {
    const previous = current, previousCursor = cursor; current = stores.get(fn) ?? []; stores.set(fn, current); cursor = 0;
    const result = fn(props); current = previous; cursor = previousCursor; return result;
  }
  const deps = {
    react: { ...require('react'), useState: initial => { const index = slot(initial), owner = current;
      return [owner[index], value => { owner[index] = typeof value === 'function' ? value(owner[index]) : value; }]; },
      useRef: initial => current[slot({ current: initial })], useEffect: (effect, values = []) => {
        const index = slot(null); const old = current[index];
        if (!old || values.some((value, i) => value !== old[i])) { pendingEffects.push(effect); current[index] = values; }
      }, useSyncExternalStore: (_subscribe, read) => read() },
    'next/navigation': { useRouter: () => ({ push: url => calls.push(['navigate', url]) }) },
    'next/link': { default: 'a' },
    '@tanstack/react-query': { useQuery: () => state.unread,
      useQueryClient: () => ({ invalidateQueries: async options => calls.push(['invalidate', Array.from(options.queryKey)]) }),
      useMutation: options => ({ isPending: false, mutate: async value => {
        try { const result = await options.mutationFn(value); options.onSuccess?.(result); }
        catch (error) { options.onError?.(error); } finally { options.onSettled?.(); }
      } }) },
    'framer-motion': { motion: new Proxy({}, { get: (_, key) => String(key) }), AnimatePresence: 'AnimatePresence' },
    '@/hooks/use-ops-ratings': { useRatingNotifications: () => state.rating },
    '@/hooks/use-ops-mock-worker': { useOpsMockWorker: () => true },
    '@/lib/ops-ws': { startOpsWs() {}, stopOpsWs() {}, getOpsWsStatus: () => 'online', subscribeOpsWsStatus: () => () => {},
      subscribeOpsWsMessages: listener => { messageListeners.add(listener); return () => messageListeners.delete(listener); } },
    '@/shared/config/env': { BACKEND_URL: '' },
    '@/lib/api': { getAccessToken: async () => 'synthetic', apiClient: {
      markAllOpsNotificationsRead: async until => { calls.push(['mark-all', 'ops', until]); },
      markOpsNotificationRead: async id => { calls.push(['mark-one', 'ops', id]); },
    } },
    '@/shared/hooks/use-toast': { toast: value => calls.push(['toast', value.title]) },
    '@/features/notifications/model/report-download': { reportDownloadEndpoint: () => null },
  };
  function load(id, parentFile) {
    if (id in deps) return deps[id];
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(__dirname, '../..', id.slice(2)) : path.resolve(path.dirname(parentFile), id);
    const filename = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!filename || id.includes('/components/ui/') || id.includes('/components/ops-permission-boundary') || id.includes('/components/load-failure')) {
      return new Proxy({}, { get: (_, key) => String(key) });
    }
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: name => {
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      return load(name, filename);
    }, fetch: async (url, options) => {
      calls.push(['mark-all', 'legacy', JSON.parse(options.body).until]);
      return new Response('{}', { status: state.legacyReadAllStatus ?? 200 });
    } });
    return exports;
  }
  const dropdown = load('@/features/notifications/ui/NotificationsDropdown').NotificationsDropdown;
  const layout = load('@/app/security-ops/layout').default;
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return expand(invoke(tree.type, tree.props));
    return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
  }
  function render() {
    const result = expand(invoke(dropdown));
    while (pendingEffects.length) pendingEffects.shift()();
    return result;
  }
  return { state, calls, render, renderLayout: () => expand(invoke(layout, { children: 'Page body' })),
    emit: rows => { for (const listener of messageListeners) listener(rows); } };
}
function selectTab(f, label) {
  const tab = nodes(f.render()).find(node => node.props?.role === 'tab' && text(node) === label);
  assert.ok(tab, 'the single menu needs the ' + label + ' tab');
  tab.props.onClick();
}

test('header and security segment expose a single notifications entry', () => {
  const f = fixture();
  const tree = [f.render(), f.renderLayout()];
  assert.equal(nodes(tree).filter(node => /Уведомления/.test(node.props?.['aria-label'] ?? '') && node.type === 'Button' ||
    node.type === 'button' && /Уведомления/.test(node.props?.['aria-label'] ?? '')).length, 1);
});

test('personal rating events are reachable in the header but never counted as unread or marked read', async () => {
  const f = fixture();
  selectTab(f, 'Оценивание');
  const tree = f.render();
  assert.match(text(tree), /Вам доступно итоговое оценивание мероприятия/);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'Badge').map(text), ['2']);
  assert.equal(nodes(tree).filter(node => node.props?.title === 'Отметить все как прочитанные').length, 0);
  const item = nodes(tree).find(node => node.type === 'DropdownMenuItem' && text(node).includes('Вам доступно итоговое'));
  assert.ok(item); await item.props.onSelect({ preventDefault() {} });
  assert.deepEqual(f.calls.filter(call => call[0] === 'navigate'), [['navigate', '/security-ops/ratings/workspace?event=one']]);
  assert.equal(f.calls.some(call => /^mark-/.test(call[0])), false);
});

test('mark-all keeps the latest displayed unread boundary and affects only legacy and ops', async () => {
  const f = fixture();
  const action = nodes(f.render()).find(node => node.props?.title === 'Отметить все как прочитанные');
  await action.props.onClick();
  assert.deepEqual(f.calls.filter(call => call[0] === 'mark-all').sort((a, b) => a[1].localeCompare(b[1])), [
    ['mark-all', 'legacy', '2026-10-02T10:00:00Z'], ['mark-all', 'ops', '2026-10-02T10:00:00Z'],
  ]);
});

test('partial unread failure preserves available items and can retry without rating actions', async () => {
  const f = fixture(); f.state.unread.data.failed = ['legacy'];
  const tree = f.render();
  assert.match(text(tree), /Кадровая заявка/);
  assert.match(text(tree), /список неполный/);
  const retry = nodes(tree).find(node => node.type === 'Button' && text(node) === 'Повторить');
  await retry.props.onClick();
  assert.deepEqual(f.calls.filter(call => call[0] === 'retry'), [['retry', 'unread']]);
});

test('rating errors have an independent retry and do not hide the unread count', async () => {
  const f = fixture(); f.state.rating.error = Error('Private upstream detail');
  f.state.rating.data = undefined; f.state.rating.isError = true;
  selectTab(f, 'Оценивание');
  const tree = f.render();
  const failure = nodes(tree).find(node => node.type === 'LoadFailure');
  assert.ok(failure, 'rating failure must be visible instead of an empty list');
  await failure.props.onRetry();
  assert.deepEqual(f.calls.filter(call => call[0] === 'retry'), [['retry', 'rating']]);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'Badge').map(text), ['2']);
  assert.doesNotMatch(text(tree), /Private upstream detail|Журнал изменений порта|Кадр канала|WS|REST/);
});

test('transport frames invalidate feeds without becoming unread numbers', () => {
  const f = fixture(); f.render();
  f.emit([{ code: 'changed' }, { code: 'changed-again' }, { code: 'duplicate' }]);
  const tree = f.render();
  const invalidated = f.calls.filter(call => call[0] === 'invalidate').map(call => call[1].join('/'));
  assert.ok(invalidated.includes('notifications/unread'));
  assert.ok(invalidated.includes('ops-ratings/notifications'));
  assert.deepEqual(nodes(tree).filter(node => node.type === 'Badge').map(text), ['2']);
});

test('cached rating events show a stale-list explanation after a temporary failure', () => {
  const f = fixture(); f.state.rating.error = Error('Temporary failure');
  selectTab(f, 'Оценивание'); const tree = f.render();
  assert.match(text(tree), /Показаны ранее загруженные события/);
  assert.match(text(tree), /Вам доступно итоговое оценивание мероприятия/);
  assert.ok(nodes(tree).some(node => node.type === 'LoadFailure'));
  assert.deepEqual(nodes(tree).filter(node => node.type === 'Badge').map(text), ['2']);
});

test('rating events alone never create an unread badge or mark-all control', () => {
  const f = fixture(); f.state.unread.data.items = [];
  selectTab(f, 'Оценивание'); const tree = f.render();
  assert.equal(nodes(tree).filter(node => node.type === 'Badge').length, 0);
  assert.equal(nodes(tree).filter(node => node.props?.title === 'Отметить все как прочитанные').length, 0);
  assert.match(text(tree), /Вам доступно итоговое оценивание мероприятия/);
});

test('notification tabs support horizontal keyboard navigation and retain focus', () => {
  const f = fixture();
  const tab = nodes(f.render()).find(node => node.props?.role === 'tab' && text(node) === 'Непрочитанные');
  assert.equal(typeof tab.props.onKeyDown, 'function');
  let prevented = false, focused;
  tab.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; }, stopPropagation() {},
    currentTarget: { parentElement: { querySelector: selector => ({ focus() { focused = selector; } }) } } });
  const selected = nodes(f.render()).find(node => node.props?.role === 'tab' && node.props['aria-selected']);
  assert.equal(text(selected), 'Оценивание');
  assert.equal(prevented, true);
  assert.equal(focused, '[data-notification-tab="rating"]');
});

test('partial mark-all failure still refreshes the real unread feed and reports the failure', async () => {
  const f = fixture(); f.state.legacyReadAllStatus = 500;
  const action = nodes(f.render()).find(node => node.props?.title === 'Отметить все как прочитанные');
  await action.props.onClick();
  assert.equal(f.calls.filter(call => call[0] === 'mark-all').length, 2);
  assert.ok(f.calls.some(call => call[0] === 'invalidate' && call[1].join('/') === 'notifications'));
  assert.ok(f.calls.some(call => call[0] === 'toast' && call[1] === 'Не удалось отметить все прочитанными'));
  assert.equal(f.calls.some(call => call[0] === 'toast' && call[1] === 'Все уведомления прочитаны'), false);
  assert.deepEqual(nodes(f.render()).filter(node => node.type === 'Badge').map(text), ['2']);
});

