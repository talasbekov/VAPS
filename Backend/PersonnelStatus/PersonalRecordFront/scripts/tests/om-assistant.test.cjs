const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const query = require('@tanstack/react-query');
const taskId = '2733240a-32a0-46cd-9ad9-5127665c29e8';
const task = patch => ({ id: taskId, initiatedBy: 'chief', revision: 2, status: 'awaiting_executor', delegated: true,
  canEdit: true, canContinue: true, questions: [], interpretationNotice: null, message: 'Запроси наряд',
  plan: { title: 'Встреча', businessDate: '2026-10-25', kind: 'INTERNAL', objectId: '9007199254740993', objectName: 'Объект',
    eventId: '70', intent: 'send', allocations: [{ departmentId: '9007199254740995', need: 4 }] },
  event: { id: '70', code: 'ОМ-70', title: 'Встреча', stage: 'RECON', forceDemandTotal: 10, requested: 0, rosterCount: 0 },
  receipts: [], updatedAt: '2026-10-21T10:00:00Z', ...patch });

test('multi-object briefing retains each object need and expandable structure without inventing a total', t => {
  const f = fixture(t);
  const value = task({ event: null, status: 'needs_information', canContinue: false, plan: {
    title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-28', briefing: { objects: [
      { name: 'Аккорда', objectId: '9007199254740993', chiefName: 'Асанов А.', chiefEmployeeId: 'secret-chief-id',
        sectorCount: 2, sectors: [{ number: 1, postCount: 2, posts: [{ number: 1, need: 3, subpostCount: 3,
          subposts: [{ number: 1, need: 2 }, { number: 2, need: null }, { number: 3, need: 0 }] }, { number: 2, subpostCount: 0 }] },
          { number: 2, postCount: null, posts: [] }], personnelNeed: 5, needStatus: 'known', checklistChecked: true },
      { name: 'Тарлан', sectors: [], personnelNeed: 8, needStatus: 'known', checklistChecked: false },
      { name: 'Бейбитшилик сарайы', sectors: [], personnelNeed: 0, needStatus: 'unknown' },
      { name: 'Ritz', sectorCount: 0, sectors: [], personnelNeed: 0, needStatus: 'known' },
    ], protectedPersons: [] } }, questions: [{ field: 'briefing.objects[2].personnelNeed', text: 'Сколько людей нужно на Бейбитшилик сарайы?' }] });
  const before = JSON.stringify(value);
  const html = renderWorkspace(f, value);
  const briefing = html.match(/<section[^>]*aria-label="Объекты и охраняемые лица поручения"[\s\S]*?<\/section>/)?.[0];
  assert.ok(briefing, 'the card must render recognized multi-object briefing');
  for (const [name, need] of [['Аккорда', '5 чел.'], ['Тарлан', '8 чел.'], ['Бейбитшилик сарайы', 'Нужно уточнить'], ['Ritz', '0 чел.']]) {
    const object = [...briefing.matchAll(/<details[^>]*>[\s\S]*?<\/details>/g)].map(match => match[0]).find(row => row.includes(name));
    assert.ok(object, `${name} must have expandable details`);
    assert.ok(object.match(/<summary[^>]*>[\s\S]*?<\/summary>/)[0].includes(need), `${name} retains its own need`);
  }
  assert.match(briefing, /Асанов А\./);
  assert.match(briefing, /Сектор 1/); assert.match(briefing, /Постов: 2/);
  assert.match(briefing, /Пост 1/); assert.match(briefing, /Подпостов: 3/); assert.match(briefing, /Подпостов: 0/);
  assert.match(briefing, /Пост 2 · Потребность: Нужно уточнить/);
  assert.match(briefing, /Подпост 1: 2 чел\./); assert.match(briefing, /Подпост 2: Нужно уточнить/); assert.match(briefing, /Подпост 3: 0 чел\./);
  assert.match(briefing, /Сектор 2/); assert.match(briefing, /Постов: Нужно уточнить/);
  assert.match(briefing, /Секторов<\/dt><dd[^>]*>0/);
  assert.doesNotMatch(briefing, /13 чел\.|21 чел\.|secret-chief-id|9007199254740993/);
  const metadata = html.match(/<dl[^>]*aria-label="Сведения поручения"[\s\S]*?<\/dl>/)?.[0];
  assert.doesNotMatch(metadata, />Не указан<|Объект выбран/);
  assert.match(html, /Сколько людей нужно на Бейбитшилик сарайы\?/);
  assert.equal(JSON.stringify(value), before);
  assert.equal(f.state.writes.length, 0);
});

test('briefing displays protected person codes and foreign identity without treating checklist declarations as recon completion', t => {
  const f = fixture(t);
  const value = task({ status: 'needs_information', canEdit: false, canContinue: false, event: null,
    plan: { kind: 'FOREIGN', briefing: { objects: [{ name: 'Ritz <зал>', objectId: 'private-object-id', sectors: [], needStatus: 'unknown', checklistChecked: true }],
      protectedPersons: [{ code: '800', personId: 'private-person-id' }, { code: '802' }, { code: '803' },
        { name: 'Гость <имя>', country: 'Казахстан', createIfMissing: true }],
      issues: [{ field: 'briefing.objects[0].chiefName', text: 'Уточните старшего Ritz.' }] },
      briefingPending: [{ objectId: 'private-object-id', action: 'Подтвердить рекогносцировку в карточке ОМ', reason: 'Требуется действие старшего объекта.' }] },
    questions: [{ field: 'briefing.objects[0].chiefName', text: 'Уточните старшего Ritz.' }] });
  const html = renderWorkspace(f, value, true);
  for (const code of ['800', '802', '803']) assert.match(html, new RegExp(`Код ${code}`));
  assert.match(html, /Гость &lt;имя&gt;/); assert.match(html, /Казахстан/);
  assert.match(html, /Создать при отсутствии: разрешено инициатором/);
  assert.match(html, /Чек-лист со слов инициатора/); assert.match(html, /Проверен/);
  assert.match(html, /не подтверждает завершение рекогносцировки/);
  assert.match(html, /Старший объекта<\/dt><dd[^>]*>Нужно уточнить/);
  assert.match(html, /Уточните старшего Ritz\./);
  assert.match(html, /Ожидают выполнения/); assert.match(html, /Ritz &lt;зал&gt;: Подтвердить рекогносцировку в карточке ОМ/);
  assert.match(html, /Требуется действие старшего объекта\./);
  assert.doesNotMatch(html, /private-person-id|private-object-id/);
  assert.doesNotMatch(html, /href="#assistant-correction"|Создать ОМ от своего имени/);
  assert.equal(f.state.writes.length, 0);
});

test('legacy one-object plans keep their object metadata without an empty briefing section', t => {
  const html = renderWorkspace(fixture(t), task());
  const metadata = html.match(/<dl[^>]*aria-label="Сведения поручения"[\s\S]*?<\/dl>/)?.[0];
  assert.match(metadata, /Объект<\/dt><dd[^>]*>Объект/);
  assert.doesNotMatch(html, /aria-label="Объекты и охраняемые лица поручения"/);
});

test('a bulletin creator can open the assistant under their existing bulletin permission', t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['event.bulletin'], global_permissions: ['event.bulletin'], roles: [] });
  assert.equal(f.api.useAssistantAccess().allowed, true);
  assert.equal(f.state.writes.length, 0);
});

test('briefing shows declared checklist results and translates pending domain action codes for review', t => {
  const f = fixture(t);
  const html = renderWorkspace(f, task({ canEdit: false, canContinue: false, plan: {
    briefing: { objects: [{ name: 'Аккорда', objectId: '10', sectors: [], needStatus: 'unknown', checklistChecked: true,
      checklistResults: [{ id: 'checklist-0', state: 'NORMAL', comment: '' },
        { id: 'checklist-1', state: 'REMARK', comment: 'Ограждение <повреждено>' },
        { id: 'checklist-2', state: 'UNCHECKED', comment: '' }] }], protectedPersons: [] },
    briefingPending: [{ objectId: '10', action: 'visit_object_add', reason: 'Требуется руководитель.' },
      { objectId: '10', action: 'visit_object_chief', reason: 'Требуется старший.' },
      { objectId: '10', action: 'recon', reason: 'Нужно сохранить осмотр.' },
      { objectId: '10', action: 'checklist', reason: 'Нужны результаты.' }] } }), true);
  assert.match(html, /Результаты чек-листа со слов инициатора/);
  assert.match(html, /Подъездные пути и парковка: Норма/);
  assert.match(html, /Периметр и ограждение: Замечание/);
  assert.match(html, /Ограждение &lt;повреждено&gt;/);
  assert.match(html, /Входные группы и КПП: Не проверено/);
  for (const text of ['Добавить объект в ОМ', 'Назначить старшего объекта', 'Сохранить расчёт и результаты осмотра', 'Уточнить результаты чек-листа']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /visit_object_add|visit_object_chief|>recon<|>checklist</);
  assert.equal(f.state.writes.length, 0);
});

test('the clarification next step names only unresolved fields and links the initiator to the retained editor', t => {
  const f = fixture(t);
  const value = task({ status: 'needs_information', event: null, gathering: null, canContinue: false,
    message: 'Наряд на Аккорду 23 октября, 200 человек',
    plan: { title: null, kind: null, businessDate: '2026-10-23', objectId: '30', objectName: 'Аккорда', personnelTotal: 200 },
    questions: [{ field: 'title', text: 'Укажите название.' }, { field: 'kind', text: 'Укажите вид ОМ.' }] });
  const html = renderWorkspace(f, value);
  assert.match(html, /Уточните название и вид ОМ/);
  assert.match(html, /href="#assistant-correction"/);
  assert.match(html, /id="assistant-correction"/);
  const context = html.match(/<dl[^>]*aria-label="Сведения поручения"[\s\S]*?<\/dl>/)?.[0];
  assert.ok(context, 'recognized context must be available together before clarification');
  assert.match(context, /23\.10\.2026/); assert.match(context, /Аккорда/); assert.match(context, /200/);
  assert.match(html, /<details[^>]*><summary[^>]*>Исходное поручение<\/summary>/);
  assert.match(html, /Наряд на Аккорду 23 октября, 200 человек/);
  assert.equal(f.state.writes.length, 0);
});

test('a readonly recipient sees the next actor without a correction link or an instruction to edit', t => {
  const f = fixture(t);
  const value = task({ status: 'needs_information', canEdit: false, canContinue: false,
    questions: [{ field: 'allocations', text: 'Укажите количества.' }] });
  const next = f.model.taskNextAction(value);
  assert.equal(next.canCorrect, false);
  assert.match(next.title, /Инициатор уточняет/);
  const html = renderWorkspace(f, value, true);
  assert.doesNotMatch(html, /href="#assistant-correction"/);
  assert.equal(f.state.writes.length, 0);
});

test('an explicit clarification overrides a suggested value and sent requests never offer corrections', t => {
  const f = fixture(t);
  const value = task({ questions: [{ field: 'businessDate', text: 'Проверьте дату.' }, { field: 'allocations[0].need', text: 'Уточните количество.' }] });
  assert.match(f.model.taskNextAction(value).title, /дату.*количества по департаментам/);
  assert.equal(f.model.taskNextAction(value).owner, 'Инициатор поручения');
  assert.equal(f.model.taskNextAction({ ...value, receipts: [{ operation: 'send_allocations', result: {} }] }).canCorrect, false);
});

