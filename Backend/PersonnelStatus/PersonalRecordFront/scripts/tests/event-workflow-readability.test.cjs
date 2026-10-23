const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

const root = path.join(__dirname, '../..');
const summary = { posts: 1, need: 2, assigned: 2, replacements: 0, declines: 0, incidents: 0 };
function fixture(stage = 'CLOSED') {
  const visit = (id, objectName) => ({ id, objectId: id, objectName, stage, chiefEmployeeId: '17', chiefName: 'Старший',
    canManageRecon: true, canManagePlacement: false, reconChecklist: [], documentVersions: [], deputies: [],
    passportBinding: null, closureSummary: summary, closingComment: '', approvalRoute: [], approvalRemarks: [],
    documentStatus: 'DRAFT', documentVersion: 0, reconForceRequest: 0, placementNeed: 2, placementAssigned: 0 });
  return { id: '9007199254740993', code: 'ОМ-А', title: 'Проверка цепочки', stage, businessDate: '2026-10-20',
    businessDateEnd: null, objectId: '101', objectName: 'Объект А', ownerName: 'Начальник', kind: 'INTERNAL',
    visitObjects: [visit('101', 'Объект А'), visit('102', 'Объект Б')], reconChecklist: [],
    reconSectorPosts: [
      { id: 'post-a', visitObjectId: '101', sector: 'А', post: 'Пост А', need: 2, requirements: '', minRating: null, comment: '', task: '', demandKindCode: 'PHYSICAL_SQUAD' },
      { id: 'post-b', visitObjectId: '102', sector: 'Б', post: 'Пост Б', need: 3, requirements: '', minRating: null, comment: '', task: '', demandKindCode: 'PHYSICAL_SQUAD' },
    ], vehicles: [], protectedPersons: [], forceRequests: [], forceAllocation: [], forceRoster: [], demandRows: [],
    placementAssignments: [], approvalRoute: [], approvalRemarks: [], journalEntries: [], closureDirectionSummaries: [],
    passportBinding: null, closureSummary: summary, closingComment: '', closedAt: stage === 'CLOSED' ? '2026-10-20T18:00:00Z' : null,
    chiefEmployeeId: '17', chiefName: 'Старший', canManageVisitObjects: false, canEditBulletin: false,
    forceNeed: 5, forceDemandTotal: 0, conflictsCount: 0, readinessPercent: 0, approvalStatus: 'PENDING',
    protectedPersonName: '', protectedPersonId: null, eventTime: null, location: '', address: '', countryName: '', cityName: '' };
}

