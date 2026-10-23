const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { QueryClient } = require('@tanstack/react-query');

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const strength = name => ({ business_date: '2026-10-20', columns: [], column_labels: {},
  rows: [{ division_id: name === 'outside' ? 99 : 12, name, staff_total: 10, list_total: 8, vacancies: 2, columns: {}, event: { total: 0 } }] });
const preview = name => ({ count: 1, page: 1, page_size: 25, next_page: null, previous_page: null,
  divisions: [{ id: name === 'outside' ? 99 : 12, name, ancestors: [] }], basis: 'current_staffing', as_of: '2026-09-01',
  totals: { staff_total: 1, occupied: 1, vacancies: 0, dismissed_in_slot: 0, person_days: 2, unique_people: 1 },
  date_from: '2026-08-02', date_to: '2026-09-01',
  rows: [{ staff_unit_id: 1, division_name: name, ancestors: [], employee_name: name, occupancy: 'occupied',
    code: name, name, person_days: 2, unique_people: 1 }] });

function fixture(t, target = 'daily') {
  const client = new QueryClient(); t.after(() => client.clear());
  const session = { user: { id: 'reader-a' } };
  const grants = global => ({ permissions: ['daily_report.generate', 'status.view', 'orgstructure.view'],
    global_permissions: global ? ['daily_report.generate', 'status.view', 'orgstructure.view'] : [],
    roles: [{ code: 'REPORT_READER', scope_division_id: global ? null : 12 }] });
  client.setQueryData(['ops-me'], grants(true));
  const state = { marker: 'outside', defer: false, pending: [], reads: [], urls: [], saved: [], toasts: [], status: 200 };
  const perform = async kind => {
    state.reads.push(kind);
    if (state.status !== 200) throw Object.assign(Error('Source rejected'), { status: state.status });
    if (state.defer) return new Promise(resolve => state.pending.push({ kind, resolve }));
    return kind === 'daily' ? strength(state.marker) : kind === 'preview' ? preview(state.marker)
      : kind === 'xlsx' ? { blob: {}, filename: 'staffing.xlsx' } : {};
  };
  const slots = [], effects = []; let index = 0;
  const changed = (old, next) => !old || !next || old.length !== next.length || old.some((value, i) => !Object.is(value, next[i]));
  const react = { ...React,
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useMemo(fn, deps) { const slot = index++; if (changed(slots[slot]?.deps, deps)) slots[slot] = { deps, value: fn() }; return slots[slot].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const slot = index++; if (changed(slots[slot]?.deps, deps)) {
      const old = slots[slot]; slots[slot] = { deps }; effects.push(() => { old?.cleanup?.(); slots[slot].cleanup = fn(); });
    } },
  };
  const markers = new Proxy({}, { get: (_, key) => String(key) });
  const overrides = {
    react, '@tanstack/react-query': { ...require('@tanstack/react-query'), useQueryClient: () => client },
    'next-auth/react': { useSession: () => ({ data: session, status: 'authenticated' }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const current = client.getQueryState(['ops-me']);
      return { isLoading: current.status === 'pending', error: current.error,
        hasPermission: code => current.status === 'success' && current.data.permissions.includes(code) };
    } },
    '@/lib/api': { OpsApiError: Error, apiClient: {
      getStrengthReport: () => perform('daily'), downloadStrengthReportExport: () => perform('daily-xlsx'),
    } },
    '@/lib/ops-api': { opsApiClient: { get: url => { state.urls.push(url); return perform('preview'); }, download: () => perform('xlsx') } },
    '@/shared/hooks/use-toast': { useToast: () => ({ toast: value => state.toasts.push(value) }) },
    '@/lib/utils': { cn: () => '' },
  };
  const modules = new Map();
  function load(id, importer) {
    if (id in overrides) return overrides[id];
    if (id === 'lucide-react' || id.startsWith('@/components/ui/') || id.startsWith('@/components/reports/') ||
        id === '@/components/dashboard-layout' || id === '@/components/page-header' || id === '@/components/load-failure' || id === '@/components/ops-access-denied') return markers;
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const base = id.startsWith('@/') ? path.join(__dirname, '../..', id.slice(2)) : path.resolve(path.dirname(importer), id);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, URLSearchParams, require: name => load(name, file),
      window: { URL: { createObjectURL: () => 'blob:local', revokeObjectURL() {} } },
      document: { createElement: () => ({ click() { state.saved.push(this.download); }, remove() {} }),
        body: { appendChild() {}, removeChild() {} } },
    });
    return exports;
  }
  const authority = load('@/lib/ops-write-authority');
  t.after(authority.registerOpsWriteAuthority(() => authority.currentOpsAuthorityStamp(client, session.user.id)));
  let component;
  if (target === 'daily') component = load('@/app/reports/page').default;
  else {
    const source = path.join(__dirname, '../../components/reports/personnel-report-cards.tsx');
    // Load the real composition while leaving its shared presentational wrappers as markers.
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, URLSearchParams, require: name => load(name, source),
      window: { URL: { createObjectURL: () => 'blob:local', revokeObjectURL() {} } },
      document: { createElement: () => ({ click() { state.saved.push(this.download); }, remove() {} }), body: { appendChild() {} } },
    });
    const tree = exports.PersonnelReportCards({ canReadStaffing: true, canReadAbsences: true, permissionsLoading: false });
    const child = nodes(tree).find(node => node.type?.name === (target === 'staffing' ? 'StaffingCard' : 'AbsenceCard'));
    component = () => child.type(child.props);
  }
  const flush = () => { while (effects.length) effects.shift()(); };
  const render = (commit = true) => { index = 0; const tree = component(); if (commit) flush(); return tree; };
  return { client, state, session, grants, render, flush,
    button: (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node).includes(label)),
    resolve: (kind, data) => { const at = state.pending.findIndex(row => row.kind === kind); assert.notEqual(at, -1);
      state.pending.splice(at, 1)[0].resolve(data); },
  };
}