for (const [canEdit, sent] of [[true, false], [false, false], [true, true], [false, true]]) {
  test(`an interpretation notice gives an available next step for editable=${canEdit}, sent=${sent}`, t => {
    const f = fixture(t);
    const notice = 'Provider detail <untrusted> & configuration';
    const value = task({ canEdit, interpretationNotice: notice,
      receipts: sent ? [{ operation: 'send_allocations', executedBy: 'staff', createdAt: '2026-10-22', result: {} }] : [] });
    const html = renderWorkspace(f, value);
    assert.match(html, /Поручение сохранено, но автоматический разбор текста не завершён/);
    assert.match(html, /<details[^>]*><summary[^>]*>Подробности разбора<\/summary>/);
    assert.match(html, /Provider detail &lt;untrusted&gt; &amp; configuration/);
    assert.doesNotMatch(html, /Уточните сведения явно ниже/);
    if (sent) {
      assert.match(html, /Текущее состояние и результаты действий показаны в карточке ниже/);
      assert.doesNotMatch(html, /заполните недостающие сведения в форме/);
      assert.doesNotMatch(html, /Сохранить сведения и продолжить/);
    } else if (canEdit) {
      assert.match(html, /Проверьте распознанные значения и заполните недостающие сведения в форме/);
      assert.match(html, /Сохранить сведения и продолжить/);
    } else {
      assert.match(html, /Сведения уточняет инициатор поручения/);
      assert.doesNotMatch(html, /заполните недостающие сведения в форме/);
      assert.doesNotMatch(html, /Сохранить сведения и продолжить/);
    }
    assert.equal(f.state.writes.length, 0);
  });
}

test('a task without an interpretation notice has no extra warning or technical disclosure', t => {
  const f = fixture(t);const html = renderWorkspace(f, task());
  assert.doesNotMatch(html, /Подробности разбора|автоматический разбор текста не завершён/);
  assert.equal(f.state.writes.length, 0);
});

test('foreign visitor tasks use the shared event-kind label in the card and editor without changing the API code', t => {
  const f = fixture(t);
  const value = task({ status: 'needs_information', event: null,
    plan: { ...task().plan, eventId: null, kind: 'FOREIGN' }, questions: [{ field: 'title', text: 'Уточните название' }] });
  const expected = f.load('@/entities/security-event/model/types').SECURITY_EVENT_KIND_LABEL.FOREIGN;
  const html = renderWorkspace(f, value);
  assert.match(html, new RegExp(`<option value="FOREIGN" selected="">${expected}</option>`));
  assert.ok(html.includes(expected));
  assert.doesNotMatch(html, /Зарубежное/);
  assert.equal(f.model.fieldsFromDraft(f.model.draftFromPlan(value.plan)).kind, 'FOREIGN');
});

function fixture(t, browserCrypto = require('node:crypto').webcrypto) {
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => client.clear());
  client.setQueryData(['ops-me'], { permissions: ['event.create'], global_permissions: ['event.create'], roles: [] });
  const state = { actor: 'chief', permissionError: null, reads: [], writes: [], response: task(), saved: [], options: [] };
  const modules = new Map();
  const overrides = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@tanstack/react-query': { ...query, useQueryClient: () => client, useQuery: options => {
      state.options.push(options); return new query.QueryObserver(client, options).getOptimisticResult(options);
    } },
    'next-auth/react': { useSession: () => ({ data: { user: { id: state.actor } } }) },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => {
      const snapshot = client.getQueryState(['ops-me']);
      return { isLoading: snapshot.status === 'pending', error: state.permissionError ?? snapshot.error,
        hasPermission: code => snapshot.status === 'success' && !state.permissionError &&
          (snapshot.data.permissions.includes('*') || snapshot.data.permissions.includes(code)) };
    } },
    '@/lib/ops-api': { opsApiClient: {
      get: async (url, authorize) => { authorize?.(); state.reads.push(url); if (state.readError) throw state.readError; return state.response; },
      post: async (url, body, authorize) => { authorize?.(); state.writes.push({ url, body: structuredClone(body) });
        if (state.post) return state.post(); return state.response; },
    } },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useSearchParams: () => new URLSearchParams(state.search ?? ''), useRouter: () => ({ replace() {}, push() {} }) },
    '@/components/dashboard-layout': { DashboardLayout: ({ children }) => children },
    '@/components/ops-access-denied': { OpsAccessDenied: () => React.createElement('p', null, 'Нет доступа') },
    // Progress has its own contract suite; keep these editor/writer tests independent.
    '@/features/om-assistant/progress': { AssistantProgress: () => null },
    '@/components/ui/button': { Button: ({ children, asChild, variant, size, ...props }) =>
      asChild ? children : React.createElement('button', props, children) },
  };
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (modules.has(name)) return modules.get(name);
    const base = path.join(__dirname, '../..', name.slice(2));
    const file = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(fs.existsSync);
    assert.ok(file, `Missing implementation ${name}`);
    const exports = {}; modules.set(name, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, require: load, URLSearchParams, Date, structuredClone, crypto: browserCrypto });
    return exports;
  }
  const model = load('@/features/om-assistant/model');
  const api = load('@/features/om-assistant/api');
  let context = { access: api.useAssistantAccess(), taskId: null, readKey: undefined };
  const writer = api.createAssistantWriter({ client, getContext: () => context, onSaved: value => state.saved.push(value),
    onChange() {}, makeKey: (() => { let count = 0; return () => `request-${++count}`; })() });
  return { model, api, state, client, load, writer, override: (name, value) => { overrides[name] = value; }, context: () => context,
    update(patch = {}) { context = { ...context, access: api.useAssistantAccess(), ...patch }; },
    select(value = task()) { const access = api.useAssistantAccess(); const readKey = ['ops-assistant', 'task', access.scope, value.id];
      client.setQueryData(readKey, value); context = { access, taskId: value.id, readKey }; return readKey; } };
}

test('explicit manual values retain imported IDs and reject fractional/duplicate needs before any write', t => {
  const f = fixture(t);
  const draft = f.model.draftFromPlan({ ...task().plan, eventId: null });
  const fields = f.model.fieldsFromDraft(draft);
  assert.equal(fields.objectId, '9007199254740993');
  assert.equal(fields.allocations[0].departmentId, '9007199254740995');
  assert.equal(fields.allocations[0].need, 4);
  for (const need of ['1.5', '-2', '1e2', '0', '100001']) assert.throws(() => f.model.fieldsFromDraft({ ...draft, allocations: [{ departmentId: '2', need, dueAt: '' }] }));
  assert.throws(() => f.model.fieldsFromDraft({ ...draft, allocations: [draft.allocations[0], draft.allocations[0]] }));
  assert.throws(() => f.model.fieldsFromDraft({ ...draft, businessDate: '2026-02-30' }));
  assert.equal(f.state.writes.length, 0);
});

test('the human headcount survives correction with its date and object and clears without inventing department quotas', t => {
  const f = fixture(t);
  const plan = { personnelTotal: 200, businessDate: '2026-10-23', objectId: '9007199254740993', allocations: [] };
  const before = JSON.stringify(plan);
  const draft = f.model.draftFromPlan(plan);
  assert.equal(draft.personnelTotal, '200');
  assert.equal(draft.businessDate, '2026-10-23');
  assert.equal(draft.objectId, '9007199254740993');
  const fields = f.model.fieldsFromDraft(draft);
  assert.equal(fields.personnelTotal, 200);
  assert.equal(fields.businessDate, '2026-10-23');
  assert.equal(fields.objectId, '9007199254740993');
  assert.equal(fields.allocations.length, 0);
  assert.equal(f.model.fieldsFromDraft({ ...draft, personnelTotal: '' }).personnelTotal, null);
  assert.equal(f.model.draftFromPlan({}).personnelTotal, '');
  assert.equal(f.model.draftFromPlan({ personnelTotal: null }).personnelTotal, '');
  assert.equal(JSON.stringify(plan), before);
  assert.equal(f.state.writes.length, 0);
});

test('the human headcount rejects noninteger and out-of-range values before any write', t => {
  const f = fixture(t); const draft = f.model.draftFromPlan();
  for (const [value, expected] of [['1', 1], ['200', 200], ['100000', 100000]]) {
    assert.equal(f.model.fieldsFromDraft({ ...draft, personnelTotal: value }).personnelTotal, expected);
  }
  for (const value of [true, false, 1.5, '1.5', '0', '-1', '100001', '1e2', 'NaN', 'Infinity']) {
    assert.throws(() => f.model.fieldsFromDraft({ ...draft, personnelTotal: value }), /целое количество от 1 до 100000/);
  }
  assert.equal(f.state.writes.length, 0);
});

test('assistant dates remain calendar dates in readable form and never normalize impossible values', t => {
  const { assistantDate } = fixture(t).model;
  assert.equal(typeof assistantDate, 'function', 'saved dates need one timezone-independent display formatter');
  for (const [value, expected] of [['2026-10-23', '23.10.2026'], ['2028-02-29', '29.02.2028'],
    ['2026-02-30', 'Нужно уточнить'], ['', 'Нужно уточнить'], [null, 'Нужно уточнить']]) {
    assert.equal(assistantDate(value), expected);
  }
});

