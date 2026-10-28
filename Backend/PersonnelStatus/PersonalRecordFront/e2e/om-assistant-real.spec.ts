import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, request, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { AssistantTask } from '@/features/om-assistant/model';
import type { SecurityEvent } from '@/entities/security-event/model/types';

type Role = 'owner' | 'observer';
type DialogueTask = AssistantTask & Required<Pick<AssistantTask, 'processing' | 'guidance' | 'messages'>>;
function dialogue(value: AssistantTask): DialogueTask {
  if (!value.processing || !value.guidance || !Array.isArray(value.messages)) {
    throw new Error('The actual dialogue response must include processing, guidance and persisted messages.');
  }
  return value as DialogueTask;
}
interface Fixture {
  database: string; origin: string; standMarker: string; runId: string;
  title: string; businessDate: string; superusers: number;
  users: Record<Role, { id: number; username: string; role: string; permissions: string[] }>;
  object: { id: number; name: string };
  chief: { id: number; answer: string };
  protectedPerson: { id: number; answer: string };
}
interface Fingerprint {
  complete: boolean; readOnly: boolean; database: string; standMarker: string; taskAlwaysEager: boolean;
  tables: Record<string, { rows: number; sha256: string }>;
  excluded: string[];
  taskAudit?: {
    taskId: string; initiatedBy: string; eventId: string | null; revision: number;
    userMessages: { text: string; requestKey: string }[]; assistantMessages: number;
    briefing: unknown; committedBriefing: unknown;
    receipts: { operation: string; executedBy: string }[];
  };
}
interface UiWrite { path: string; body: Record<string, unknown>; explicitlyConfirmed?: boolean }

function assertStoredDialogue(task: DialogueTask, fixture: Fixture, texts: string[], keys: string[]) {
  const stored = task.messages.filter(message => message.role === 'user');
  expect(stored).toHaveLength(18);
  expect(stored.map(message => message.text)).toEqual(texts);
  expect(stored.map(message => message.requestKey)).toEqual(keys);
  expect(new Set(stored.map(message => message.requestKey)).size).toBe(18);
  expect(task.messages.filter(message => message.role === 'assistant')).toHaveLength(19);
  expect(task.initiatedBy).toBe(String(fixture.users.owner.id));
  const briefing = task.plan.briefing;
  if (!briefing) throw new Error('Final persisted dialogue lost its recognized briefing.');
  expect(briefing.objects).toHaveLength(1);
  const object = briefing.objects[0];
  expect(object.objectId).toBe(String(fixture.object.id));
  expect(object.chiefEmployeeId).toBe(String(fixture.chief.id));
  expect(object.personnelNeed).toBe(3); expect(object.sectorCount).toBe(1);
  expect(object.sectors).toHaveLength(1); expect(object.sectors[0].posts).toHaveLength(1);
  expect(object.sectors[0].posts[0]).toMatchObject({ need: 3, subpostCount: 0 });
  expect(object.checklistResults).toHaveLength(5);
  expect(object.checklistResults!.map(row => row.id).sort()).toEqual([0, 1, 2, 3, 4].map(index => `checklist-${index}`));
  expect(object.checklistResults!.every(row => row.state === 'NORMAL')).toBe(true);
  expect(briefing.protectedPersons.map(person => person.personId)).toEqual([String(fixture.protectedPerson.id)]);
}

