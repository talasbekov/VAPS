const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../features/organization-structure/ui/OrgBoard.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function render(permissions, globalPermissions = [], accessState = {}, staffRows = [], view = '3d') {
  let loadState;
  let treeRefreshes = 0;
  const exports = {};
  const ready = { data: [], isPending: false, isLoading: false, isFetching: false, error: null, dataUpdatedAt: 100, refetch() {} };
  const deps = {
    react: { ...require('react'), useMemo: fn => fn(), useEffect: fn => fn(), useState: value => [value === '3d' ? view : value, () => {}] },
    'next/dynamic': { default: () => 'OrgScene3D' },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ hasPermission: code => permissions.includes(code), hasGlobalPermission: code => globalPermissions.includes(code), isLoading: false, error: null, ...accessState }) },
    '@/hooks/use-staff-units': { useStaffUnits: () => ({ ...ready, data: staffRows }) },
    '@/hooks/use-staff-unit-statistics': { useStaffUnitStatistics: () => ({ ...ready, data: { departments: [], directorates: [], divisions: [], scope_division: null } }) },
    '@/hooks/use-divisions-tree': { useDivisionsTree: () => ({ isPending: true, isFetching: false, error: null, dataUpdatedAt: 0, refetch: () => { treeRefreshes++; } }) },
    '@/entities/status': { useStatusNaming: () => ({ labelOf: code => code, colorOf: () => '' }) },
    '@/entities/employee/model/photo-src': { photoSrc: () => '/placeholder.svg', PHOTO_PLACEHOLDER: '/placeholder.svg' },
  };
  vm.runInNewContext(compiled, { exports, require: name => deps[name] ?? (name.startsWith('@/') || name.endsWith('.css') || name === 'lucide-react' || name === 'next/link' ? new Proxy({}, { get: (_, key) => key }) : require(name)) });
  const tree = exports.default({ onLoadStateChange: value => { loadState = value; } });
  const nodes = [];
  function visit(value) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return; nodes.push(value); visit(value.props?.children); }
  visit(tree);
  return { loadState, nodes, treeRefreshes: () => treeRefreshes };
}

test('overview retains unassigned employees and vacancies without a fabricated personnel scope', () => {
  const person = { position: { id: 1, name: 'Инспектор', level: 8 }, employee: { id: '9007199254740993', last_name: 'Безотделов', first_name: 'Иван' } };
  const rows = [
    { id: 10, division: null, parent_id: null, index: 1, employees: [person] },
    { id: 11, division: null, parent_id: null, index: 2, employees: [{ ...person, employee: null }] },
    { id: 20, division: { id: 3, name: 'Реальное управление' }, parent_id: null, index: 3, employees: [{ ...person, employee: { id: 3, last_name: 'Другой', first_name: 'Пётр' } }] },
  ];
  const result = render(['status.view', 'personnel.view'], [], {}, rows, 'table');
  const text = result.nodes.flatMap(node => [node.props?.children].flat(Infinity)).filter(value => typeof value === 'string').join(' ');
  assert.match(text, /Без подразделения/);
  assert.match(text, /Безотделов/);
  assert.match(text, /Реальное управление/);
  assert.match(text, /ВАКАНТ/);
  const links = result.nodes.map(node => node.props?.href).filter(Boolean);
  assert.ok(links.includes('/service-employees?division_id=3'));
  assert.ok(links.every(href => !/division_id=(null|undefined|0|-\d+)/.test(href)));
});

test('scoped admin.roles never makes the board wait for or manually fetch an unauthorized tree', () => {
  const result = render(['admin.roles', 'status.view', 'orgstructure.manage']);
  assert.equal(result.loadState.isLoading, false);
  const scene = result.nodes.find(node => node.type === 'OrgScene3D');
  assert.ok(scene);
  const actions = scene.props.toolbarActions.props.children.flat().filter(Boolean);
  actions.find(node => node.props?.children?.includes('Обновить')).props.onClick();
  assert.equal(result.treeRefreshes(), 0);
});

for (const [name, rights, globals] of [['structure read', ['orgstructure.view'], []], ['global access admin', ['admin.roles'], ['admin.roles']]]) {
  test(name + ' still waits for an authorized pending tree', () => {
    const result = render(rights, globals);
    assert.equal(result.loadState.isLoading, true);
    assert.equal(result.nodes.some(node => node.type === 'OrgScene3D'), false);
  });
}