test('clarification exposes only unanswered basics and keeps recognized values editable behind a closed disclosure', t => {
  const html = renderWorkspace(fixture(t), task({ status: 'needs_information', event: null,
    plan: { title: '', kind: null, businessDate: '2026-10-23', objectId: '30', objectName: 'Аккорда', personnelTotal: 200, intent: 'prepare', allocations: [] },
    questions: [{ field: 'title', text: 'Укажите название.' }, { field: 'kind', text: 'Укажите вид ОМ.' }] }));
  const extras = html.match(/<details[^>]*><summary[^>]*>Дополнительные сведения<\/summary>[\s\S]*?<\/details>/)?.[0];
  const requests = html.match(/<details[^>]*><summary[^>]*>Запросы по департаментам<\/summary>[\s\S]*?<\/details>/)?.[0];
  const recognized = html.match(/<details[^>]*><summary[^>]*>Изменить распознанные сведения<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(extras, 'event ID and optional date/time must have their own disclosure');
  assert.ok(requests, 'request quotas must not dominate basic clarification');
  assert.ok(recognized, 'known values need an explicit correction affordance');
  assert.doesNotMatch(recognized.slice(0, recognized.indexOf('>') + 1), /open=/);
  assert.doesNotMatch(extras.slice(0, extras.indexOf('>') + 1), /open=/);
  assert.doesNotMatch(requests.slice(0, requests.indexOf('>') + 1), /open=/);
  assert.match(extras, /Существующее ОМ, ID/);
  const primary = html.slice(html.indexOf('<fieldset'), html.indexOf(recognized));
  assert.ok(primary.indexOf('Название<input') < primary.indexOf('Вид ОМ<select'));
  assert.doesNotMatch(primary, /Дата начала<input|Объект<select|Людей по поручению<input|Существующее ОМ, ID|Дата окончания|Срок ответа/);
  assert.match(recognized, /Дата начала<input[^>]*value="2026-10-23"/);
  assert.match(recognized, /Объект<select/);
  assert.match(recognized, /Людей по поручению<input[^>]*value="200"/);
  assert.equal(html.split('Укажите название.').length - 1, 1, 'the same clarification must not be repeated in a second panel');
  assert.equal(html.split('Укажите вид ОМ.').length - 1, 1);
  assert.doesNotMatch(html, /aria-label="Нужны сведения"/);
});

test('explicit date, object and headcount questions stay in the primary editor even when suggestions exist', t => {
  const html = renderWorkspace(fixture(t), task({ status: 'needs_information', event: null,
    plan: { title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-23', objectId: '30', personnelTotal: 200 },
    questions: [{ field: 'businessDate', text: 'Уточните дату.' }, { field: 'objectId', text: 'Уточните объект.' },
      { field: 'personnelTotal', text: 'Уточните число людей или очистите поле.' }] }));
  const primary = html.slice(html.indexOf('<fieldset'), html.indexOf('Изменить распознанные сведения'));
  assert.match(primary, /Дата начала<input[^>]*value="2026-10-23"/);
  assert.match(primary, /Объект<select/);
  assert.match(primary, /Людей по поручению<input[^>]*value="200"/);
  assert.doesNotMatch(primary, /Название<input|Вид ОМ<select/);
  for (const text of ['Уточните дату.', 'Уточните объект.', 'Уточните число людей или очистите поле.']) {
    assert.equal(html.split(text).length - 1, 1);
  }
});

test('a server clarification without an editable control stays visible once for the initiator', t => {
  for (const patch of [{ event: null, questions: [{ field: 'review', text: 'Проверьте сведения перед продолжением.' }] },
    { questions: [{ field: 'objectId', text: 'Объект нужно проверить в карточке ОМ.' }] }]) {
    const html = renderWorkspace(fixture(t), task({ status: 'needs_information', ...patch }));
    const text = patch.questions[0].text;
    assert.equal(html.split(text).length - 1, 1, 'unhandled server guidance must remain visible without a duplicate panel');
    assert.doesNotMatch(html, /aria-label="Нужны сведения"/);
  }
});

test('saving clarification preserves hidden recognized values, optional metadata and department deadlines in the revision patch', async t => {
  const f = fixture(t); let correction;
  f.override('@/components/ui/button', { Button: ({ children, asChild, variant, size, ...props }) => {
    if (children === 'Сохранить сведения и продолжить') correction = props.onClick;
    return asChild ? children : React.createElement('button', props, children);
  } });
  const value = task({ status: 'needs_information', event: null, revision: 7,
    questions: [{ field: 'kind', text: 'Уточните вид мероприятия.' }],
    plan: { title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-23', businessDateEnd: '2026-10-24', eventTime: '10:30',
      objectId: '9007199254740993', personnelTotal: 200, intent: 'prepare',
      allocations: [{ departmentId: '9007199254740995', need: 40, dueAt: '2026-10-22T12:00:00Z' }] } });
  const before = JSON.stringify(value);
  renderWorkspace(f, value);
  correction(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].body, { revision: 7, fields: { title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-23',
    businessDateEnd: '2026-10-24', eventTime: '10:30', objectId: '9007199254740993', personnelTotal: 200, intent: 'prepare',
    allocations: [{ departmentId: '9007199254740995', need: 40, dueAt: '2026-10-22T17:00:00+05:00' }] } });
  assert.equal(JSON.stringify(value), before);
});

test('request editing opens for existing quotas, sending intent or an explicit quota question', t => {
  for (const patch of [{ allocations: [{ departmentId: '2', need: 4 }] }, { intent: 'send' }, { question: true }]) {
    const f = fixture(t);
    const html = renderWorkspace(f, task({ event: null, status: 'needs_information',
      plan: { intent: patch.intent ?? 'prepare', allocations: patch.allocations ?? [] },
      questions: patch.question ? [{ field: 'allocations', text: 'Укажите департаменты.' }] : [] }));
    assert.match(html, /<details[^>]*open=""[^>]*><summary[^>]*>Запросы по департаментам/);
    assert.equal(f.state.writes.length, 0);
  }
});

test('preparation details collapse without hiding the next owner, recon blocker or event action', t => {
  const f = fixture(t), { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task({ status: 'awaiting_recon', gathering: null }), canViewEvent: true, canCommand: false }));
  const progress = html.match(/<details[^>]*><summary[^>]*>Ход подготовки<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(progress, 'five stages and derived metrics belong behind a disclosure');
  assert.doesNotMatch(progress.slice(0, progress.indexOf('>') + 1), /open=/);
  assert.match(progress, /aria-label="Подготовка наряда"/);
  assert.match(progress, /Потребность ОМ/);
  const visible = html.replace(progress, '');
  assert.match(visible, /Назначенные старшие объектов/);
  assert.match(visible, /завершить осмотр и опубликовать потребность/);
  assert.match(visible, /href="\/security-ops\/events\/70\/"/);
  assert.match(visible, /25\.10\.2026/);
});

test('generic unfinished queue entries show the object and readable event date without exposing IDs as labels', t => {
  const f = fixture(t), { AssistantTaskQueue } = f.load('@/features/om-assistant/workspace');
  const value = task({ event: null, plan: { title: 'Уточнение поручения', objectName: 'Аккорда', businessDate: '2026-10-23' } });
  const html = renderToStaticMarkup(React.createElement(AssistantTaskQueue, { data: { results: [value], isHeadquarters: false }, selectedTaskId: value.id,
    search: '', isPending: false, isFetching: false, isError: false, refresh() {}, navigate() {} }));
  const link = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(link, /Аккорда/);
  assert.match(link, /23\.10\.2026/);
  assert.doesNotMatch(link.replace(/<a[^>]*>/, ''), new RegExp(taskId));
  assert.doesNotMatch(link, />Уточнение поручения<\/span>/);
});

test('task card separates the requested total from published demand, sent requests and gathered people; legacy total stays unknown', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ plan: { ...task().plan, personnelTotal: 200 }, event: { ...task().event, requested: 4, rosterCount: 2 } });
  const before = JSON.stringify(value);
  const render = current => renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: current, canViewEvent: true, canCommand: false }));
  const html = render(value);
  assert.match(html, /Людей по поручению<\/dt><dd[^>]*>200<\/dd>/);
  assert.match(html, /Потребность ОМ<\/dt><dd[^>]*>10<\/dd>/);
  assert.match(html, /Запрошено<\/dt><dd[^>]*>4<\/dd>/);
  assert.match(html, /В составе сбора<\/dt><dd[^>]*>2<\/dd>/);
  for (const personnelTotal of [undefined, null]) {
    assert.match(render({ ...value, plan: { ...value.plan, personnelTotal } }), /Людей по поручению<\/dt><dd[^>]*>Не указано<\/dd>/);
  }
  assert.equal(JSON.stringify(value), before);
  assert.equal(f.state.reads.length + f.state.writes.length, 0);
});

test('a linked-event correction saves the headcount as proposal metadata and stays closed after dispatch', async t => {
  const f = fixture(t); let correction;
  f.override('@/components/ui/button', { Button: ({ children, asChild, variant, size, ...props }) => {
    if (children === 'Сохранить сведения и продолжить') correction = props.onClick;
    return asChild ? children : React.createElement('button', props, children);
  } });
  const value = task({ plan: { ...task().plan, personnelTotal: 200 } });
  const html = renderWorkspace(f, value);
  assert.match(html, /Людей по поручению<input[^>]*value="200"/);
  assert.equal(typeof correction, 'function');
  correction(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].body, { fields: { intent: 'send', personnelTotal: 200,
    allocations: [{ departmentId: '9007199254740995', need: 4 }] }, revision: 2 });
  const after = fixture(t);
  const sent = renderWorkspace(after, { ...value, receipts: [{ operation: 'send_allocations', executedBy: 'staff', createdAt: '2026-10-22T10:00:00Z', result: {} }] });
  assert.doesNotMatch(sent, /Людей по поручению<input|Сохранить сведения и продолжить/);
  assert.match(sent, /Людей по поручению<\/dt><dd[^>]*>200<\/dd>/);
});

test('NLP with selected event does not replace the extracted intent with a prepare default', async t => {
  const f = fixture(t);
  await f.writer.create('Запроси 4 человека', { eventId: '70' }, true);
  assert.deepEqual(f.state.writes[0].body, { requestKey: 'request-1', message: 'Запроси 4 человека', fields: { eventId: '70' }, interpret: true });
});

test('HTTP LAN creation without randomUUID sends a task and preserves its key on retry', async t => {
  const f = fixture(t, { getRandomValues: bytes => require('node:crypto').webcrypto.getRandomValues(bytes) });
  const writer = f.api.createAssistantWriter({ client: f.client, getContext: f.context,
    onSaved: value => f.state.saved.push(value), onChange() {} });
  f.state.post = () => { throw Error('response lost'); };
  await writer.create('Наряд на Аккорду на 23 октября, 200 человек');
  assert.equal(f.state.writes.length, 1);
  const first = f.state.writes[0].body;
  assert.match(first.requestKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(writer.snapshot().retryable, true);
  f.state.post = null;
  await writer.retry();
  assert.deepEqual(f.state.writes[1].body, first);
  assert.equal(f.state.saved.length, 1);
  await writer.create('Следующее поручение');
  assert.notEqual(f.state.writes[2].body.requestKey, first.requestKey);
});

test('request preparation failure is visible and leaves no pending write or rejected promise', async t => {
  const f = fixture(t, {});
  const writer = f.api.createAssistantWriter({ client: f.client, getContext: f.context,
    onSaved: value => f.state.saved.push(value), onChange() {} });
  await writer.create('Подготовь наряд');
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.saved.length, 0);
  assert.equal(writer.snapshot().pending, false);
  assert.equal(writer.snapshot().retryable, false);
  assert.ok(writer.snapshot().error);
});

test('clearing an optional model suggestion sends null explicitly rather than restoring the old date/time', t => {
  const f = fixture(t);
  const draft = f.model.draftFromPlan({ title: 'Встреча', businessDate: '2026-10-25', businessDateEnd: '2026-10-26', eventTime: '10:00', kind: 'INTERNAL', objectId: '30' });
  const fields = f.model.fieldsFromDraft({ ...draft, businessDateEnd: '', eventTime: '' });
  assert.equal(fields.businessDateEnd, null);
  assert.equal(fields.eventTime, null);
});

test('a cleared manual object is an explicit null when completing an unbound draft', t => {
  const f = fixture(t);
  const draft = f.model.draftFromPlan({ title: 'Встреча', businessDate: '2027-06-01', objectId: '30' });
  const fields = f.model.fieldsFromDraft({ ...draft, objectId: '', kind: 'INTERNAL' });
  assert.ok(Object.hasOwn(fields, 'objectId'), 'clearing the select must not become an omitted patch');
  assert.equal(fields.objectId, null);
  assert.equal(fields.kind, 'INTERNAL');
});

test('text interpretation does not receive a manual blank-object override', async t => {
  const f = fixture(t);
  await f.writer.create('Подготовь встречу на объекте Аккорда', {}, true);
  assert.deepEqual(f.state.writes[0].body.fields, {});
  assert.equal(f.state.writes[0].body.interpret, true);
});