// Evaluate the actual components with network/session hooks replaced at their
// external boundary. JSX, domain helpers and URL selection remain production code.
function authority(permissions, extra = {}) {
  return { isLoading: false, error: null, permissions: new Set(permissions), roles: [], ...extra,
    hasPermission: code => permissions.includes('*') || permissions.includes(code) };
}
function harness({ event = fixture(), query = 'visit=101&back=stage%3DCLOSED', permissions = ['event.view'], grantState } = {}) {
  let params = new URLSearchParams(query);
  const writes = [];
  const mutation = () => ({ isPending: false, isError: false, isSuccess: false, error: null, data: undefined,
    reset() {}, mutate(body) { writes.push(body); } });
  let access = grantState ?? authority(permissions);
  const request = { eventId: event.id, code: event.code, title: event.title, businessDate: event.businessDate,
    allocationId: 'allocation-a', departmentName: 'Первый департамент', status: 'NOTIFIED', dueAt: null,
    directorates: [{ divisionId: '201', name: 'Управление', need: 2, assigned: 0, notifiedAt: null }] };
  const ui = new Proxy({}, { get: (_, name) => String(name) });
  const overrides = {
    react: { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect() {}, useMemo: compute => compute(), useCallback: fn => fn, useRef: initial => ({ current: initial }),
      useTransition: () => [false, fn => fn()] },
    'next/link': { default: 'Link' },
    'next/navigation': { useSearchParams: () => params, useParams: () => ({ id: event.id }), usePathname: () => '/security-ops/events/' + event.id,
      useRouter: () => ({ replace() {}, push() {} }) },
    'lucide-react': ui,
    '@tanstack/react-query': { useQuery: () => ({ data: [], isPending: false, isError: false }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => access },
    '@/hooks/use-security-events': { useSecurityEvent: () => ({ data: event, isLoading: false, isError: false }) },
    '@/hooks/use-security-event-stages': { useCompleteRecon: mutation, useImportReconPosts: mutation,
      useUpdateRecon: mutation, useOverrideStage: mutation, ...Object.fromEntries([
        'useAssignPlacement','useMovePlacement','useCompletePlacement','useRemovePlacementPost',
        'useSetSectorSenior','useUnassignPlacement','useUpdatePlacementPostComment',
      ].map(name => [name, mutation])) },
    '@/hooks/use-forces-request-banner': { useDirectorateForcesRequests: () => ({ data: { results: [request] } }),
      useDirectorateForcesRequest: () => ({ data: request, isPending: false, isError: false }), useSelectForRequest: mutation },
    '@/hooks/use-participation-catalog': { useParticipationCatalog: () => ({ data: [], isPending: false, isError: false }) },
    '@/hooks/use-security-objects': { useSecurityObject: () => ({ data: undefined, isLoading: false }) },
    '@/hooks/use-ops-ratings': { useOperationalRatings: () => ({ data: { results: [] }, isPending: false, isError: false }) },
    '@/hooks/use-ops-reports': {}, '@/hooks/use-gvo-summaries': {},
    '@/hooks/use-my-employee': { useMyEmployee: () => ({ isSuccess: true, data: { employee: { id: '17' } } }) },
    '@/hooks/use-placement-roles': { usePlacementRoles: () => ({ data: [] }) },
    '@/hooks/use-placement-sections': { usePlacementSections: () => ({ data: [] }) },
    '@/shared/hooks/use-toast': { useToast: () => ({ toast() {} }) },
    '@/features/offline-map/ui/PlacementMap': ui,
    '@/features/ops-conflict-override': ui,
    '@/features/forces-split/ui/chain-access': { useChainAccess: () => ({ can: access.hasPermission, reason: () => 'fixture read-only' }) },
    '@/shared/config/in-development': { inDevelopmentOfStage: () => null },
    '@/features/security-event-stages': { ...ui, AcknowledgementStage: 'AcknowledgementStage', ApprovalStage: 'ApprovalStage',
      AwaitingReconStage: 'AwaitingReconStage', BulletinPanel: 'BulletinPanel', ClosedView: 'ClosedView', ConductStage: 'ConductStage',
      PlacementStage: 'PlacementStage', ReconStage: 'ReconStage', UNASSIGNED_VISIT: '__unassigned__',
      unassignedIsMeaningful: () => false },
  };
  const cache = new Map();
  function load(name, importer) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/components/') || name === '@/widgets/security-event-stepper' ||
        name === '@/features/event-visit-objects' || name.includes('/ui/AssignChiefDialog') ||
        name === '@/features/event-participation/ui/ParticipationKindPicker' ||
        name === '@/features/ops-reports/report-shared') return ui;
    if (['./ReconMaterials', './StageErrors', './Fact', './RatingBriefDialog'].includes(name)) return ui;
    if (!name.startsWith('@/') && !name.startsWith('.')) return require(name);
    const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(importer), name);
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    if (!file) throw Error('Missing production module ' + name);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(file, 'utf8') + (path.basename(file) === 'PlacementStage.tsx' ? '\nexports.__PlacementBoard=PlacementBoard;' : '');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, URLSearchParams, URL, console, require: id => load(id, file) }, { filename: file });
    return exports;
  }
  return { event, writes, load: name => load('@/' + name), setQuery: value => { params = new URLSearchParams(value); },
    setAuthority: value => { access = value; } };
}

function nodes(tree) {
  const result = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object' || !node.props) return;
    result.push(node); visit(node.props.children);
  }
  visit(tree); return result;
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean' || typeof tree === 'function') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
function page(f) {
  const wrapper = f.load('app/security-ops/events/[id]/page').default();
  return wrapper.props.children.type();
}

