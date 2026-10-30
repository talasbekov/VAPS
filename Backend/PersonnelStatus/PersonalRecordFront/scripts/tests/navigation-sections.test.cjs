const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const cache = new Map();
function load(name) {
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name);
  const base = path.join(__dirname, '../..', name.slice(2));
  const file = [base + '.ts', path.join(base, 'index.ts')].find(fs.existsSync);
  assert.ok(file, `Missing navigation module: ${name}`);
  const exports = {}; cache.set(name, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: load, URLSearchParams });
  return exports;
}
const nav = () => load('@/components/navigation/navigation-model');
const access = (codes = ['*'], extra = {}) => ({ permissions: new Set(codes), isLoading: false, error: null, roles: [], hasPermission: c => codes.includes('*') || codes.includes(c), hasGlobalPermission: c => codes.includes('*') || codes.includes(c), ...extra });
test('approved groups use existing modules, with objects only under combat duty', () => {
  const { sections } = nav().navigationFor(access());
  assert.equal(sections.map(s => s.title).join('|'), 'Ежедневный расход|Боевое дежурство|Охранное мероприятие|Мой профиль');
  const duty = sections.find(s => s.id === 'duty');
  assert.equal(duty.items.map(i => i.name).join('|'), 'Журнал дежурств|Объекты и паспорта|Дежурства и документы ОМ');
  assert.equal(sections.filter(s => s.items.some(i => i.href === '/security-ops/objects')).length, 1);
  assert.ok(sections.find(s => s.id === 'events').items.some(i => i.name === 'Оперативный рейтинг'));
});
test('shared report stays one route in both duty and events', () => {
  for (const id of ['duty', 'events']) assert.ok(nav().navigationFor(access()).sections.find(s => s.id === id).items.some(i => i.href === '/security-ops/service-reports'));
  const sections = nav().navigationFor(access()).sections;
  assert.equal(nav().sectionForLocation('/security-ops/service-reports/history/', new URLSearchParams(), sections, 'events'), 'events');
  assert.equal(nav().sectionForLocation('/security-ops/service-reports/job-id/', new URLSearchParams(), sections, 'duty'), 'duty');
});
test('employee mode takes target and actual default into account', () => {
  const sections = nav().navigationFor(access()).sections;
  for (const query of ['view=daily', 'view=department-summary']) assert.equal(nav().sectionForLocation('/employees/', new URLSearchParams(query), sections), 'daily');
  for (const query of ['view=forces', 'request=abc', 'view=daily&collection=abc', 'campaign=abc']) assert.equal(nav().sectionForLocation('/employees/', new URLSearchParams(query), sections), 'events');
  assert.equal(nav().sectionForLocation('/employees/', new URLSearchParams(), sections, undefined, 'forces'), 'events');
});
test('mode switch clears foreign target but retains existing business date filter', () => {
  const daily = nav().navigationFor(access()).sections[0].items.find(i => i.href.startsWith('/employees'));
  const href = nav().navigationHref(daily, '/employees', new URLSearchParams('view=forces&request=x&collection=y&campaign=z&employee=7&tab=requests&businessDate=2026-10-28'));
  const query = new URLSearchParams(href.split('?')[1]);
  assert.equal(query.get('view'), 'daily'); assert.equal(query.get('businessDate'), '2026-10-28');
  for (const key of ['request', 'collection', 'campaign', 'employee', 'tab']) assert.equal(query.get(key), null);
});
test('no-grant actor has profile and common catalogue, with protected modules absent', () => {
  const model = nav().navigationFor(access([]));
  assert.equal(model.sections.map(s => s.id).join('|'), 'personal');
  assert.equal(model.common.map(i => i.href).join('|'), '/workspace|/service-employees');
  assert.equal(model.system.length, 0);
});
test('retained permissions are hidden during loading, failure or undefined permission state', () => {
  for (const state of [{ isLoading: true }, { error: Error('403') }, { permissions: undefined }]) {
    const model = nav().navigationFor(access(['*'], state));
    assert.equal(model.sections.length + model.common.length + model.system.length, 0);
  }
});
test('scoped admin.roles does not expose global access management', () => {
  const model = nav().navigationFor(access(['admin.roles'], { hasGlobalPermission: () => false }));
  assert.equal(model.system.length, 0);
});
test('evaluation-only actor opens the real allowed rating page', () => {
  const model = nav().navigationFor(access(['rating.evaluate']));
  assert.equal(model.sections.find(s => s.id === 'events').items.find(i => i.name === 'Оперативный рейтинг').href, '/security-ops/ratings/workspace');
});
test('directory employee detail is common, while personal profile retains its own group', () => {
  const model = nav().navigationFor(access());
  const query = new URLSearchParams('directory=1');
  assert.equal(nav().sectionForLocation('/security-ops/profile/72/', query, model.sections, 'duty'), 'duty');
  assert.equal(nav().activeNavigationItem(model.common, '/security-ops/profile/72/', query)?.href, '/service-employees');
  assert.equal(nav().sectionForLocation('/security-ops/profile/', new URLSearchParams(), model.sections, 'duty'), 'personal');
});
test('nested analytics uses the more specific OM route even after the daily section', () => {
  const { sections } = nav().navigationFor(access());
  assert.equal(nav().sectionForLocation('/security-ops/analytics/operations/', new URLSearchParams(), sections, 'daily'), 'events');
});
test('headquarters command plus status read retains the existing daily workspace without allocation permission', () => {
  const { sections } = nav().navigationFor(access(['forces.command', 'status.view']));
  assert.ok(sections.find(s => s.id === 'daily').items.some(i => i.href === '/employees?view=daily'));
});