test('deadline round-trip uses Astana civil time while the browser is in America/Los_Angeles', t => {
  const previous = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try {
    const f = fixture(t);
    const draft = f.model.draftFromPlan({ allocations: [{ departmentId: '2', need: 4, dueAt: '2026-10-25T12:00:00Z' }] });
    assert.equal(draft.allocations[0].dueAt, '2026-10-25T17:00:00');
    const fields = f.model.fieldsFromDraft(draft);
    assert.equal(fields.allocations[0].dueAt, '2026-10-25T17:00:00+05:00');
    assert.equal(Date.parse(fields.allocations[0].dueAt), Date.parse('2026-10-25T12:00:00Z'));
    const edited = f.model.fieldsFromDraft({ ...draft, allocations: [{ ...draft.allocations[0], dueAt: '2026-10-25T18:30' }] });
    assert.equal(edited.allocations[0].dueAt, '2026-10-25T18:30:00+05:00');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('saved business results invalidate every existing event/request/gathering/notification view', async t => {
  const f = fixture(t);
  const keys = [['ops-security-events', 'detail', '70'], ['ops-force-collections'], ['ops-force-collection', '70'],
    ['ops-department-requests'], ['ops-department-request', '80'], ['notifications', 'unread'],
    ['ops-ratings', 'notifications'], ['ops-notifications', 'feed']];
  for (const key of keys) f.client.setQueryData(key, { old: true });
  await f.writer.create('Поручение', {}, true);
  for (const key of keys) assert.equal(f.client.getQueryState(key).isInvalidated, true, JSON.stringify(key));
});

test('network retry preserves the exact creation body/key; explicit new task starts another key', async t => {
  const f = fixture(t);
  f.state.post = () => { throw Error('lost response'); };
  await f.writer.create('Исходное поручение', { eventId: '70' }, true);
  assert.equal(f.writer.snapshot().retryable, true);
  f.state.post = null;
  await f.writer.retry();
  assert.deepEqual(f.state.writes[1].body, f.state.writes[0].body);
  assert.equal(f.state.saved.length, 1);
  f.writer.reset();
  await f.writer.create('Новое поручение', {}, true);
  assert.equal(f.state.writes[2].body.requestKey, 'request-2');
});

for (const change of ['actor', 'rights', 'new-task', 'route', 'unmount']) test(`late ${change} creation result cannot restore data or select an old task`, async t => {
  const f = fixture(t); let release;
  f.state.post = () => new Promise(resolve => { release = resolve; });
  const pending = f.writer.create('Поручение', {}, true);
  if (change === 'actor') { f.state.actor = 'other'; f.update(); }
  if (change === 'rights') { f.client.setQueryData(['ops-me'], { permissions: [], global_permissions: [], roles: [] }); f.update(); }
  if (change === 'new-task') f.writer.reset();
  if (change === 'unmount') f.writer.dispose();
  if (change === 'route') f.update({ taskId });
  release(task()); await pending;
  assert.equal(f.state.saved.length, 0);
  assert.equal(f.client.getQueryCache().findAll({ predicate: item => item.queryKey[0] === 'ops-assistant' && item.state.data !== undefined }).length, 0);
});

test('staff continues delegated task as self without editing or freezing an old revision', async t => {
  const f = fixture(t); f.state.actor = 'staff';
  f.client.setQueryData(['ops-me'], { permissions: ['forces.command'], global_permissions: ['forces.command'], roles: [] });
  f.select(task({ canEdit: false }));
  await f.writer.continueTask({ allocations: [{ departmentId: '2', need: 7 }] });
  assert.equal(f.state.writes.length, 0);
  await f.writer.continueTask();
  assert.deepEqual(f.state.writes[0].body, {});
  assert.match(f.state.writes[0].url, /\/2733240a-32a0-46cd-9ad9-5127665c29e8\/continue\/$/);
});

test('initiator explicitly corrects missing questions with the current revision and without interpretation', async t => {
  const f = fixture(t); f.select(task({ status: 'needs_information' }));
  await f.writer.continueTask({ allocations: [{ departmentId: '2', need: 7 }] });
  assert.deepEqual(f.state.writes[0].body, { revision: 2, fields: { allocations: [{ departmentId: '2', need: 7 }] } });
});

test('correction sends its displayed base revision even when the read cache has advanced', async t => {
  const f = fixture(t); f.select(task({ revision: 9 }));
  await f.writer.continueTask({ title: 'Local draft based on revision 7' }, 7);
  assert.deepEqual(f.state.writes[0].body, { revision: 7, fields: { title: 'Local draft based on revision 7' } });
});

test('lost continuation response replays its exact patch/revision rather than sending another edit', async t => {
  const f = fixture(t); f.select();
  f.state.post = () => { throw Error('response lost after commit'); };
  await f.writer.continueTask({ allocations: [{ departmentId: '2', need: 7 }] });
  f.state.post = null; await f.writer.retry();
  assert.deepEqual(f.state.writes[1], f.state.writes[0]);
  assert.equal(f.state.saved.length, 1);
});

test('server canContinue=false blocks a fresh cached task regardless of the displayed status', async t => {
  const f = fixture(t); f.select(task({ canContinue: false }));
  await f.writer.continueTask();
  assert.equal(f.state.writes.length, 0);
});

test('a detail denial arriving during continuation cannot be replaced by the late success', async t => {
  const f = fixture(t); const key = f.select(); let release;
  f.state.post = () => new Promise(resolve => { release = resolve; });
  const pending = f.writer.continueTask();
  f.api.useAssistantTask(taskId); const options = f.state.options.at(-1);
  f.state.readError = Object.assign(Error('denied'), { status: 403 });
  await assert.rejects(f.client.fetchQuery(options));
  release(task()); await pending;
  assert.equal(f.state.saved.length, 0);
  assert.equal(f.client.getQueryData(key), undefined);
});

test('read denial and permission outage block cached actions and conceal task metadata', async t => {
  const f = fixture(t); f.select();
  f.api.useAssistantTask(taskId); const options = f.state.options.at(-1);
  f.state.readError = Object.assign(Error('denied'), { status: 403 });
  await assert.rejects(f.client.fetchQuery(options));
  assert.equal(f.api.useAssistantTask(taskId).data, undefined);
  await f.writer.continueTask(); assert.equal(f.state.writes.length, 0);
  f.state.permissionError = Error('permissions unavailable');
  assert.equal(f.api.useAssistantTasks().data, undefined);
  assert.equal(f.state.options.at(-1).enabled, false);
});

test('invalid task identifiers never trigger detail reads', t => {
  const f = fixture(t);
  f.api.useAssistantTask('../private');
  assert.equal(f.state.options.at(-1).enabled, false);
  assert.equal(f.state.reads.length, 0);
});

test('chief sees real next owner and proposal rather than fabricated delivery/assignment', t => {
  const f = fixture(t);
  const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task(), canViewEvent: true, canCommand: false }));
  assert.match(html, /Ожидается штаб/);
  assert.match(html, /Штаб второго департамента/);
  assert.match(html, /Запросы ещё не отправлены/);
  assert.match(html, /Сведения об ОМ/); assert.match(html, /Рекогносцировка/); assert.match(html, /Расстановка/);
  assert.match(html, /href="\/security-ops\/events\/70\/"/);
  assert.doesNotMatch(html, /href="\/employees/);
  assert.doesNotMatch(html, /Люди назначены|Все подписи получены/);
});

test('legacy create receipt reports the saved event for RECON and BULLETIN without inventing document execution', t => {
  for (const [stage, stageLabel] of [['RECON', 'Рекогносцировка'], ['BULLETIN', 'Бюллетень']]) {
    const f = fixture(t);
    f.client.setQueryData(['ops-me'], { permissions: ['event.create', 'event.view'], global_permissions: ['event.create', 'event.view'], roles: [] });
    const value = task({ status: 'awaiting_recon', canContinue: false,
      event: { ...task().event, id: '9007199254740993', code: 'ОМ-2027-17', stage },
      receipts: [{ operation: 'create_bulletin', executedBy: 'legacy-chief', createdAt: '2026-10-22T02:00:00Z',
        result: { eventId: '9007199254740993', code: 'ОМ-2027-17' } }] });
    const before = JSON.stringify(value);
    const html = renderWorkspace(f, value);
    const actions = html.slice(html.indexOf('<details'));
    assert.match(html, /Помощник подготовит мероприятие и запросы/);
    assert.doesNotMatch(html, /Помощник подготовит бюллетень/);
    assert.match(actions, /Сохранённые действия и исполнители/);
    assert.match(actions, /Мероприятие сохранено: /);
    assert.doesNotMatch(actions, /Бюллетень сохранён|Сохранённые документы/);
    assert.match(html, new RegExp(`Текущий этап ОМ:[\\s\\S]*${stageLabel}`));
    assert.match(html, /ОМ-2027-17/);
    assert.match(html, /href="\/security-ops\/events\/9007199254740993\/"/);
    assert.match(actions, /legacy-chief, 2026-10-22T02:00:00Z/);
    assert.equal(value.receipts[0].operation, 'create_bulletin');
    assert.deepEqual(value.receipts[0].result, { eventId: '9007199254740993', code: 'ОМ-2027-17' });
    assert.equal(JSON.stringify(value), before);
    assert.equal(f.state.reads.length + f.state.writes.length, 0);
  }
});

test('staff gathering link targets the exact event; completed is preparation, not final signature', t => {
  const f = fixture(t);
  const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task({ status: 'completed' }), canViewEvent: false, canCommand: true }));
  assert.match(html, /href="\/employees\?view=forces&amp;tab=collections&amp;collection=70"/);
  assert.doesNotMatch(html, /href="\/security-ops\/events/);
  assert.match(html, /Подготовка выполнена/);
  assert.doesNotMatch(html, /Все подписи получены|Мероприятие завершено/);
});

for (const [status, stage, stageLabel] of [
  ['completed', 'APPROVAL', 'Согласование'],
  ['completed', 'ACKNOWLEDGEMENT', 'Ознакомление'],
  ['completed', 'CONDUCT', 'Проведение'],
  ['completed', 'CLOSED', 'Закрыто'],
  ['awaiting_approval', 'APPROVAL', 'Согласование'],
]) test(`${status} with linked ${stage} shows the actual stage in the main summary and placement as passed`, t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ status, canEdit: false, canContinue: false, gathering: null,
    event: { ...task().event, id: '63', stage, requested: 10, rosterCount: 10 },
    receipts: [{ operation: 'send_allocations', executedBy: 'staff', createdAt: '2026-10-21T15:31:27Z', result: { delivery: { known: false } } }] });
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, canViewEvent: true, canCommand: false }));
  const mainSummary = html.split('<details')[0];
  assert.match(mainSummary, new RegExp(`Текущий этап ОМ:[\\s\\S]*${stageLabel}`));
  const placement = html.match(/<li\b[^>]*><span[^>]*>[^<]*<\/span>Расстановка<\/li>/)?.[0];
  assert.ok(placement, 'the actual preparation list must contain its placement step');
  assert.doesNotMatch(placement, /aria-current|Текущий шаг/);
  assert.match(placement, /Подтверждено/);
  assert.equal(f.model.taskSteps(value).at(-1).state, 'done');
  assert.match(html, status === 'completed' ? /Подготовка выполнена/ : /Ожидается согласование/);
  assert.match(html, status === 'completed' ? /Участники текущего этапа ОМ/ : /Согласующие по маршруту ОМ/);
  assert.match(html, /href="\/security-ops\/events\/63\/"/);
  assert.match(html, /Запрошено<\/dt><dd[^>]*>10<\/dd>/);
  assert.match(html, /В составе сбора<\/dt><dd[^>]*>10<\/dd>/);
  assert.match(html, /Доставка уведомлений не подтверждена/);
  assert.doesNotMatch(html, /Все подписи получены|Мероприятие завершено|href="\/employees/);
  assert.equal(f.state.reads.length + f.state.writes.length, 0);
});