test('a directorate head gets request context without a link to an event they cannot read', () => {
  for (const [permissions, expected] of [[['status.manage'], false], [['status.manage', 'event.view'], true]]) {
    const f = harness({ permissions, query: 'forcesRequest=allocation-a' });
    const tree = f.load('features/forces-request-banner/ui/ForcesRequestBanner').ForcesRequestBanner({});
    const links = nodes(tree).filter(node => node.type === 'Link' && node.props.href.includes('/security-ops/events/'));
    assert.equal(links.length, Number(expected));
    assert.match(text(tree), /Проверка цепочки/);
    assert.equal(f.writes.length, 0);
  }
});

test('archive document links preserve object and registry context and select the actual reader route', () => {
  const f = harness();
  const tree = f.load('features/security-event-stages/ui/ClosedView').ClosedView({ event: f.event });
  for (const [label, document] of [['Рекогносцировка (чек-лист, посты) →', 'recon'], ['Бюллетень →', 'bulletin']]) {
    const link = nodes(tree).find(node => node.type === 'Link' && text(node).trim() === label);
    assert.ok(link, label);
    const url = new URL(link.props.href, 'http://localhost');
    assert.equal(url.pathname, '/security-ops/events/9007199254740993/');
    assert.equal(url.searchParams.get('step'), '1');
    assert.equal(url.searchParams.get('document'), document);
    assert.equal(url.searchParams.get('visit'), '101');
    assert.equal(url.searchParams.get('back'), 'stage=CLOSED');
    assert.equal(url.searchParams.has('stage'), false);
  }
});

test('an ordinary archive reader can open recon without any stage or editing authority', () => {
  const f = harness({ query: 'step=1&document=recon&visit=102&back=stage%3DCLOSED' });
  const tree = page(f);
  const stage = nodes(tree).find(node => node.type?.name === 'ActiveStage');
  assert.equal(stage?.props.stage, 'RECON');
  assert.equal(stage?.props.readOnly, true);
  const content = stage.type(stage.props);
  assert.equal(content.type, 'ReconStage');
  assert.equal(content.props.readOnly, true);
  const notice = nodes(tree).find(node => node.type?.name === 'StageViewNotice');
  assert.equal(notice?.props.canOverrideStage, false);
  assert.equal(f.writes.length, 0);
});

test('the archive bulletin opens its information panel without rendering an editable stage', () => {
  const f = harness({ query: 'step=1&document=bulletin&visit=102&back=stage%3DCLOSED' });
  const tree = page(f);
  const bulletin = nodes(tree).find(node => node.type === 'BulletinPanel');
  assert.ok(bulletin, 'closed archive exposes the requested bulletin');
  assert.equal(bulletin.props.initiallyOpen, true);
  assert.equal(nodes(tree).some(node => node.type?.name === 'ActiveStage'), false);
  assert.equal(f.writes.length, 0);
  const panel = f.load('features/security-event-stages/ui/BulletinPanel').BulletinPanel(bulletin.props);
  assert.equal(nodes(panel).find(node => node.props.id === 'bulletin-panel-body').props.hidden, false);
});

test('a chief reading an archived document gets no stage-transition action', () => {
  const f = harness({ query: 'step=1&document=recon&visit=101', permissions: ['event.view', 'event.stage_override'] });
  const notice = nodes(page(f)).find(node => node.type?.name === 'StageViewNotice');
  assert.equal(notice?.props.canOverrideStage, false);
  assert.equal(f.writes.length, 0);
});

test('an archive document parameter cannot bypass a live stage or the event read gate', () => {
  const live = harness({ event: fixture('APPROVAL'), query: 'step=1&document=recon&visit=101' });
  assert.equal(nodes(page(live)).find(node => node.type?.name === 'ActiveStage')?.props.stage, 'APPROVAL');
  const denied = harness({ permissions: [], query: 'step=1&document=recon&visit=101' });
  assert.equal(page(denied).type, 'OpsAccessDenied');
  assert.equal(live.writes.length + denied.writes.length, 0);
});

test('a closed object archive remains readable while another object continues its live lifecycle', () => {
  const event = fixture('RECON');
  event.visitObjects[0].stage = 'CLOSED';
  const f = harness({ event, query: 'step=1&document=recon&visit=101' });
  const stage = nodes(page(f)).find(node => node.type?.name === 'ActiveStage');
  assert.equal(stage?.props.stage, 'RECON');
  assert.equal(stage?.props.readOnly, true);
  assert.equal(f.writes.length, 0);
});