function assertCreatedEvent(event: SecurityEvent, executed: AssistantTask, fixture: Fixture) {
  expect(event.id).toBe(executed.event?.id);
  expect(event.title).toBe(fixture.title); expect(event.businessDate).toBe(fixture.businessDate);
  expect(event.kind).toBe('INTERNAL');
  expect(event.protectedPersonId).toBe(String(fixture.protectedPerson.id));
  expect(event.protectedPersons.map(person => person.id)).toEqual([String(fixture.protectedPerson.id)]);
  expect(event.visitObjects).toHaveLength(1);
  const visit = event.visitObjects[0];
  expect(visit.objectId).toBe(String(fixture.object.id));
  expect(visit.chiefEmployeeId).toBe(String(fixture.chief.id));
  expect(visit.protectedPersonId).toBe(String(fixture.protectedPerson.id));
  expect(visit.canManageRecon).toBe(false);
  expect(visit.reconForceRequest).toBe(0);
  expect(visit.placementNeed).toBe(0); expect(visit.placementAssigned).toBe(0);
  expect(event.reconSectorPosts).toEqual([]); expect(event.reconForceRequestedAt).toBeNull();
  expect(event.reconChecklist.map(row => row.state)).toEqual(Array(5).fill('UNCHECKED'));
  expect(visit.reconChecklist!.map(row => row.state)).toEqual(Array(5).fill('UNCHECKED'));
  expect(event.forceRequests).toEqual([]); expect(event.forceAllocation).toEqual([]);
  expect(event.forceRoster).toEqual([]); expect(event.placementAssignments).toEqual([]);
  expect(executed.receipts).toHaveLength(2);
}