test('actual linked PLACEMENT remains the current placement step with its stage visible', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ status: 'placement', event: { ...task().event, stage: 'PLACEMENT' } });
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, canViewEvent: true, canCommand: false }));
  assert.match(html.split('<details')[0], /Текущий этап ОМ:[\s\S]*Расстановка/);
  assert.match(html, /<li[^>]*aria-current="step"[^>]*><span[^>]*>Текущий шаг<\/span>Расстановка<\/li>/);
  assert.equal(f.model.taskSteps(value).at(-1).state, 'current');
});

for (const stage of [null, undefined, 'FUTURE_STAGE']) test(`missing or unknown linked stage ${stage} cannot infer placement from preparation status`, t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  for (const status of ['completed', 'awaiting_approval', 'placement']) {
    const value = task({ status, event: { ...task().event, stage } });
    const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, canViewEvent: true, canCommand: false }));
    assert.equal(f.model.taskSteps(value).at(-1).state, 'waiting');
    const placement = html.match(/<li\b[^>]*><span[^>]*>[^<]*<\/span>Расстановка<\/li>/)?.[0];
    assert.ok(placement); assert.doesNotMatch(placement, /aria-current|Подтверждено|Текущий шаг/);
    assert.match(html.split('<details')[0], /Этап ОМ не определён.*[Пп]роверьте карточку ОМ/);
    assert.doesNotMatch(html, /FUTURE_STAGE|Все подписи получены|Мероприятие завершено/);
    assert.equal(f.state.reads.length + f.state.writes.length, 0);
  }
});

test('completed preparation at an earlier linked stage does not confirm placement', t => {
  const f = fixture(t); const value = task({ status: 'completed', event: { ...task().event, stage: 'RECON' } });
  assert.equal(f.model.taskSteps(value).at(-1).state, 'waiting');
});

for (const [stage, stageLabel] of [['DEMAND', 'Потребность'], ['FORCES', 'Запрос сил']]) test(`legacy linked ${stage} retains its canonical label without implying placement`, t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ status: 'completed', event: { ...task().event, stage } });
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, canViewEvent: true, canCommand: false }));
  assert.match(html.split('<details')[0], new RegExp(`Текущий этап ОМ:[\\s\\S]*${stageLabel}`));
  assert.doesNotMatch(html, /Этап ОМ не определён/);
  assert.equal(f.model.taskSteps(value).at(-1).state, 'waiting');
});

test('an unavailable linked event has no inferred stage summary, placement proof or event link', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ status: 'event_unavailable', event: null, canEdit: false, canContinue: false });
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, canViewEvent: true, canCommand: true }));
  assert.match(html, /ОМ недоступно/);
  assert.equal(f.model.taskSteps(value).at(-1).state, 'waiting');
  assert.doesNotMatch(html, /Текущий этап ОМ:|Этап ОМ не определён|href="\/security-ops\/events|href="\/employees|ОМ-70/);
  assert.match(html, /Запрошено<\/dt><dd[^>]*>Нет сведений<\/dd>/);
  assert.equal(f.state.reads.length + f.state.writes.length, 0);
});

test('receipt delivery uncertainty stays visible and does not turn into a success count', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task({ status: 'awaiting_department_responses',
    receipts: [{ operation: 'send_allocations', executedBy: 'staff', createdAt: '2026-10-21T10:00:00Z', result: { delivery: { known: false } } }] }),
    canViewEvent: true, canCommand: false }));
  assert.match(html, /Доставка уведомлений не подтверждена/);
  assert.doesNotMatch(html, /Уведомлено[^<]*0/);
});

test('an unavailable event shows unknown quantities, and saved department names survive catalog failure', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task({ status: 'event_unavailable', event: null,
    plan: { allocations: [{ departmentId: '2', departmentName: 'Название из сохранённого предложения', need: 4 }] } }), canViewEvent: true, canCommand: false }));
  assert.match(html, /Запрошено<\/dt><dd[^>]*>Нет сведений<\/dd>/);
  assert.match(html, /В составе сбора<\/dt><dd[^>]*>Нет сведений<\/dd>/);
  assert.match(html, /Название из сохранённого предложения/);
});

test('task pages have separate protected cache entries and retain the 26th unfinished task across return and refresh', async t => {
  const f = fixture(t);
  const newest = Array.from({ length: 25 }, (_, index) => task({ id: `new-${index}`, status: 'completed' }));
  f.state.response = { results: newest, isHeadquarters: true, page: 1, pageCount: 2, total: 26, nextPage: 2, previousPage: null };
  f.api.useAssistantTasks(1); const first = f.state.options.at(-1);
  await f.client.fetchQuery(first);
  f.state.response = { results: [task()], isHeadquarters: true, page: 2, pageCount: 2, total: 26, nextPage: null, previousPage: 1 };
  f.api.useAssistantTasks(2); const second = f.state.options.at(-1);
  assert.notDeepEqual(second.queryKey, first.queryKey);
  await f.client.fetchQuery(second);
  assert.equal(f.api.useAssistantTasks(2).data.results[0].id, taskId);
  assert.equal(f.api.useAssistantTasks(1).data.results.length, 25);
  await f.client.fetchQuery({ ...second, staleTime: 0 });
  assert.equal(f.api.useAssistantTasks(2).data.results[0].status, 'awaiting_executor');
  assert.ok(f.state.reads.includes('/api/ops/assistant/tasks/?page=1'));
  assert.ok(f.state.reads.includes('/api/ops/assistant/tasks/?page=2'));
  const oldKey = second.queryKey;
  f.state.actor = 'another-chief'; f.update();
  assert.equal(f.api.useAssistantTasks(2).data, undefined);
  assert.notDeepEqual(f.state.options.at(-1).queryKey, oldKey);
  assert.equal(f.state.writes.length, 0);
});

test('page and task links preserve selection, event context and queue position through route return', t => {
  const f = fixture(t);
  const original = new URLSearchParams(`task=${taskId}&event=70&filter=kept`);
  const next = f.model.assistantPageHref(original, 2);
  const params = new URLSearchParams(next.split('?')[1]);
  assert.equal(params.get('page'), '2'); assert.equal(params.get('task'), taskId); assert.equal(params.get('event'), '70');
  const selected = new URLSearchParams(f.model.assistantTaskHref(taskId, params).split('?')[1]);
  assert.equal(selected.get('page'), '2'); assert.equal(selected.get('event'), '70');
  const previous = new URLSearchParams(f.model.assistantPageHref(selected, 1).split('?')[1]);
  assert.equal(previous.get('task'), taskId); assert.equal(previous.get('event'), '70'); assert.equal(previous.get('filter'), 'kept');
  assert.equal(f.model.assistantListPage(previous.get('page')), 1);
  for (const value of ['0', '-1', '1.5', '1e2', '999999999999999999999999999', 'invalid']) assert.equal(f.model.assistantListPage(value), 1);
  assert.equal(f.model.assistantListPage(params.get('page')), 2);
  assert.equal(original.has('page'), false, 'route helpers do not mutate the current address');
});

test('a successful write invalidates all cached task list pages, including page 2 with the earlier unfinished task', async t => {
  const f = fixture(t); const scope = f.context().access.scope;
  const keys = [1, 2, 3].map(page => ['ops-assistant', 'tasks', scope, page]);
  for (const key of keys) f.client.setQueryData(key, { results: [task()], isHeadquarters: true });
  await f.writer.create('Новое поручение', {}, true);
  for (const key of keys) assert.equal(f.client.getQueryState(key).isInvalidated, true);
});

test('a page denial clears every cached page and does not expose an older task under stale authority', async t => {
  const f = fixture(t);
  f.state.response = { results: [task()], isHeadquarters: true };
  f.api.useAssistantTasks(1); const first = f.state.options.at(-1); await f.client.fetchQuery(first);
  f.api.useAssistantTasks(2); const second = f.state.options.at(-1); await f.client.fetchQuery(second);
  f.state.readError = Object.assign(Error('denied'), { status: 403 });
  await assert.rejects(f.client.fetchQuery(second));
  assert.equal(f.api.useAssistantTasks(1).data, undefined); assert.equal(f.api.useAssistantTasks(2).data, undefined);
  f.state.permissionError = Error('authority unavailable');
  assert.equal(f.api.useAssistantTasks(2).data, undefined); assert.equal(f.state.options.at(-1).enabled, false);
});

test('queue DOM exposes the 26th task and preserves its page/event link; old responses remain one page', t => {
  const f = fixture(t); const { AssistantTaskQueue } = f.load('@/features/om-assistant/workspace');
  const old = task({ event: { ...task().event, title: 'Раннее незавершённое поручение' } });
  const props = { data: { results: [old], isHeadquarters: true, page: 2, pageCount: 2, total: 26, nextPage: null, previousPage: 1 },
    selectedTaskId: taskId, search: new URLSearchParams(`page=2&task=${taskId}&event=70`), isPending: false, isFetching: false, isError: false,
    refresh() {}, navigate() {} };
  const html = renderToStaticMarkup(React.createElement(AssistantTaskQueue, props));
  assert.match(html, /Страница 2 из 2/); assert.match(html, /Всего поручений: 26/); assert.match(html, /Раннее незавершённое поручение/);
  assert.match(html, new RegExp(`href="/security-ops/assistant\\?page=2&amp;task=${taskId}&amp;event=70"`));
  const button = (markup, name) => markup.match(/<button[^>]*>/g).find(value => value.includes(`aria-label="${name}"`));
  assert.doesNotMatch(button(html, 'Предыдущая страница поручений'), /disabled/);
  assert.match(button(html, 'Следующая страница поручений'), /disabled/);
  const legacy = renderToStaticMarkup(React.createElement(AssistantTaskQueue, { ...props, data: { results: [old], isHeadquarters: false } }));
  assert.doesNotMatch(legacy, /aria-label="Страницы поручений"/); assert.match(legacy, /Всего поручений: 1/);
  for (const patch of [{ isFetching: true }]) {
    const blocked = renderToStaticMarkup(React.createElement(AssistantTaskQueue, { ...props, ...patch }));
    assert.match(button(blocked, 'Предыдущая страница поручений'), /disabled/);
    assert.match(button(blocked, 'Следующая страница поручений'), /disabled/);
  }
  for (const patch of [{ isPending: true }, { isError: true }]) {
    const unavailable = renderToStaticMarkup(React.createElement(AssistantTaskQueue, { ...props, ...patch }));
    assert.doesNotMatch(unavailable, /aria-label="Страницы поручений"/);
  }
});