test('recon publishes the selected object number without promising to send a neighbour draft', () => {
  const f = harness({ event: fixture('RECON'), query: 'visit=101', permissions: ['event.view'] });
  const tree = f.load('features/security-event-stages/ui/ReconStage').ReconStage({ event: f.event });
  const footer = nodes(tree).find(node => node.props['data-slot'] === 'recon-footer');
  assert.ok(footer);
  assert.equal(text(nodes(footer).find(node => node.props['data-slot'] === 'recon-need')), '2');
  assert.doesNotMatch(text(footer), /штабу уйдёт по мероприятию\s*5/);
  assert.equal(f.writes.length, 0);
});

test('read-only recon disables writes even when the server capability names its usual manager', () => {
  const f = harness({ event: fixture('RECON'), query: 'visit=101', permissions: ['event.view'] });
  const tree = f.load('features/security-event-stages/ui/ReconStage').ReconStage({ event: f.event, readOnly: true });
  assert.equal(nodes(tree).find(node => node.type === 'fieldset').props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === 'ReconMaterials').props.canManage, false);
  const save = nodes(tree).find(node => node.type === 'Button' && text(node).trim() === 'Сохранить');
  assert.equal(save.props.disabled, true);
  save.props.onClick();
  assert.equal(f.writes.length, 0);
});