test('daily report hides a loaded outside row immediately when the same permission narrows', async t => {
  const f = fixture(t); await f.button(f.render(), 'Показать расход').props.onClick();
  assert.match(text(f.render()), /outside/);
  f.client.setQueryData(['ops-me'], f.grants(false));
  assert.doesNotMatch(text(f.render(false)), /outside/, 'hide before passive cleanup effects');
  f.flush(); f.state.marker = 'own'; await f.button(f.render(), 'Показать расход').props.onClick();
  assert.match(text(f.render()), /own/);
});

test('a late wide daily response cannot replace the new authorized report', async t => {
  const f = fixture(t); f.state.defer = true;
  const old = f.button(f.render(), 'Показать расход').props.onClick();
  f.client.setQueryData(['ops-me'], f.grants(false)); f.render();
  f.state.defer = false; f.state.marker = 'own';
  const current = nodes(f.render()).find(node => node.type === 'Button' && node.props['aria-busy'] !== undefined);
  assert.equal(current.props.disabled, false, 'an old authority request cannot keep the new scope busy');
  await current.props.onClick();
  f.resolve('daily', strength('outside')); await old;
  assert.match(text(f.render()), /own/); assert.doesNotMatch(text(f.render()), /outside/);
});

test('daily export delivery is discarded after narrowing and fresh own-scope export keeps the report date', async t => {
  const f = fixture(t); await f.button(f.render(), 'Показать расход').props.onClick();
  f.state.defer = true;
  const exporting = nodes(f.render()).find(node => node.type === 'Button' && node.props.size === 'sm').props.onClick();
  f.client.setQueryData(['ops-me'], f.grants(false)); f.render();
  f.resolve('daily-xlsx', {}); await exporting;
  assert.equal(f.state.saved.length, 0); assert.equal(f.state.toasts.length, 0);
  f.state.defer = false; f.state.marker = 'own'; await f.button(f.render(), 'Показать расход').props.onClick();
  await nodes(f.render()).find(node => node.type === 'Button' && node.props.size === 'sm').props.onClick();
  assert.deepEqual(f.state.saved, ['расход_own_2026-10-20.xlsx']);
});

for (const target of ['staffing', 'absences']) test(`${target}: rows, division options and source date reset before own-scope reload`, async t => {
  const f = fixture(t, target); f.render(); await settle();
  assert.match(text(f.render()), /outside/);
  f.client.setQueryData(['ops-me'], f.grants(false)); f.state.defer = true;
  const hidden = f.render(false);
  assert.doesNotMatch(text(hidden), /outside/);
  const filter = nodes(hidden).find(node => node.type?.name === 'DivisionFilter');
  assert.equal(filter.props.divisions.length, 0, 'outside department choices must disappear with the old report');
  if (target === 'absences') assert.notEqual(nodes(hidden).find(node => node.props?.id === 'absences-to').props.max, '2026-09-01');
  f.flush(); f.resolve('preview', preview('own')); await settle();
  assert.match(text(f.render()), /own/); assert.doesNotMatch(text(f.render()), /outside/);
});