function readFixture(origin: string): Fixture {
  const data = JSON.parse(fs.readFileSync(process.env.ASSISTANT_ACCEPTANCE_FIXTURE_PATH as string, 'utf8')) as Fixture;
  const positiveId = (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0;
  if (!/^assistant-acceptance-[a-f0-9]{10}$/.test(data?.standMarker) ||
      data.database !== 'sj_assistant_acceptance_' + data.standMarker.replaceAll('-', '_') || data.origin !== origin ||
      !/^[a-f0-9]{32}$/.test(data.runId) || data.superusers !== 0 ||
      data.businessDate !== '2027-06-01' || data.title !== 'Встреча' ||
      !positiveId(data.object?.id) || data.object.name !== 'Аккорда' ||
      !positiveId(data.chief?.id) || data.chief.answer !== 'Улан Мусахан' ||
      !positiveId(data.protectedPerson?.id) || data.protectedPerson.answer !== '800' ||
      !(['owner', 'observer'] as const).every(role => positiveId(data.users?.[role]?.id) &&
        data.users[role].username === `qa_assistant_${data.runId}_${role}` &&
        data.users[role].role === `QA_ASSIST_${data.runId.slice(0, 12).toUpperCase()}_${role.toUpperCase()}` &&
        Array.isArray(data.users[role].permissions))) {
    throw new Error('Expected exact origin/stand-bound assistant fixture metadata and two unique synthetic actors.');
  }
  expect(data.users.owner.id).not.toBe(data.users.observer.id);
  expect([...data.users.owner.permissions].sort()).toEqual(['event.create', 'event.manage', 'event.view', 'event.bulletin', 'catalog.view'].sort());
  expect([...data.users.observer.permissions].sort()).toEqual(['event.view', 'catalog.view'].sort());
  return data;
}

// Read metadata only. Never inspect/output container environment or use a name
// resolved through a mutable alias. The SQL helper repeats exact DB binding.
function ownedBackend(fixture: Fixture): string {
  const identity = process.env.ASSISTANT_ACCEPTANCE_BACKEND_CONTAINER || '';
  if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error('A full owned backend container ID is required.');
  const info = JSON.parse(execFileSync('docker', ['inspect', identity], { encoding: 'utf8' }))[0];
  expect(info.Id).toBe(identity);
  expect(info.Config.Labels?.verification).toBe(fixture.standMarker);
  expect(info.State.Running).toBe(true);
  expect(info.HostConfig.ReadonlyRootfs).toBe(true);
  expect(Object.keys(info.NetworkSettings.Networks)).toEqual(['sj-' + fixture.standMarker]);
  const network = info.NetworkSettings.Networks['sj-' + fixture.standMarker].NetworkID as string;
  if (!/^[a-f0-9]{64}$/.test(network)) throw new Error('Owned internal network ID missing.');
  const metadata = JSON.parse(execFileSync('docker', ['network', 'inspect', network], { encoding: 'utf8' }))[0];
  expect(metadata.Id).toBe(network);
  expect(metadata.Internal).toBe(true);
  expect(metadata.Labels?.verification).toBe(fixture.standMarker);
  return identity;
}

test('real assistant: durable dialogue, explicit OM creation and duplicate-free replay', async ({ browser, baseURL }, testInfo) => {
  const origin = baseURL as string;
  const fixture = readFixture(origin);
  const backend = ownedBackend(fixture);
  const password = process.env.ASSISTANT_ACCEPTANCE_PASSWORD as string;
  const saved: Record<string, unknown> = {};
  const save = (name: string, value: unknown) => { saved[name] = structuredClone(value); };
  const errors: string[] = [], trace: { method: string; path: string; status: number }[] = [];
  const writes: UiWrite[] = [], blocked: { path: string; reason: string }[] = [], checks: Record<string, unknown>[] = [];
  const keys = new Set<string>();
  let task: DialogueTask, taskId: string | null = null, messageIndex = 0, retryAllowed = false, continuationAllowed = false;
  let context!: BrowserContext, page!: Page, api!: APIRequestContext, observerApi!: APIRequestContext;
  const endpoint = '/api/ops/assistant/tasks/';
  const initial = 'Подготовь внутреннее мероприятие «Встреча» 01.06.2027 на объектах Аккорда.';
  const answers = ['Пока не знаю', '3 человека', '1', '1 пост', 'Без подпостов', '3 человека',
    'да', 'Есть замечание', 'Не проверен', ...Array(5).fill('Норма'), '800',
    'Вернуться к отложенным вопросам', 'Улан Мусахан'];
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const object = (value: AssistantTask) => {
    const briefing = value.plan.briefing;
    if (!briefing || briefing.objects.length !== 1) throw new Error('Expected exactly one recognized fixture object.');
    expect(briefing.objects[0].name).toBe(fixture.object.name);
    return briefing.objects[0];
  };
  const capture = (filename: string, withTask = false): Fingerprint => {
    if (withTask && !taskId) throw new Error('A saved task ID is required for the read-only persisted-task audit.');
    const source = fs.readFileSync(path.join(testInfo.config.rootDir, 'fixtures/assistant-acceptance-fingerprint.py'));
    const stdout = execFileSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
      '-e', 'ASSISTANT_ACCEPTANCE_FINGERPRINT=1', '-e', 'ASSISTANT_ACCEPTANCE_DATABASE=' + fixture.database,
      '-e', 'ASSISTANT_ACCEPTANCE_STAND_MARKER=' + fixture.standMarker,
      ...(withTask ? ['-e', 'ASSISTANT_ACCEPTANCE_AUDIT_TASK_ID=' + taskId] : []), backend, 'python', '-'],
    { input: source, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const value = JSON.parse(stdout) as Fingerprint;
    expect(value.complete).toBe(true); expect(value.readOnly).toBe(true);
    expect(value.database).toBe(fixture.database); expect(value.standMarker).toBe(fixture.standMarker);
    expect(value.taskAlwaysEager).toBe(false);
    expect(value.excluded).toEqual(['ops_assistant_messages', 'ops_assistant_tasks', 'ops_audit_logs']);
    save(filename, value); return value;
  };
  try {
    api = await request.newContext({ baseURL: origin });
    const tokenResponse = await api.post('/api/token/', { data: { username: fixture.users.owner.username, password } });
    expect(tokenResponse.status()).toBe(200);
    const access = (await tokenResponse.json()).access;
    const claims = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8'));
    expect(String(claims.user_id)).toBe(String(fixture.users.owner.id));
    await api.dispose();
    api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: 'Bearer ' + access } });
    const rights = await (await api.get('/api/operations/my-permissions/')).json();
    expect(rights.permissions.sort()).toEqual([...fixture.users.owner.permissions].sort());
    expect(rights.global_permissions.sort()).toEqual([...fixture.users.owner.permissions].sort());
    expect(rights.roles).toEqual([expect.objectContaining({ code: fixture.users.owner.role, scope_division_id: null })]);
    expect((await (await api.get(endpoint)).json()).results).toEqual([]);
    const configuration = await (await api.get(endpoint + 'configuration/')).json();
    expect(configuration.enabled).toBe(true); expect(configuration.isHeadquarters).toBe(false);
    const catalogs = await (await api.get(endpoint + 'catalogs/')).json();
    expect(catalogs.objects).toEqual([expect.objectContaining({ id: String(fixture.object.id), name: fixture.object.name })]);
    const observerLogin = await request.newContext({ baseURL: origin });
    const observerResponse = await observerLogin.post('/api/token/', { data: { username: fixture.users.observer.username, password } });
    expect(observerResponse.status()).toBe(200);
    const observerAccess = (await observerResponse.json()).access;
    const observerClaims = JSON.parse(Buffer.from(observerAccess.split('.')[1], 'base64url').toString('utf8'));
    expect(String(observerClaims.user_id)).toBe(String(fixture.users.observer.id));
    await observerLogin.dispose();
    observerApi = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: 'Bearer ' + observerAccess } });
    const observerRights = await (await observerApi.get('/api/operations/my-permissions/')).json();
    expect(observerRights.permissions.sort()).toEqual([...fixture.users.observer.permissions].sort());
    expect(observerRights.global_permissions.sort()).toEqual([...fixture.users.observer.permissions].sort());
    expect(observerRights.roles).toEqual([expect.objectContaining({ code: fixture.users.observer.role, scope_division_id: null })]);
    const refusedCreate = await observerApi.post(endpoint, { data: { requestKey: crypto.randomUUID(), message: 'Denied fixture proposal', fields: {}, interpret: true } });
    expect(refusedCreate.status()).toBe(403);
    save('observer-create-refused.json', { status: refusedCreate.status(), body: await refusedCreate.json() });
    context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU',
      timezoneId: 'Asia/Qyzylorda', serviceWorkers: 'block' });
    await context.route('**/api/**', async route => {
      const req = route.request();
      const address = new URL(req.url());
      const pathname = address.pathname;
      if (address.origin !== origin) {
        blocked.push({ path: pathname, reason: 'API request outside fixture origin' });
        return route.abort('blockedbyclient');
      }
      if (pathname.startsWith('/api/auth/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
      try {
        expect(req.method()).toBe('POST');
        const body = req.postDataJSON() as Record<string, unknown>;
        if (taskId && pathname === `${endpoint}${taskId}/continue/`) {
          expect(continuationAllowed).toBe(true);
          continuationAllowed = false;
          expect(body).toEqual({});
          writes.push({ path: pathname, body, explicitlyConfirmed: true });
          return route.continue();
        }
        if (typeof body.requestKey !== 'string') throw new Error('Missing unique request key.');
        expect(body.requestKey).toMatch(/^[a-f0-9-]{36}$/);
        expect(keys.has(body.requestKey)).toBe(false);
        if (pathname === endpoint) {
          expect(taskId).toBeNull();
          expect(writes).toHaveLength(0);
          expect(body).toEqual({ requestKey: body.requestKey, message: initial, fields: {}, interpret: true });
        } else if (taskId && pathname === `${endpoint}${taskId}/messages/`) {
          expect(body.revision).toBeGreaterThanOrEqual(1);
          expect(Number.isSafeInteger(body.revision)).toBe(true);
          expect(body).toEqual({ requestKey: body.requestKey, revision: body.revision, message: answers[messageIndex] });
          messageIndex += 1;
        } else if (taskId && pathname === `${endpoint}${taskId}/retry/`) {
          expect(retryAllowed).toBe(true);
          retryAllowed = false;
          expect(body).toEqual({ requestKey: body.requestKey, revision: body.revision });
          expect(typeof body.revision === 'number' && Number.isSafeInteger(body.revision) && body.revision > 0).toBe(true);
        } else throw new Error('Unexpected business mutation: ' + pathname);
        keys.add(body.requestKey);
        writes.push({ path: pathname, body });
        return route.continue();
      } catch (error) {
        blocked.push({ path: pathname, reason: String(error) });
        return route.abort('blockedbyclient');
      }
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
        trace.push({ method: response.request().method(), path: url.pathname, status: response.status() });
      }
    });
    const csrf = await (await page.request.get('/api/auth/csrf/')).json();
    const login = await page.request.post('/api/auth/callback/credentials/', { form: {
      csrfToken: csrf.csrfToken, username: fixture.users.owner.username, password, json: 'true',
    } });
    expect(login.status()).toBe(200);
    expect((await login.json()).url).not.toContain('error=');
    const session = await (await page.request.get('/api/auth/session/')).json();
    expect(session.error).toBeUndefined();
    expect(session.user?.name).toBe(fixture.users.owner.username);
    await page.goto('/security-ops/assistant/');
    await expect(page.getByRole('heading', { name: 'Помощник по ОМ', exact: true })).toBeVisible();
    const beforeDialogue = capture('database-before-dialogue.json');
    await page.getByLabel('Какой наряд нужно подготовить?').fill(initial);
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint);
    const started = Date.now();
    await page.getByRole('button', { name: 'Подготовить по поручению', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    task = dialogue(await createdResponse.json() as AssistantTask); taskId = task.id;
    expect(taskId).toMatch(/^[a-f0-9-]{36}$/);
    expect(task.processing.state).toBe('queued');
    expect(task.guidance!.current).toBeNull();
    save('created.json', task);
    const saveMilliseconds = Date.now() - started;
    const conversation = page.getByRole('region', { name: 'Переписка по поручению', exact: true });
    await expect(conversation).toBeVisible();
    await expect(conversation.getByRole('status')).toContainText(/Ожидает обработки|обрабатывает/);
    await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
    await expect(conversation.getByLabel('Сообщение помощнику', { exact: true })).toBeDisabled();
    await expect(page).toHaveURL(new RegExp('task=' + taskId));
    await page.reload();
    const settle = async (expected: 'ready' | 'failed' = 'ready') => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await api.get(endpoint + taskId + '/');
        expect(response.status()).toBe(200);
        const value = dialogue(await response.json() as AssistantTask);
        if (value.processing.state === expected) return value;
        if (value.processing.state === 'failed' && expected !== 'failed') throw new Error('Unexpected worker failure: ' + value.processing.error);
        await sleep(200);
      }
      throw new Error('Dedicated worker did not settle');
    };
    const visibleReady = async (value: DialogueTask) => {
      if (value.guidance!.current) await expect(conversation.getByLabel('Текущий вопрос')).toContainText(value.guidance!.current.text);
      else await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
      const label = value.guidance!.current ? 'Ваш ответ' : 'Сообщение помощнику';
      if (value.canMessage) await expect(conversation.getByLabel(label, { exact: true })).toBeEnabled();
    };
    task = await settle(); await visibleReady(task);
    expect(task.guidance!.current!.field).toBe('chiefName');
    expect(task.messages.filter(message => message.role === 'user')).toHaveLength(1);
    const chiefQuestion = task.guidance!.current!;
    checks.push({ check: 'created queued before delayed provider; locked composer and reload preserve the task', saveMilliseconds });
    console.log(JSON.stringify({ phase: 'initial durable task and real worker response', taskId, saveMilliseconds }));
    const say = async (text: string, expected: 'ready' | 'failed' = 'ready', prepared = false) => {
      const before = task;
      await visibleReady(before);
      const label = before.guidance!.current ? 'Ваш ответ' : 'Сообщение помощнику';
      const input = conversation.getByLabel(label, { exact: true });
      if (prepared) await expect(input).toHaveValue(text); else await input.fill(text);
      const saved = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${endpoint}${taskId}/messages/`);
      await conversation.getByRole('button', { name: before.guidance!.current ? 'Отправить ответ' : 'Отправить сообщение', exact: true }).click();
      const response = await saved;
      expect(response.status()).toBe(202);
      expect(response.request().postDataJSON().revision).toBe(before.revision);
      const queued = dialogue(await response.json() as AssistantTask);
      expect(queued.guidance.current).toBeNull();
      task = await settle(expected);
      if (expected === 'ready') await visibleReady(task);
      save('step-' + messageIndex + '.json', task);
      return task;
    };
    const previousWrites = writes.length;
    await conversation.getByRole('button', { name: 'Пока не знаю', exact: true }).click();
    expect(writes).toHaveLength(previousWrites);
    await say('Пока не знаю', 'ready', true);
    expect(object(task).personnelNeed).toBeNull();
    expect(task.guidance!.deferred).toBe(1);
    expect(task.canContinue).toBe(false);
    expect(task.guidance!.current!.field).toBe('personnelNeed');
    await say('3 человека', 'failed');
    await expect(conversation.getByRole('status')).toContainText('Не удалось обработать сообщение');
    await expect(conversation.getByLabel('Текущий вопрос')).toHaveCount(0);
    await expect(conversation.getByLabel('Сообщение помощнику', { exact: true })).toBeDisabled();
    await page.reload();
    await expect(conversation.getByRole('button', { name: 'Повторить обработку', exact: true })).toBeVisible();
    expect(task.messages.filter(message => message.role === 'user')).toHaveLength(3);
    retryAllowed = true;
    const retry = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `${endpoint}${taskId}/retry/`);
    await conversation.getByRole('button', { name: 'Повторить обработку', exact: true }).click();
    expect((await retry).status()).toBe(202);
    task = await settle(); await visibleReady(task);
    expect(task.messages.filter(message => message.role === 'user')).toHaveLength(3);
    expect(object(task).personnelNeed).toBe(3);
    expect(object(task).sectorCount).toBeNull();
    expect(task.guidance!.current!.field).toBe('sectorCount');
    checks.push({ check: 'deferral remains unknown; provider failure/reload/retry preserves message and question binding' });
    console.log(JSON.stringify({ phase: 'real failure and explicit retry recovered', userMessages: 3 }));
    for (const text of ['1', '1 пост', 'Без подпостов', '3 человека']) await say(text);
    const post = object(task).sectors[0].posts[0];
    expect(post.subpostCount).toBe(0); expect(post.need).toBe(3);
    expect(task.guidance!.current!.field).toBe('checklistResult');
    const question = task.guidance!.current!.id;
    await say('да'); expect(task.guidance!.current!.id).toBe(question);
    expect(object(task).checklistResults || []).toEqual([]);
    await say('Есть замечание'); expect(task.guidance!.current!.field).toBe('checklistComment');
    await say('Не проверен'); expect(task.canContinue).toBe(false);
    expect(object(task).checklistResults).toEqual([{ id: 'checklist-0', state: 'UNCHECKED', comment: '' }]);
    for (let index = 0; index < 5; index += 1) await say('Норма');
    expect(task.guidance!.current!.field).toBe('protectedPersons');
    await say('800');
    expect(String(task.plan.briefing!.protectedPersons[0].personId)).toBe(String(fixture.protectedPerson.id));
    expect(task.guidance!.current).toBeNull(); expect(task.guidance!.deferred).toBe(1);
    expect(task.canContinue).toBe(false);
    const beforeResume = writes.length;
    await conversation.getByRole('button', { name: 'Вернуться к отложенным вопросам', exact: true }).click();
    expect(writes).toHaveLength(beforeResume);
    await say('Вернуться к отложенным вопросам', 'ready', true);
    expect(task.guidance!.current!.id).toBe(chiefQuestion.id);
    await say('Улан Мусахан');
    expect(String(object(task).chiefEmployeeId)).toBe(String(fixture.chief.id));
    expect(task.guidance!.remaining).toBe(0); expect(task.guidance!.deferred).toBe(0);
    expect(task.canContinue).toBe(true);
    expect(task.plan.title).toBe(fixture.title); expect(task.plan.businessDate).toBe(fixture.businessDate);
    expect(task.plan.kind).toBe('INTERNAL'); expect(task.plan.personnelTotal).toBeNull();
    const storedUserKeys = writes.filter(write => write.path === endpoint || write.path === `${endpoint}${taskId}/messages/`)
      .map(write => String(write.body.requestKey));
    assertStoredDialogue(task, fixture, [initial, ...answers], storedUserKeys);
    await expect(page.getByRole('button', { name: 'Создать ОМ от своего имени', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Создать ОМ от своего имени', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(messageIndex).toBe(17); expect(writes).toHaveLength(19);
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
    expect(trace.filter(row => row.status >= 400)).toEqual([]);
    const afterDialogue = capture('database-after-dialogue.json');
    expect(afterDialogue).toEqual(beforeDialogue);
    save('final-task.json', await (await api.get(endpoint + taskId + '/')).json());
    await testInfo.attach('mobile-ready', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    save('receipt.json', { complete: true, taskId, userMessages: 18, sameTask: true, saveMilliseconds,
      browserExecuted: true, businessApisMocked: false, realWorker: true, liveModelUsed: false,
      noExecutionActionSent: true, nonDialogueTablesPreserved: Object.keys(beforeDialogue.tables).length, checks, errors, blocked, writes, requests: trace });
    const continuationPath = `${endpoint}${taskId}/continue/`;
    const beforeDenied = capture('database-before-denied-continuation.json');
    const denied = await observerApi.post(continuationPath, { data: {} });
    expect(denied.status()).toBe(403);
    save('observer-continuation-refused.json', { actorId: fixture.users.observer.id, status: denied.status(), body: await denied.json() });
    expect(capture('database-after-denied-continuation.json')).toEqual(beforeDenied);
    const beforeExecution = capture('database-before-execution.json');
    expect(beforeExecution.tables.ops_security_events.rows).toBe(0);
    expect(beforeExecution.tables.ops_security_event_visit_objects.rows).toBe(0);
    expect(beforeExecution.tables.ops_assistant_receipts.rows).toBe(0);
    continuationAllowed = true;
    const executing = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === continuationPath);
    await page.getByRole('button', { name: 'Создать ОМ от своего имени', exact: true }).click();
    const executedResponse = await executing;
    expect(executedResponse.status()).toBe(200);
    expect(executedResponse.request().postDataJSON()).toEqual({});
    const executed = await executedResponse.json() as AssistantTask;
    save('executed-task.json', executed);
    expect(executed.event).not.toBeNull();
    expect(executed.receipts.filter(row => row.operation === 'create_bulletin')).toHaveLength(1);
    expect(executed.receipts.every(row => row.executedBy === String(fixture.users.owner.id))).toBe(true);
    expect(executed.receipts.some(row => row.operation === 'send_allocations')).toBe(false);
    expect(executed.receipts.map(row => row.operation).sort()).toEqual(['create_bulletin', `briefing:object:${fixture.object.id}:chief`].sort());
    expect(executed.plan.briefingPending).toEqual([expect.objectContaining({ objectId: String(fixture.object.id), action: 'recon' })]);
    const eventPath = `/api/ops/security-events/${executed.event!.id}/`;
    const eventResponse = await api.get(eventPath);
    expect(eventResponse.status()).toBe(200);
    const event = await eventResponse.json() as SecurityEvent; save('event-after-execution.json', event);
    expect(event.title).toBe(fixture.title);
    expect(event.businessDate).toBe(fixture.businessDate);
    expect(event.visitObjects).toHaveLength(1);
    expect(String(event.visitObjects[0].objectId)).toBe(String(fixture.object.id));
    assertCreatedEvent(event, executed, fixture);
    const afterExecution = capture('database-after-execution.json', true);
    expect(afterExecution.tables.ops_assistant_receipts.rows).toBe(2);
    const persisted = afterExecution.taskAudit;
    if (!persisted) throw new Error('Persisted task audit is missing.');
    expect(persisted.taskId).toBe(taskId); expect(persisted.initiatedBy).toBe(String(fixture.users.owner.id));
    expect(persisted.eventId).toBe(event.id); expect(persisted.revision).toBe(task.revision);
    expect(persisted.userMessages.map(message => message.text)).toEqual([initial, ...answers]);
    expect(persisted.userMessages.map(message => message.requestKey)).toEqual(storedUserKeys);
    expect(persisted.assistantMessages).toBe(19);
    expect(persisted.briefing).toEqual(task.plan.briefing);
    expect(persisted.committedBriefing).toEqual(persisted.briefing);
    expect(persisted.receipts).toEqual([`briefing:object:${fixture.object.id}:chief`, 'create_bulletin'].sort()
      .map(operation => ({ operation, executedBy: String(fixture.users.owner.id) })));
    const changedTables = Object.keys(beforeExecution.tables).filter(name => JSON.stringify(beforeExecution.tables[name]) !== JSON.stringify(afterExecution.tables[name]));
    const allowedTables = new Set(['ops_security_events', 'ops_security_event_visit_objects', 'ops_security_events_protected_persons', 'ops_security_event_transitions', 'ops_assistant_receipts']);
    expect(changedTables.sort()).toEqual([...allowedTables].sort());
    expect(afterExecution.tables.ops_security_events.rows).toBe(1);
    expect(afterExecution.tables.ops_security_event_visit_objects.rows).toBe(1);
    const replayResponse = await api.post(continuationPath, { data: {} });
    expect(replayResponse.status()).toBe(200);
    const replay = await replayResponse.json() as AssistantTask; save('replayed-task.json', replay);
    const comparable = (value: AssistantTask) => { const copy = structuredClone(value); delete (copy as Partial<AssistantTask>).updatedAt; return copy; };
    expect(comparable(replay)).toEqual(comparable(executed));
    expect(await (await api.get(eventPath)).json()).toEqual(event);
    expect(capture('database-after-replay.json', true)).toEqual(afterExecution);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Переписка по поручению', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать ОМ от своего имени', exact: true })).toHaveCount(0);
    await expect(page.getByText(executed.event!.code, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ожидают выполнения', exact: true })).toBeVisible();
    await expect(page.getByText('Запросы ещё не отправлены.', { exact: false })).toBeVisible();
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
    expect(writes).toHaveLength(20);
    const beforeExecutionProof = saved['receipt.json'] as { writes: UiWrite[]; noExecutionActionSent: boolean };
    expect(beforeExecutionProof.noExecutionActionSent).toBe(true);
    expect(beforeExecutionProof.writes).toHaveLength(19);
    expect(beforeExecutionProof.writes.some(write => write.path.endsWith('/continue/'))).toBe(false);
    expect(trace.filter(row => row.status >= 400)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await testInfo.attach('mobile-created', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    save('execution-receipt.json', { complete: true, taskId, eventId: executed.event!.id, userMessages: 18,
      actualUiConfirmation: true, exactUiContinuationBody: {}, revisionBefore: task.revision,
      ownerId: fixture.users.owner.id, observerId: fixture.users.observer.id, observerContinuationStatus: denied.status(),
      noExecutionBeforeExplicitConfirmation: true, replayPreservedAllNonDialogueTables: true,
      replayTaskUnchangedExceptTimestamp: true, changedTables, otherTablesPreserved: Object.keys(beforeExecution.tables).length - changedTables.length,
      executionReceipts: executed.receipts, briefingPending: executed.plan.briefingPending,
      events: 1, visits: 1, forceSendReceipts: 0, writes, requests: trace, errors, blocked,
      realBrowser: true, businessApisMocked: false, realRedisCelery: true, liveModelUsed: false });
    console.log(JSON.stringify({ complete: true, taskId, userMessages: 18, writes: writes.length, requests: trace.length }));
  } catch (error) {
    save('failure.json', { error: String(error), taskId, messageIndex, errors, blocked, writes, requests: trace });
    if (page) {
      save('failure-view.json', { text: await page.locator('body').innerText().catch(() => 'unavailable') });
      await testInfo.attach('failure-view', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' }).catch(() => {});
    }
    throw error;
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
    }
    if (observerApi) await observerApi.dispose();
    if (api) await api.dispose();
    if (context) await context.close();
  }
});