const eventPassport = { objectId: '101', versionId: 'event-version', versionNumber: 37 };
const visitPassport = { objectId: '102', versionId: 'visit-version', versionNumber: 42 };
function boundEvent(stage = 'CLOSED') {
  const event = fixture(stage);
  event.passportBinding = { ...eventPassport };
  event.visitObjects[1].passportBinding = { ...visitPassport };
  event.reconSectorPosts[1].requirements = 'Fixture requirements';
  event.reconSectorPosts[1].task = 'Fixture post task';
  return event;
}
const passportLinks = tree => nodes(tree).filter(node => node.type === 'Link' && /\/objects\/[^/]+\/passports\//.test(node.props.href));
function archive(f) {
  return f.load('features/security-event-stages/ui/ClosedView').ClosedView({ event: f.event });
}
function board(f, readOnly = true) {
  return f.load('features/security-event-stages/ui/PlacementStage').__PlacementBoard({ event: f.event, showMap: false, readOnly });
}
function selectedPost(tree) {
  const selected = nodes(tree).find(node => node.props.id === 'placement-selected-post');
  assert.ok(selected, 'a real scoped post is selected by the production URL-selection hook');
  assert.match(text(selected), /Fixture requirements/);
  assert.match(text(selected), /Fixture post task/);
  assert.match(text(selected), /0 из 3/);
  return selected;
}
function assertArchiveLinks(tree) {
  const documents = nodes(tree).find(node => node.props.id === 'archive-documents');
  assert.ok(documents);
  const links = nodes(documents).filter(node => node.type === 'Link' && node.props.href.includes('/security-ops/events/'));
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(node => new URL(node.props.href, 'http://localhost').searchParams.get('document')), ['recon','bulletin']);
}
const destinationCases = [
  ['event only',authority(['event.view']),false],
  ['unrelated report grant',authority(['event.view','daily_report.generate']),false],
  ['independent object grant',authority(['event.view','object.view']),true],
  ['wildcard',authority(['*']),true],
  ['unknown cached authority',authority(['*'],{ permissions: undefined }),false],
  ['loading cached object grant',authority(['event.view','object.view'],{ isLoading: true }),false],
  ['failed cached object grant',authority(['event.view','object.view'],{ error: Error('permissions unavailable') }),false],
];
for (const [name,grantState,linked] of destinationCases) test('bound archive passport destination: ' + name, () => {
  const f = harness({ event: boundEvent(), grantState });
  const tree = archive(f), links = passportLinks(tree);
  assert.equal(links.length, Number(linked));
  if (linked) assert.equal(links[0].props.href, '/security-ops/objects/101/passports/event-version');
  assert.match(text(nodes(tree).find(node => node.props.id === 'archive-documents')), /37/);
  assertArchiveLinks(tree);
  assert.equal(f.writes.length, 0);
});
test('same archive keeps version and document context after object grant revocation', () => {
  const f = harness({ event: boundEvent(), permissions: ['event.view','object.view'] });
  const before = archive(f);
  assert.equal(passportLinks(before).length, 1);
  const summary = text(nodes(before).find(node => node.props['data-slot'] === 'closure-summary-line'));
  f.setAuthority(authority(['event.view']));
  const after = archive(f);
  assert.equal(passportLinks(after).length, 0);
  assert.match(text(nodes(after).find(node => node.props.id === 'archive-documents')), /37/);
  assert.equal(text(nodes(after).find(node => node.props['data-slot'] === 'closure-summary-line')), summary);
  assertArchiveLinks(after);
});
for (const visitOnly of [false,true]) test('null event archive binding does not invent a passport from a visit: ' + visitOnly, () => {
  const event = boundEvent(); event.passportBinding = null;
  if (!visitOnly) event.visitObjects[1].passportBinding = null;
  const tree = archive(harness({ event, permissions: ['event.view','object.view'] }));
  assert.equal(passportLinks(tree).length, 0);
  assertArchiveLinks(tree);
});
for (const [name,grantState,linked] of destinationCases) test('selected-visit placement passport destination: ' + name, () => {
  const f = harness({ event: boundEvent('PLACEMENT'), query: 'visit=102&post=post-b', grantState });
  const tree = board(f), selected = selectedPost(tree), links = passportLinks(selected);
  assert.equal(links.length, Number(linked));
  if (linked) assert.equal(links[0].props.href, '/security-ops/objects/102/passports/visit-version/');
  else assert.match(text(selected), /42/);
  assert.equal(f.writes.length, 0);
});
test('same selected post keeps requirements and version after object grant revocation', () => {
  const f = harness({ event: boundEvent('PLACEMENT'), query: 'visit=102&post=post-b', permissions: ['event.view','object.view'] });
  assert.equal(passportLinks(selectedPost(board(f))).length, 1);
  f.setAuthority(authority(['event.view']));
  const selected = selectedPost(board(f));
  assert.equal(passportLinks(selected).length, 0);
  assert.match(text(selected), /42/);
  assert.equal(f.writes.length, 0);
});
test('placement falls back to the event passport only for the same real object', () => {
  const f = harness({ event: boundEvent('PLACEMENT'), query: 'visit=101&post=post-a', permissions: ['event.view','object.view'] });
  const links = passportLinks(board(f));
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, '/security-ops/objects/101/passports/event-version/');
});
for (const objectId of ['102',null]) test('placement does not borrow an event passport for a mismatched/null object: ' + objectId, () => {
  const event = boundEvent('PLACEMENT'); event.visitObjects[1].passportBinding = null; event.visitObjects[1].objectId = objectId;
  const f = harness({ event, query: 'visit=102&post=post-b', permissions: ['event.view','object.view'] });
  assert.equal(passportLinks(selectedPost(board(f))).length, 0);
});
test('placement with no scoped post does not expose a passport anchor', () => {
  const event = boundEvent('PLACEMENT'); event.reconSectorPosts = [];
  const tree = board(harness({ event, query: 'visit=102', permissions: ['event.view','object.view'] }));
  assert.equal(nodes(tree).some(node => node.props.id === 'placement-selected-post'), false);
  assert.equal(passportLinks(tree).length, 0);
});
test('cross-visit post URL falls back inside the selected visit without borrowing its passport', () => {
  const f = harness({ event: boundEvent('PLACEMENT'), query: 'visit=102&post=post-a', permissions: ['event.view','object.view'] });
  const links = passportLinks(selectedPost(board(f)));
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, '/security-ops/objects/102/passports/visit-version/');
});
test('passport viewing does not unlock a read-only placement even with manager capability', () => {
  const event = boundEvent('PLACEMENT'); event.visitObjects[1].canManagePlacement = true;
  const f = harness({ event, query: 'visit=102&post=post-b', permissions: ['event.view','object.view','placement.manage'] });
  const tree = board(f, true);
  assert.equal(passportLinks(selectedPost(tree)).length, 1);
  const comment = nodes(tree).find(node => node.props.id === 'post-comment');
  assert.ok(comment);
  assert.equal(comment.props.readOnly, true);
  assert.equal(f.writes.length, 0);
});