test('a late staffing preview from the previous authority cannot publish names or division choices', async t => {
  const f = fixture(t, 'staffing'); f.state.defer = true; f.render();
  f.client.setQueryData(['ops-me'], f.grants(false)); f.render();
  f.resolve('preview', preview('outside')); await settle();
  assert.doesNotMatch(text(f.render()), /outside/);
  f.resolve('preview', preview('own')); await settle();
  assert.match(text(f.render()), /own/);
});

test('a staffing file returned after the live actor changes is never delivered', async t => {
  const f = fixture(t, 'staffing'); f.render(); await settle();
  f.state.defer = true; const downloading = f.button(f.render(), 'Скачать Excel').props.onClick();
  f.session.user.id = 'reader-b';
  f.resolve('xlsx', { blob: {}, filename: 'outside.xlsx' }); await downloading; await settle();
  assert.equal(f.state.saved.length, 0); assert.equal(f.state.toasts.length, 0);
});

test('an old staffing export does not leave the new authorized preview permanently busy', async t => {
  const f = fixture(t, 'staffing'); f.render(); await settle();
  f.state.defer = true; f.button(f.render(), 'Скачать Excel').props.onClick();
  f.state.defer = false; f.state.marker = 'own'; f.client.setQueryData(['ops-me'], f.grants(false));
  f.render(); await settle();
  assert.equal(f.button(f.render(), 'Скачать Excel').props.disabled, false);
  f.resolve('xlsx', { blob: {}, filename: 'outside.xlsx' }); await settle();
  assert.equal(f.state.saved.length, 0);
  f.button(f.render(), 'Скачать Excel').props.onClick(); await settle();
  assert.deepEqual(f.state.saved, ['staffing.xlsx']);
});

test('a narrowed personnel preview clears a previously selected outside department before reloading', async t => {
  const f = fixture(t, 'staffing'); f.render(); await settle();
  nodes(f.render()).find(node => node.type?.name === 'DivisionFilter').props.onChange('99');
  f.button(f.render(), 'Показать штат').props.onClick(); await settle();
  assert.match(f.state.urls.at(-1), /division_id=99/);
  f.client.setQueryData(['ops-me'], f.grants(false)); f.state.marker = 'own'; f.render(); await settle();
  const next = f.render();
  assert.doesNotMatch(f.state.urls.at(-1), /division_id=99/);
  assert.equal(nodes(next).find(node => node.type?.name === 'DivisionFilter').props.value, '');
  assert.match(text(next), /own/);
});

test('a denied personnel source clears department options and its date through a later temporary failure', async t => {
  const f = fixture(t, 'staffing'); f.render(); await settle();
  f.state.status = 403; f.button(f.render(), 'Показать штат').props.onClick(); await settle();
  assert.equal(nodes(f.render()).find(node => node.type?.name === 'DivisionFilter').props.divisions.length, 0);
  f.state.status = 503; f.button(f.render(), 'Показать штат').props.onClick(); await settle();
  assert.equal(nodes(f.render()).find(node => node.type?.name === 'DivisionFilter').props.divisions.length, 0);
  f.state.status = 200; f.state.marker = 'own'; f.button(f.render(), 'Показать штат').props.onClick(); await settle();
  assert.match(text(f.render()), /own/);
});

test('a daily file already in flight is discarded after its source denies a fresh read', async t => {
  const f = fixture(t); await f.button(f.render(), 'Показать расход').props.onClick();
  f.state.defer = true;
  const downloading = nodes(f.render()).find(node => node.type === 'Button' && node.props.size === 'sm').props.onClick();
  f.state.defer = false; f.state.status = 403; await f.button(f.render(), 'Показать расход').props.onClick();
  f.render(); f.resolve('daily-xlsx', {}); await downloading;
  assert.equal(f.state.saved.length, 0);
});

test('a retained daily export callback cannot use a report denied by a later read', async t => {
  const f = fixture(t); await f.button(f.render(), 'Показать расход').props.onClick();
  const old = nodes(f.render()).find(node => node.type === 'Button' && node.props.size === 'sm').props.onClick;
  f.state.status = 403; await f.button(f.render(), 'Показать расход').props.onClick(); f.render();
  f.state.status = 503; await f.button(f.render(), 'Показать расход').props.onClick(); f.render();
  const count = f.state.reads.length; f.state.status = 200; await old();
  assert.equal(f.state.reads.length, count); assert.equal(f.state.saved.length, 0);
});