function renderWorkspace(f, value, headquarters = false) {
  f.state.search = `task=${value.id}`;
  const source = { isPending: false, isFetching: false, isError: false, readAccessBlocked: false, canAct: true, refetch() {} };
  f.override('@/features/om-assistant/api', { ...f.api,
    useAssistantTask: () => ({ ...source, data: value, readKey: f.select(value) }),
    useAssistantTasks: () => ({ ...source, data: { results: [value], isHeadquarters: headquarters } }),
    useAssistantConfiguration: () => ({ ...source, data: { enabled: true, isHeadquarters: headquarters } }),
    useAssistantCatalogs: () => ({ ...source, data: { objects: [], departments: [] } }),
    useAssistantWriter: () => ({ ...f.writer.snapshot(), create: f.writer.create, continueTask: f.writer.continueTask, retry: f.writer.retry, reset: f.writer.reset }),
  });
  const { AssistantWorkspace } = f.load('@/features/om-assistant/workspace');
  return renderToStaticMarkup(React.createElement(AssistantWorkspace));
}

for (const status of ['awaiting_recon', 'awaiting_department_responses', 'collecting', 'awaiting_approval']) test(`${status} DOM offers refresh and domain links without a meaningless continuation write`, t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['event.create', 'event.view'], global_permissions: ['event.create', 'event.view'], roles: [] });
  const html = renderWorkspace(f, task({ status, canContinue: false, canEdit: false }));
  assert.doesNotMatch(html, /Продолжить поручение|Выполнить отправку от своего имени/);
  assert.match(html, /Обновить состояние/);
  assert.match(html, /Открыть карточку ОМ/);
  assert.equal(f.state.writes.length, 0);
});

test('chief waiting for staff has no continuation CTA; the eligible staff actor has its real send action', t => {
  const chief = fixture(t);
  const chiefHtml = renderWorkspace(chief, task({ canContinue: false }));
  assert.doesNotMatch(chiefHtml, /Продолжить поручение|Выполнить отправку от своего имени/);
  assert.match(chiefHtml, /Штаб второго департамента/);
  const staff = fixture(t); staff.state.actor = 'staff';
  staff.client.setQueryData(['ops-me'], { permissions: ['forces.command', 'event.view'], global_permissions: ['forces.command', 'event.view'], roles: [] });
  const staffHtml = renderWorkspace(staff, task({ canEdit: false, canContinue: true }), true);
  assert.match(staffHtml, /Выполнить отправку от своего имени/);
  assert.match(staffHtml, /Открыть сбор наряда/);
  assert.doesNotMatch(staffHtml, /Сохранить сведения и продолжить/);
});

test('manual prepare DOM keeps explicit corrections by canEdit while hiding the no-fields write', t => {
  const f = fixture(t);
  const html = renderWorkspace(f, task({ status: 'prepared', canContinue: false, canEdit: true, plan: { ...task().plan, intent: 'prepare' } }));
  assert.doesNotMatch(html, /Продолжить поручение|Выполнить отправку от своего имени/);
  assert.match(html, /Сохранить сведения и продолжить/);
  assert.match(html, /Обновить состояние/);
});

test('empty allocations clarification names the initiator and reserves correction for that actor', t => {
  const value = task({ status: 'needs_information', canContinue: false, canEdit: false,
    plan: { ...task().plan, allocations: [] },
    questions: [{ field: 'allocations', text: 'Укажите департаменты и количество людей для отправки запросов.' }] });
  const staff = fixture(t); staff.state.actor = 'staff';
  staff.client.setQueryData(['ops-me'], { permissions: ['forces.command', 'event.view'], global_permissions: ['forces.command', 'event.view'], roles: [] });
  const staffHtml = renderWorkspace(staff, value, true);
  assert.match(staffHtml, /Укажите департаменты и количество людей для отправки запросов/);
  assert.match(staffHtml, /Сведения уточняет инициатор поручения. Штаб продолжит работу после уточнения/);
  assert.doesNotMatch(staffHtml, /Выполнить отправку от своего имени|Сохранить сведения и продолжить|Добавить департамент/);
  assert.match(staffHtml, /Обновить состояние/);
  const chief = fixture(t);
  const chiefHtml = renderWorkspace(chief, { ...value, canEdit: true });
  assert.match(chiefHtml, /<details[^>]*open=""[^>]*><summary[^>]*>Уточнить сведения/);
  assert.match(chiefHtml, /Добавить департамент/);
  assert.match(chiefHtml, /Сохранить сведения и продолжить/);
  assert.doesNotMatch(chiefHtml, /Выполнить отправку от своего имени/);
  assert.equal(staff.state.writes.length + chief.state.writes.length, 0);
});

test('canContinue=false blocks only a no-fields operation and keeps an initiator correction by canEdit', async t => {
  const f = fixture(t); f.select(task({ status: 'needs_information', canContinue: false, canEdit: true }));
  await f.writer.continueTask(); assert.equal(f.state.writes.length, 0);
  await f.writer.continueTask({ allocations: [{ departmentId: '2', need: 7 }] });
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].body, { fields: { allocations: [{ departmentId: '2', need: 7 }] }, revision: 2 });
});

test('an editable unbound task can correct a mistyped event ID while no-fields execution stays blocked', async t => {
  const f = fixture(t);
  f.select(task({ event: null, status: 'event_unavailable', canEdit: true, canContinue: false,
    plan: { ...task().plan, eventId: '999999999' } }));
  await f.writer.continueTask();
  assert.equal(f.state.writes.length, 0);
  await f.writer.continueTask({ eventId: '70' });
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].body, { fields: { eventId: '70' }, revision: 2 });
});

test('an unreadable bound task with canEdit=false cannot be retargeted through fields', async t => {
  const f = fixture(t);
  f.select(task({ event: null, status: 'event_unavailable', canEdit: false, canContinue: false }));
  await f.writer.continueTask({ eventId: '71' });
  await f.writer.continueTask();
  assert.equal(f.state.writes.length, 0);
});

test('an absent canContinue flag cannot grant a no-fields write', async t => {
  const f = fixture(t); f.select(task({ canContinue: undefined }));
  await f.writer.continueTask(); assert.equal(f.state.writes.length, 0);
});

test('an uncertain write can replay its captured request after refresh reports no further continuation', async t => {
  const f = fixture(t); const key = f.select();
  f.state.post = () => { throw Error('response lost after commit'); };
  await f.writer.continueTask();
  f.client.setQueryData(key, task({ status: 'awaiting_department_responses', canContinue: false }));
  f.state.post = null; await f.writer.retry();
  assert.equal(f.state.writes.length, 2); assert.deepEqual(f.state.writes[1], f.state.writes[0]);
  assert.equal(f.state.saved.length, 1);
});

test('missing gathering names the headquarters prerequisite without a campaign link or ID for scoped command', t => {
  const f = fixture(t);
  f.client.setQueryData(['ops-me'], { permissions: ['forces.command', 'event.view'], global_permissions: ['event.view'], roles: [] });
  const html = renderWorkspace(f, task({ canContinue: false, gathering: { state: 'missing', campaignId: 'private-campaign-9966' } }), false);
  assert.match(html, /Штаб готовит распределение/);
  assert.match(html, /Перед подбором физического наряда/);
  assert.match(html, /Департамент может пока ответить количеством/);
  assert.doesNotMatch(html, /private-campaign-9966|Открыть распределения|Проверить распределения/);
  assert.equal(f.state.writes.length, 0);
});

test('headquarters missing gathering opens the generic campaign panel rather than the event collection', t => {
  const f = fixture(t);
  const html = renderWorkspace(f, task({ gathering: { state: 'missing', campaignId: null } }), true);
  assert.match(html, /href="\/employees\/\?view=forces&amp;tab=collections"[^>]*>Открыть распределения/);
  assert.equal(f.state.writes.length, 0);
});

test('ready gathering reuses the exact campaign for headquarters and keeps its identity private for chief', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const value = task({ gathering: { state: 'ready', campaignId: '9007199254740997' } });
  const staff = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, isHeadquarters: true, canViewEvent: true, canCommand: true }));
  assert.match(staff, /Распределение для подбора подготовлено/);
  assert.match(staff, /href="\/employees\/\?view=forces&amp;tab=collections&amp;campaign=9007199254740997"/);
  const chief = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, isHeadquarters: false, canViewEvent: true, canCommand: false }));
  assert.match(chief, /Распределение для подбора подготовлено/);
  assert.doesNotMatch(chief, /9007199254740997|Открыть распределение/);
});

test('ambiguous gathering asks headquarters to clarify without silently selecting a campaign', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const html = renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: task({ gathering: { state: 'ambiguous', campaignId: null } }), isHeadquarters: true, canViewEvent: true, canCommand: true }));
  assert.match(html, /Штаб уточняет распределение/);
  assert.match(html, /несколько активных распределений/);
  assert.match(html, /href="\/employees\/\?view=forces&amp;tab=collections"[^>]*>Проверить распределения/);
  assert.doesNotMatch(html, /campaign=|Распределение для подбора подготовлено/);
});

test('legacy gathering remains a conditional check while explicit null suppresses the completed-stage prerequisite', t => {
  const f = fixture(t); const { AssistantTaskCard } = f.load('@/features/om-assistant/workspace');
  const render = value => renderToStaticMarkup(React.createElement(AssistantTaskCard, { task: value, isHeadquarters: false, canViewEvent: true, canCommand: false }));
  const legacy = render(task({ gathering: undefined }));
  assert.match(legacy, /Проверьте подготовку распределения/);
  assert.match(legacy, /создано ли одно активное распределение/);
  assert.doesNotMatch(legacy, /Штаб готовит распределение|Распределение для подбора подготовлено/);
  for (const status of ['awaiting_recon', 'placement', 'awaiting_approval', 'completed', 'event_unavailable']) {
    const omitted = render(task({ status, gathering: null }));
    assert.doesNotMatch(omitted, /Подготовка физического наряда|создано ли одно активное распределение|Открыть распределени/);
  }
});

test('dialogue posts a clarification to the same task with a stable HTTP-safe key on lost response', async t => {
  const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'ready', attempt: 1, retryable: false, error: null } }));
  f.state.post = async () => { throw Error('connection lost'); };
  assert.equal(typeof f.writer.sendMessage, 'function');
  await f.writer.sendMessage('Всего нужно 180', 2);
  assert.equal(f.writer.snapshot().retryable, true);
  assert.deepEqual(f.state.writes[0], { url: `/api/ops/assistant/tasks/${taskId}/messages/`, body: { requestKey: 'request-1', message: 'Всего нужно 180', revision: 2 } });
  f.state.post = null; await f.writer.retry();
  assert.deepEqual(f.state.writes[1], f.state.writes[0]);
  assert.equal(f.state.saved[0].id, taskId);
});

for (const patch of [{ canEdit: false }, { canMessage: false }, { processing: { state: 'running' } }, { processing: { state: 'queued' } }]) {
  test(`dialogue rejects unavailable writes ${JSON.stringify(patch)}`, async t => {
    const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'ready' }, ...patch }));
    assert.equal(typeof f.writer.sendMessage, 'function');
    await f.writer.sendMessage('Уточнение', 2);
    assert.equal(f.state.writes.length, 0);
    assert.ok(f.writer.snapshot().error);
  });
}

test('dialogue rejects blank messages and invalid revisions without creating an attempt', async t => {
  const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'ready' } }));
  assert.equal(typeof f.writer.sendMessage, 'function');
  await f.writer.sendMessage('   ', 2); await f.writer.sendMessage('Уточнение', 0); await f.writer.sendMessage('x'.repeat(4001), 2);
  assert.equal(f.state.writes.length, 0);
});

test('failed processing retries the saved turn without posting another user message', async t => {
  const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'failed', retryable: true } }));
  assert.equal(typeof f.writer.retryProcessing, 'function');
  await f.writer.retryProcessing();
  assert.deepEqual(f.state.writes[0], { url: `/api/ops/assistant/tasks/${taskId}/retry/`, body: { requestKey: 'request-1', revision: 2 } });
});

test('a late dialogue response cannot replace another selected task or reappear after access revocation', async t => {
  const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'ready' } }));
  assert.equal(typeof f.writer.sendMessage, 'function');
  let release; f.state.post = () => new Promise(resolve => { release = resolve; });
  const pending = f.writer.sendMessage('Уточнение', 2);
  f.select(task({ id: '4733240a-32a0-46cd-9ad9-5127665c29e8' }));
  release(task()); await pending;
  assert.equal(f.state.saved.length, 0);
  f.select(task({ canMessage: true })); f.client.setQueryData(['ops-me'], { permissions: [], roles: [] });
  await f.writer.sendMessage('Уточнение', 2);
  assert.equal(f.state.writes.length, 1);
});

test('processing prevents continue even if stale canContinue still says yes', async t => {
  const f = fixture(t); f.select(task({ processing: { state: 'running' } }));
  await f.writer.continueTask(); await f.writer.continueTask({ title: 'Changed' });
  assert.equal(f.state.writes.length, 0);
});

test('saved dialogue displays escaped history and a permanent composer with manual correction collapsed', t => {
  const f = fixture(t); const value = task({ canMessage: true, processing: { state: 'ready', attempt: 1, retryable: false, error: null },
    messages: [{ id: 'm1', role: 'user', text: 'Всего <180>', requestKey: 'key1', createdAt: '2026-10-27T10:00:00Z' },
      { id: 'm2', role: 'assistant', text: 'Сумма департаментов 200. Уточните распределение.', requestKey: 'key1', createdAt: '2026-10-27T10:00:01Z' }],
    questions: [{ field: 'allocations', text: 'Согласуйте сумму.' }] });
  const html = renderWorkspace(f, value);
  assert.match(html, /aria-label="Переписка по поручению"/);
  assert.match(html, /Всего &lt;180&gt;/);
  assert.match(html, /Сумма департаментов 200/);
  assert.match(html, /Сообщение помощнику/);
  assert.match(html, /Согласуйте сумму/);
  assert.doesNotMatch(html.match(/<details[^>]*id="assistant-correction"[^>]*>/)?.[0] ?? '', /open=/);
  assert.equal(f.state.writes.length, 0);
});

for (const [state, expected] of [['queued', 'Сообщение сохранено'], ['running', 'Помощник обрабатывает'], ['failed', 'Не удалось обработать'], ['ready', 'Ответ готов']]) {
  test(`saved processing state ${state} survives rendering without starting another request`, t => {
    const f = fixture(t); const html = renderWorkspace(f, task({ canMessage: true, messages: [], processing: { state, attempt: 1, retryable: state === 'failed', error: null } }));
    assert.match(html, new RegExp(expected));
    assert.match(html, /Сообщение помощнику/);
    assert.equal(f.state.writes.length, 0);
  });
}

test('lost dialogue response is replayable after polling discovers that same saved message is processing', async t => {
  const f = fixture(t); f.select(task({ canMessage: true, processing: { state: 'ready' } }));
  f.state.post = async () => { throw Error('lost response'); };
  await f.writer.sendMessage('180 человек', 2);
  f.select(task({ canMessage: false, processing: { state: 'queued' }, messages: [{ id: 'm1', role: 'user', text: '180 человек', requestKey: 'request-1', createdAt: '' }] }));
  f.state.post = null; await f.writer.retry();
  assert.equal(f.state.writes.length, 2);
  assert.deepEqual(f.state.writes[1], f.state.writes[0]);
});

test('dialogue next step distinguishes processing and explicit creation from unresolved questions', t => {
  const f = fixture(t);
  assert.match(f.model.taskNextAction(task({ processing: { state: 'running' } })).title, /Обработка/);
  assert.match(f.model.taskNextAction(task({ event: null, questions: [], processing: { state: 'ready' }, canContinue: true })).title, /Создать ОМ/);
  assert.match(f.model.taskNextAction(task({ questions: [{ field: 'personnelTotal', text: 'Сколько?' }], processing: { state: 'ready' } })).description, /сообщени/);
});

test('dialogue uses UUID fallback on HTTP and does not require native randomUUID', async t => {
  const f = fixture(t, { getRandomValues: buffer => require('node:crypto').webcrypto.getRandomValues(buffer) });
  f.select(task({ canMessage: true, processing: { state: 'ready' } }));
  const writer = f.api.createAssistantWriter({ client: f.client, getContext: f.context, onSaved() {}, onChange() {} });
  await writer.sendMessage('Уточнение', 2);
  assert.match(f.state.writes[0].body.requestKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('busy dialogue polls for recovery, ready dialogue returns to normal polling', t => {
  const f = fixture(t); f.api.useAssistantTask(taskId);
  const option = f.state.options.at(-1);
  assert.equal(option.refetchInterval({ state: { status: 'success', data: task({ processing: { state: 'queued' } }) } }), 2000);
  assert.equal(option.refetchInterval({ state: { status: 'success', data: task({ processing: { state: 'ready' } }) } }), 30000);
});

function conversationHarness(f, props) {
  const slots = []; let cursor = 0; let effects = [];
  f.override('react', { ...React, useId: () => 'conversation-input',
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; }, useEffect(effect) { effects.push(effect); } });
  const { AssistantConversation } = f.load('@/features/om-assistant/conversation');
  function render(patch = {}) { Object.assign(props, patch); cursor = 0; effects = []; const tree = AssistantConversation(props); for (const effect of effects) effect(); return tree; }
  function find(tree, type) { if (!tree || typeof tree !== 'object') return null; if (tree.type === type) return tree;
    for (const child of React.Children.toArray(tree.props?.children)) { const match = find(child, type); if (match) return match; } return null; }
  function button(tree, title) {
    if (!tree || typeof tree !== 'object') return null;
    if (tree.props?.onClick && tree.props?.children === title) return tree;
    for (const child of React.Children.toArray(tree.props?.children)) { const match = button(child, title); if (match) return match; }
    return null;
  }
  return { render, input: tree => find(tree, 'textarea'), form: tree => find(tree, 'form'), button };
}

test('conversation retains a failed draft and clears only its own acknowledged saved message', async t => {
  const f = fixture(t); const selected = task({ canMessage: true, processing: { state: 'ready' }, messages: [] });
  const h = conversationHarness(f, { task: selected, acknowledged: null, disabled: false, pending: false,
    send: async () => undefined, retry: async () => undefined });
  h.input(h.render()).props.onChange({ target: { value: 'Всего 180' } });
  h.form(h.render()).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
  assert.equal(h.input(h.render()).props.value, 'Всего 180');
  h.render({ acknowledged: task({ id: '4733240a-32a0-46cd-9ad9-5127665c29e8', revision: 3, messages: [{ role: 'user', text: 'Всего 180' }] }) });
  assert.equal(h.input(h.render()).props.value, 'Всего 180');
  h.render({ acknowledged: task({ revision: 3, messages: [{ role: 'user', text: 'Всего 180' }] }) });
  assert.equal(h.input(h.render()).props.value, '');
});

test('conversation blocks submit while busy or revoked without discarding typed text', async t => {
  const f = fixture(t); let calls = 0;
  const h = conversationHarness(f, { task: task({ canMessage: true, processing: { state: 'ready' } }), acknowledged: null, disabled: false, pending: false,
    send: async () => { calls++; }, retry: async () => undefined });
  h.input(h.render()).props.onChange({ target: { value: '180 человек' } });
  for (const selected of [task({ canMessage: true, processing: { state: 'running' } }), task({ canEdit: false, canMessage: true, processing: { state: 'ready' } })]) {
    const tree = h.render({ task: selected }); assert.equal(h.input(tree).props.disabled, true);
    h.form(tree).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
    assert.equal(h.input(h.render()).props.value, '180 человек');
  }
  assert.equal(calls, 0);
});

test('saved processing retry remains replayable after polling discovers a new attempt', async t => {
  const f = fixture(t); f.select(task({ processing: { state: 'failed', retryable: true, attempt: 1 } }));
  f.state.post = async () => { throw Error('lost'); }; await f.writer.retryProcessing();
  f.select(task({ processing: { state: 'running', retryable: false, attempt: 2 } }));
  f.state.post = null; await f.writer.retry();
  assert.equal(f.state.writes.length, 2); assert.deepEqual(f.state.writes[0], f.state.writes[1]);
});

test('an old identical message and unrelated revision must not clear a failed repeated draft', async t => {
  const f = fixture(t); const previous = { id: 'old', role: 'user', text: '180 человек', requestKey: 'old-key', createdAt: '' };
  const h = conversationHarness(f, { task: task({ canMessage: true, processing: { state: 'ready' }, messages: [previous] }),
    acknowledged: null, disabled: false, pending: false, send: async () => undefined, retry: async () => undefined });
  h.input(h.render()).props.onChange({ target: { value: '180 человек' } });
  h.form(h.render()).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
  h.render({ acknowledged: task({ revision: 3, messages: [previous] }) });
  assert.equal(h.input(h.render()).props.value, '180 человек');
  h.render({ acknowledged: task({ revision: 4, messages: [previous, { ...previous, id: 'new', requestKey: 'new-key' }] }) });
  assert.equal(h.input(h.render()).props.value, '');
});

const guidedTask = patch => task({ event: null, status: 'needs_information', canContinue: false, canMessage: true,
  processing: { state: 'ready', attempt: 1, retryable: false, error: null },
  questions: [{ field: 'briefing.objects[1].sectorCount', text: 'Тарлан: сколько секторов?' },
    { field: 'briefing.objects[0].chiefName', text: 'Аккорда: кто старший объекта?' }],
  guidance: { current: { id: 'tarlan-sectors', field: 'briefing.objects[1].sectorCount', text: 'Тарлан: сколько секторов?',
    placeholder: 'Например, 2', canDefer: true, choices: [{ label: 'Без секторов', value: '0' }] }, remaining: 2, deferred: 0 },
  messages: [{ id: 'm1', role: 'user', text: 'Подготовь Аккорду и Тарлан', requestKey: 'k1', createdAt: '' },
    { id: 'm2', role: 'assistant', text: 'Тарлан: сколько секторов?\nАккорда: кто старший объекта?', requestKey: 'k1', createdAt: '' }],
  ...patch });

function primaryConversation(html) {
  return html.match(/<section[^>]*aria-label="Переписка по поручению"[\s\S]*?<\/section>/)?.[0]
    ?.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
}

test('guided dialogue shows one contextual question with compact history and all blockers available on expansion', t => {
  const f = fixture(t); const html = renderWorkspace(f, guidedTask());
  const primary = primaryConversation(html);
  assert.ok(primary);
  assert.equal(primary.split('Тарлан: сколько секторов?').length - 1, 1);
  assert.doesNotMatch(primary, /Аккорда: кто старший объекта|Подготовь Аккорду и Тарлан/);
  assert.match(primary, /Осталось уточнений: 2/);
  assert.match(primary, /Ваш ответ/);
  assert.match(primary, /placeholder="Например, 2"/);
  assert.match(primary, /Без секторов/); assert.match(primary, /Пока не знаю/);
  assert.match(html, /<details[^>]*><summary[^>]*>История диалога/);
  assert.match(html, /<details[^>]*><summary[^>]*>Все недостающие сведения/);
  for (const title of ['История диалога', 'Все недостающие сведения']) {
    const disclosure = html.match(new RegExp(`<details([^>]*)><summary[^>]*>${title}`));
    assert.ok(disclosure); assert.doesNotMatch(disclosure[1], /\bopen\b/);
  }
  assert.doesNotMatch(html.match(/<details[^>]*id="assistant-correction"[^>]*>/)?.[0] ?? '', /open=/);
  assert.match(html, /href="#assistant-answer"/);
  assert.doesNotMatch(html, /href="#assistant-correction"/);
  assert.equal(f.state.writes.length, 0);
});

test('all deferred questions remain blockers and offer an explicit return instead of a false ready state', t => {
  const f = fixture(t); const html = renderWorkspace(f, guidedTask({ canContinue: true,
    guidance: { current: null, remaining: 2, deferred: 2 } }));
  const primary = primaryConversation(html);
  assert.match(primary, /Осталось уточнений: 2/); assert.match(primary, /Отложено: 2/);
  assert.match(primary, /Вернуться к отложенным вопросам/);
  assert.doesNotMatch(primary, /Текущий вопрос|Ответ готов|все сведения собраны/i);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Создать ОМ от своего имени<\/button>/);
  assert.equal(f.state.writes.length, 0);
});

for (const state of ['queued', 'running', 'failed']) {
  test(`guided ${state} state does not present a stale active question or choices`, t => {
    const html = renderWorkspace(fixture(t), guidedTask({ processing: { state, attempt: 1, retryable: state === 'failed', error: null } }));
    const primary = primaryConversation(html);
    assert.doesNotMatch(primary, /Тарлан: сколько секторов|Без секторов|Пока не знаю/);
    assert.match(primary, /<textarea[^>]*disabled=""/);
    if (state === 'failed') assert.match(primary, /Повторить обработку/);
  });
}

test('guided choices fill an empty draft without posting and cannot overwrite a typed answer', async t => {
  const f = fixture(t); const sent = [];
  const h = conversationHarness(f, { task: guidedTask(), acknowledged: null, disabled: false, pending: false,
    send: async (text, revision) => { sent.push({ text, revision }); }, retry: async () => undefined });
  let tree = h.render(); const choice = h.button(tree, 'Без секторов'); assert.ok(choice);
  choice.props.onClick(); tree = h.render();
  assert.equal(h.input(tree).props.value, '0'); assert.equal(sent.length, 0);
  h.input(tree).props.onChange({ target: { value: 'На Тарлане 3 сектора, на Аккорде старший Асанов' } });
  tree = h.render(); const skip = h.button(tree, 'Пока не знаю');
  assert.equal(skip.props.disabled, true); skip.props.onClick();
  assert.equal(h.input(h.render()).props.value, 'На Тарлане 3 сектора, на Аккорде старший Асанов');
  h.form(h.render()).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
  assert.deepEqual(sent, [{ text: 'На Тарлане 3 сектора, на Аккорде старший Асанов', revision: 2 }]);
});

test('deferring and resuming require the usual explicit send and carry literal messages with the current revision', async t => {
  for (const [label, selected] of [['Пока не знаю', guidedTask()], ['Вернуться к отложенным вопросам', guidedTask({ revision: 4,
    guidance: { current: null, remaining: 2, deferred: 2 } })]]) {
    const f = fixture(t); const sent = [];
    const h = conversationHarness(f, { task: selected, acknowledged: null, disabled: false, pending: false,
      send: async (text, revision) => { sent.push({ text, revision }); }, retry: async () => undefined });
    const button = h.button(h.render(), label); assert.ok(button); button.props.onClick();
    assert.equal(h.input(h.render()).props.value, label); assert.equal(sent.length, 0);
    h.form(h.render()).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
    assert.deepEqual(sent, [{ text: label, revision: selected.revision }]);
  }
});

test('a short draft cannot silently migrate to another question after a remote revision', async t => {
  const f = fixture(t); const sent = []; const original = guidedTask();
  const h = conversationHarness(f, { task: original, acknowledged: null, disabled: false, pending: false,
    send: async (text, revision) => { sent.push({ text, revision }); }, retry: async () => undefined });
  h.input(h.render()).props.onChange({ target: { value: '3' } });
  const updated = guidedTask({ revision: 3, guidance: { current: { id: 'akkorda-chief', field: 'briefing.objects[0].chiefName',
    text: 'Аккорда: кто старший объекта?', canDefer: true }, remaining: 1, deferred: 0 } });
  let tree = h.render({ task: updated });
  assert.equal(h.input(tree).props.value, '3');
  h.form(tree).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
  assert.equal(sent.length, 0);
  const confirm = h.button(h.render(), 'Проверил вопрос — использовать мой ответ'); assert.ok(confirm); confirm.props.onClick();
  tree = h.render(); h.form(tree).props.onSubmit({ preventDefault() {} }); await Promise.resolve();
  assert.deepEqual(sent, [{ text: '3', revision: 3 }]);
});

test('legacy dialogue keeps one question visible without promising server guidance or losing the full blocker list', t => {
  const html = renderWorkspace(fixture(t), guidedTask({ guidance: undefined }));
  const primary = primaryConversation(html);
  assert.match(primary, /Тарлан: сколько секторов/);
  assert.doesNotMatch(primary, /Аккорда: кто старший объекта|Пока не знаю|Без секторов/);
  assert.match(primary, /Сообщение помощнику/);
  assert.match(html, /Аккорда: кто старший объекта/);
});

test('guided feedback explains an unrecognized answer before repeating its question and escapes provider text', t => {
  const value = guidedTask(); value.guidance.feedback = 'Ответ сохранён, но количество <постов> пока не распознано.';
  const primary = primaryConversation(renderWorkspace(fixture(t), value));
  assert.match(primary, /Ответ сохранён, но количество &lt;постов&gt; пока не распознано/);
  assert.ok(primary.indexOf('Ответ сохранён') < primary.indexOf('Тарлан: сколько секторов?'));
  assert.equal(primary.split('Тарлан: сколько секторов?').length - 1, 1);
  for (const state of ['queued', 'running', 'failed']) {
    const hidden = primaryConversation(renderWorkspace(fixture(t), { ...value, processing: { state, attempt: 1, retryable: false, error: null } }));
    assert.doesNotMatch(hidden, /количество &lt;постов&gt; пока не распознано/);
  }
});

test('dialogue keeps a genuine domain permission notice visible alongside guidance', t => {
  const html = renderWorkspace(fixture(t), guidedTask({ interpretationNotice: 'Для создания ОМ требуется право создания мероприятия.' }));
  assert.match(primaryConversation(html), /Для создания ОМ требуется право создания мероприятия/);
});

test('a message being saved hides the previous active question and feedback until the response arrives', t => {
  const f = fixture(t); const { AssistantConversation } = f.load('@/features/om-assistant/conversation');
  const value = guidedTask(); value.guidance.feedback = 'Прежний ответ принят.';
  const html = renderToStaticMarkup(React.createElement(AssistantConversation, { task: value, acknowledged: null,
    disabled: true, pending: true, send: async () => undefined, retry: async () => undefined }));
  const primary = primaryConversation(html);
  assert.doesNotMatch(primary, /Тарлан: сколько секторов|Прежний ответ принят|Пока не знаю|Без секторов/);
  assert.match(primary, /Сохраняем сообщение/); assert.match(primary, /<textarea[^>]*disabled=""/);
});

test('guided tasks with messaging unavailable offer the manual fallback without a misleading dialogue link', t => {
  const f = fixture(t); const value = guidedTask({ canMessage: false });
  const next = f.model.taskNextAction(value);
  assert.equal(next.canCorrect, true);
  assert.doesNotMatch(next.description, /Продолжите диалог сообщением/);
  const html = renderWorkspace(f, value);
  assert.doesNotMatch(html, /href="#assistant-answer"/);
  assert.match(html, /href="#assistant-correction"/);
  assert.match(html, /Новые сообщения недоступны/);
});

test('grouped blockers do not compete with the granular unanswered question count', t => {
  const value = guidedTask(); value.guidance.remaining = 30;
  const html = renderWorkspace(fixture(t), value);
  assert.match(primaryConversation(html), /Осталось уточнений: 30/);
  assert.match(html, /<summary[^>]*>Все недостающие сведения<\/summary>/);
  assert.doesNotMatch(html, /Все вопросы \(2\)|Все недостающие сведения \(2\)/);
});

test('a real queued API plan with nullable briefing actions renders its durable locked dialogue', t => {
  const f = fixture(t);
  const value = task({ event: null, delegated: false, status: 'needs_information', canContinue: false,
    canMessage: false, processing: { state: 'queued', attempt: 1, error: null, retryable: false },
    guidance: { current: null, remaining: 3, deferred: 0 },
    questions: [{ field: 'title', text: 'Как называется мероприятие?' },
      { field: 'businessDate', text: 'На какую дату нужен наряд?' },
      { field: 'kind', text: 'Мероприятие внутреннее или с участием иностранных лиц?' }],
    plan: { title: null, businessDate: null, businessDateEnd: null, eventTime: null, kind: null,
      objectId: null, objectName: null, eventId: null, intent: 'prepare', allocations: [],
      personnelTotal: null, briefing: null, briefingPending: null } });
  const before = JSON.stringify(value);
  const html = renderWorkspace(f, value);
  assert.match(html, /aria-label="Переписка по поручению"/);
  assert.match(primaryConversation(html), /Сообщение сохранено\. Ожидает обработки/);
  assert.match(primaryConversation(html), /<textarea[^>]*disabled=""/);
  assert.doesNotMatch(html, /aria-label="Объекты и охраняемые лица поручения"|Создать ОМ от своего имени/);
  assert.equal(JSON.stringify(value), before);
  assert.equal(f.state.writes.length, 0);
});

test('nullable or omitted pending actions retain recognized briefing facts without inventing completed actions', t => {
  for (const pending of [null, undefined, []]) {
    const f = fixture(t);
    const value = task({ event: null, status: 'needs_information', canContinue: false, plan: {
      title: 'Встреча', kind: 'INTERNAL', businessDate: '2026-10-28',
      briefing: { objects: [{ name: 'Аккорда', needStatus: 'unknown', sectors: [] }], protectedPersons: [] },
      briefingPending: pending,
    }, questions: [{ field: 'briefing.objects[0].chiefName', text: 'Уточните старшего объекта.' }] });
    const before = JSON.stringify(value);
    const html = renderWorkspace(f, value);
    assert.match(html, /aria-label="Объекты и охраняемые лица поручения"/);
    assert.match(html, /Аккорда|Нужно уточнить/);
    assert.doesNotMatch(html, /Ожидают выполнения|Создать ОМ от своего имени/);
    assert.equal(JSON.stringify(value), before);
    assert.equal(f.state.writes.length, 0);
  }
});
