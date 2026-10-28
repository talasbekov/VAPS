import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect, request, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { AssessmentInput, QualificationAssessment, QualificationsResponse } from '@/entities/service-employee/qualifications';
import type { EmployeeServiceProfile, ServiceProfileResponse } from '@/entities/service-employee/service-profile';

type Role = 'editor' | 'reader' | 'foreign_editor' | 'self';
type Person = 'own' | 'foreign' | 'self';
interface FixtureActor { id: number; username: string; role: string | null; scope: number | null; grantId: number | null; permissions: string[] }
interface Fixture {
  database: string; origin: string; standMarker: string; runId: string; today: string; tomorrow: string;
  users: Record<Role, FixtureActor>;
  people: Record<Person, { id: number; name: string; divisionId: number }>;
  divisions: { departmentA: number; departmentB: number; own: number; foreign: number };
  legacyProfile: Omit<EmployeeServiceProfile, 'updated_at'>; legacyRevision: number;
  assessments: AssessmentInput[]; superusers: number; staffUsers: number; qualificationCount: number;
}
interface Fingerprint {
  complete: boolean; readOnly: boolean; database: string; standMarker: string;
  tables: Record<string, { rows: number; sha256: string }>; auditTables: string[]; businessTables: string[];
}
interface UiWrite { role: Role; method: string; path: string; body: Record<string, unknown>; phase: string }
interface QualificationAudit {
  complete: boolean; readOnly: boolean; phase: string; database: string; standMarker: string;
  qualifications: number; profileRevision: number; fixtureWithdrawals: number;
  records: { id: string; skill: string; score: number; assessed_on: string; valid_until: string | null;
    recorded_by: string; request_key: string; request_hash: string; created_at: string }[];
}
function readFixture(origin: string): Fixture {
  const data = JSON.parse(fs.readFileSync(process.env.QUALIFICATION_ACCEPTANCE_FIXTURE_PATH as string, 'utf8')) as Fixture;
  const roles = ['editor', 'reader', 'foreign_editor', 'self'] as const;
  const people = ['own', 'foreign', 'self'] as const;
  const divisions = ['departmentA', 'departmentB', 'own', 'foreign'] as const;
  const positiveId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  const stamp = Date.parse(data?.today + 'T00:00:00Z');
  if (!/^qualification-browser-[a-f0-9]{10}$/.test(data?.standMarker) ||
      data.database !== 'sj_qualification_acceptance_' + data.standMarker.replaceAll('-', '_') || data.origin !== origin ||
      !/^[a-f0-9]{32}$/.test(data.runId) || data.superusers !== 0 || data.staffUsers !== 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.today) || !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== data.today ||
      !roles.every(role => positiveId(data.users?.[role]?.id) &&
        data.users[role].username === `qa_qualification_${data.runId}_${role}` && Array.isArray(data.users[role].permissions)) ||
      !people.every(person => positiveId(data.people?.[person]?.id) && positiveId(data.people[person].divisionId)) ||
      !divisions.every(division => positiveId(data.divisions?.[division])) || !Array.isArray(data.assessments)) {
    throw new Error('Expected exact origin/stand-bound qualification fixture metadata and four synthetic actors.');
  }
  expect(new Set(roles.map(role => data.users[role].id)).size).toBe(4);
  expect(new Set(people.map(person => data.people[person].id)).size).toBe(3);
  expect(new Set(divisions.map(division => data.divisions[division])).size).toBe(4);
  const expectedPermissions: Record<Role, string[]> = {
    editor: ['personnel.view', 'orgstructure.manage', 'admin.roles'], reader: ['personnel.view'],
    foreign_editor: ['personnel.view', 'orgstructure.manage', 'admin.roles'], self: [],
  };
  for (const role of roles) {
    const actor = data.users[role];
    expect([...actor.permissions].sort()).toEqual([...expectedPermissions[role]].sort());
    if (role === 'self') {
      expect(actor.role).toBeNull(); expect(actor.scope).toBeNull(); expect(actor.grantId).toBeNull();
    } else {
      expect(actor.role).toBe(`QA_QUAL_${data.runId.slice(0, 12).toUpperCase()}_${role.toUpperCase()}`);
      expect(actor.scope).toBe(role === 'foreign_editor' ? data.divisions.departmentB : data.divisions.departmentA);
      expect(positiveId(actor.grantId)).toBe(true);
    }
  }
  expect(new Set(['editor', 'reader', 'foreign_editor'].map(role => data.users[role as Role].grantId)).size).toBe(3);
  expect(data.people.own.divisionId).toBe(data.divisions.own);
  expect(data.people.foreign.divisionId).toBe(data.divisions.foreign);
  expect(data.people.self.divisionId).toBe(data.divisions.foreign);
  expect(data.people.own.name).toBe('УчебныйКвалификацияА Тест');
  expect(data.people.foreign.name).toBe('УчебныйКвалификацияБ Тест');
  expect(data.people.self.name).toBe('УчебныйЛичныйПрофиль Тест');
  expect(data.qualificationCount).toBe(0); expect(data.legacyRevision).toBe(1);
  expect(data.legacyProfile).toEqual({inventory:null,skills:{shooting:5,hand_to_hand:3,physical_fitness:null},
    health:{condition:null,chronic_conditions:null,restrictions:null},height_cm:180,weight_kg:75});
  const day = (offset: number) => new Date(stamp + offset * 86_400_000).toISOString().slice(0, 10);
  expect(data.tomorrow).toBe(day(1));
  expect(data.assessments).toEqual([
    {skill:'shooting',score:4,assessed_on:day(-1),valid_until:day(0),basis:'Учебная ведомость актуальной проверки'},
    {skill:'shooting',score:3,assessed_on:day(-10),valid_until:day(-1),basis:'Учебная ведомость более ранней проверки'},
    {skill:'hand_to_hand',score:2,assessed_on:day(-2),valid_until:day(-1),basis:'Учебная ведомость с истёкшим сроком'},
    {skill:'physical_fitness',score:3,assessed_on:day(0),valid_until:null,basis:'Учебная ведомость без срока действия'},
  ]);
  return data;
}

// Read metadata only. Never inspect/output container environment or use a name
// resolved through a mutable alias. The SQL helper repeats exact DB binding.
function ownedBackend(fixture: Fixture): string {
  const identity = process.env.QUALIFICATION_ACCEPTANCE_BACKEND_CONTAINER || '';
  if (!/^[a-f0-9]{64}$/.test(identity)) throw new Error('A full owned backend container ID is required.');
  const format = '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Labels":{{json .Config.Labels}}},"State":{"Running":{{json .State.Running}}},"HostConfig":{"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"PortBindings":{{json .HostConfig.PortBindings}}},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}}}';
  const info = JSON.parse(execFileSync('docker', ['inspect', '--format', format, identity], { encoding: 'utf8' }));
  expect(info.Id).toBe(identity);
  expect(info.Name).toBe('/sj-' + fixture.standMarker + '-backend');
  expect(info.Config.Labels?.verification).toBe(fixture.standMarker);
  expect(info.State.Running).toBe(true);
  expect(info.HostConfig.ReadonlyRootfs).toBe(true);
  expect(Object.keys(info.HostConfig.PortBindings || {})).toEqual([]);
  expect(Object.keys(info.NetworkSettings.Networks)).toEqual(['sj-' + fixture.standMarker]);
  const network = info.NetworkSettings.Networks['sj-' + fixture.standMarker].NetworkID as string;
  if (!/^[a-f0-9]{64}$/.test(network)) throw new Error('Owned internal network ID missing.');
  const networkFormat = '{"Id":{{json .Id}},"Internal":{{json .Internal}},"Labels":{{json .Labels}}}';
  const metadata = JSON.parse(execFileSync('docker', ['network', 'inspect', '--format', networkFormat, network], { encoding: 'utf8' }));
  expect(metadata.Id).toBe(network);
  expect(metadata.Internal).toBe(true);
  expect(metadata.Labels?.verification).toBe(fixture.standMarker);
  return identity;
}


function assertAuditedRecords(audit: QualificationAudit, fixture: Fixture, created: QualificationAssessment[], writes: UiWrite[]) {
  expect(audit.complete).toBe(true); expect(audit.readOnly).toBe(true);
  expect(audit.qualifications).toBe(4); expect(audit.profileRevision).toBe(fixture.legacyRevision + 5);
  expect(audit.fixtureWithdrawals).toBe(1);
  expect(audit.phase).toBe('final'); expect(audit.database).toBe(fixture.database);
  expect(audit.standMarker).toBe(fixture.standMarker);
  expect(audit.records).toHaveLength(4); expect(created).toHaveLength(4); expect(writes).toHaveLength(6);
  for (const [index, row] of audit.records.entries()) {
    const api = created[index], post = writes[index + 1];
    expect(post).toMatchObject({role:'editor',method:'POST',path:`/api/core/service-employees/${fixture.people.own.id}/qualifications/`});
    expect(row).toMatchObject({id:api.id,skill:api.skill,score:api.score,assessed_on:api.assessed_on,
      valid_until:api.valid_until,recorded_by:api.recorded_by,created_at:api.created_at,request_key:post.body.request_key});
    expect(row.request_hash).toMatch(/^[a-f0-9]{64}$/);
  }
}

function assertQualifiedHistory(current: QualificationsResponse, fixture: Fixture, created: QualificationAssessment[]) {
  expect(current.revision).toBe(fixture.legacyRevision + 5); expect(current.history.count).toBe(4);
  expect(current.can_edit).toBe(true); expect(current.today).toBe(fixture.today);
  expect(current.history.page).toBe(1); expect(current.history.page_size).toBe(20);
  expect(created).toHaveLength(4);
  expect(new Set(created.map(row => row.id)).size).toBe(4);
  for (const [index, row] of created.entries()) {
    expect(Object.keys(row).sort()).toEqual(['id','skill','score','assessed_on','valid_until','basis',
      'recorded_by','recorded_by_name','created_at'].sort());
    expect(row).toMatchObject({...fixture.assessments[index],recorded_by:String(fixture.users.editor.id),
      recorded_by_name:fixture.users.editor.username});
    expect(row.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Number.isFinite(Date.parse(row.created_at))).toBe(true);
  }
  expect(current.history.results).toEqual([created[3],created[0],created[2],created[1]]);
  expect(current.current).toEqual({shooting:{state:'valid',assessment:created[0]},
    hand_to_hand:{state:'expired',assessment:created[2]},physical_fitness:{state:'unknown',assessment:created[3]}});
}

test('real qualifications: persistent history, exact replay and late permission withdrawal', async ({browser,baseURL},testInfo) => {
  const origin = baseURL as string;
  const fixture = readFixture(origin);
  const backend = ownedBackend(fixture);
  const password = process.env.QUALIFICATION_ACCEPTANCE_PASSWORD as string;

  const employee = fixture.people.own.id;
  const qualificationPath = `/api/core/service-employees/${employee}/qualifications/`;
  const profilePath = `/api/core/service-employees/${employee}/service-profile/`;
  const detailPath = `/api/core/service-employees/${employee}/`;
  const knownDeniedPaths = new Set([qualificationPath, profilePath, detailPath]);
  const saved: Record<string, unknown> = {};
  const save = (name: string, value: unknown) => { saved[name] = structuredClone(value); };
  const contexts: BrowserContext[] = [], apis = {} as Record<Role, APIRequestContext>, pages: Record<string, Page> = {};
  const writes: UiWrite[] = [], blocked: Record<string, unknown>[] = [], errors: Record<string, unknown>[] = [];
  const expectedConsole: Record<string, unknown>[] = [], trace: { role: Role; path: string; method: string; status: number; phase: string }[] = [];
  const checks: Record<string, unknown>[] = [];
  let phase = 'initial', assessmentIndex = 0, profileSaved = false, revoked = false;
  function capture(name: string): Fingerprint {
    const stdout = execFileSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
      '-e', 'QUALIFICATION_ACCEPTANCE_READ=1', '-e', 'QUALIFICATION_ACCEPTANCE_DATABASE=' + fixture.database,
      '-e', 'QUALIFICATION_ACCEPTANCE_STAND_MARKER=' + fixture.standMarker, backend, 'python', '-'],
    { input: fs.readFileSync(path.join(testInfo.config.rootDir, 'fixtures/qualification-acceptance-fingerprint.py')),
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const value = JSON.parse(stdout) as Fingerprint;
    expect(value.complete).toBe(true); expect(value.database).toBe(fixture.database);
    expect(value.standMarker).toBe(fixture.standMarker); expect(value.readOnly).toBe(true);
    save(name, value); return value;
  }
  const domain = (value: Fingerprint) => Object.fromEntries(Object.entries(value.tables).filter(([name]) => !value.auditTables.includes(name)));
  const freshKey = () => crypto.randomUUID();
  function revoke() {
    const stdout = execFileSync('docker', ['exec', '-i', '-e', 'QUALIFICATION_ACCEPTANCE_REVOKE=1',
      '-e', 'FIXTURE_METADATA=' + JSON.stringify(fixture), backend, 'python', '-'],
    { input: fs.readFileSync(path.join(testInfo.config.rootDir, 'fixtures/revoke-qualification-acceptance.py')),
      encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const value = JSON.parse(stdout);
    expect(value.complete).toBe(true); expect(value.grantId).toBe(fixture.users.editor.grantId);
    expect(value.qualificationAndProfileStatePreserved).toBe(true);
    save('fixture-role-withdrawal.json', value); revoked = true; phase = 'revoked';
    return capture('after-fixture-withdrawal.json');
  }
  function audit(created: QualificationAssessment[]) {
    const stdout = execFileSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
      '-e', 'QUALIFICATION_ACCEPTANCE_READ=1', '-e', 'QUALIFICATION_ACCEPTANCE_AUDIT_PHASE=final',
      '-e', 'FIXTURE_METADATA=' + JSON.stringify(fixture), '-e', 'QUALIFICATION_ACCEPTANCE_UI_WRITES=' + JSON.stringify(writes),
      backend, 'python', '-'], { input: fs.readFileSync(path.join(testInfo.config.rootDir, 'fixtures/qualification-acceptance-audit.py')),
        encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const value = JSON.parse(stdout) as QualificationAudit;
    assertAuditedRecords(value, fixture, created, writes); save('database-audit.json', value);
  }
  function watch(page: Page, role: Role) {
    page.on('pageerror', error => errors.push({ role, message: error.message }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const location = message.location().url;
      let pathname;
      try { pathname = new URL(location).pathname; } catch { pathname = ''; }
      const entry = { role, text: message.text(), url: location, phase };
      if (role === 'editor' && revoked && knownDeniedPaths.has(pathname) && /(?:403|404)/.test(message.text())) expectedConsole.push(entry);
      else errors.push(entry);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) trace.push({ role, path: url.pathname,
        method: response.request().method(), status: response.status(), phase });
    });
  }
  async function fence(context: BrowserContext, role: Role) {
    await context.route('**/api/**', async route => {
      const req = route.request(), address = new URL(req.url()), pathname = address.pathname;
      if (address.origin === origin && (pathname.startsWith('/api/auth/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method()))) return route.continue();
      try {
        expect(address.origin).toBe(origin); expect(role).toBe('editor');
        const body = req.postDataJSON() as Record<string, unknown>;
        if (pathname === profilePath && req.method() === 'PUT') {
          expect(profileSaved).toBe(false); expect(assessmentIndex).toBe(0); expect(phase).toBe('profile');
          expect(body).toEqual({ revision: fixture.legacyRevision, profile: { ...fixture.legacyProfile, height_cm: 181 } });
          profileSaved = true;
        } else {
          expect(pathname).toBe(qualificationPath); expect(req.method()).toBe('POST'); expect(profileSaved).toBe(true);
          expect(body.request_key).toMatch(/^[a-f0-9-]{36}$/);
          expect(writes.some(row => row.body.request_key === body.request_key)).toBe(false);
          if (phase === 'assessments') {
            expect(assessmentIndex).toBeLessThan(4);
            expect(body).toEqual({ ...fixture.assessments[assessmentIndex], revision: fixture.legacyRevision + 1 + assessmentIndex, request_key: body.request_key });
            assessmentIndex += 1;
          } else {
            expect(phase).toBe('withdrawal'); expect(assessmentIndex).toBe(4); expect(revoked).toBe(false);
            expect(body).toEqual({ revision: fixture.legacyRevision + 5, request_key: body.request_key, skill: 'shooting', score: 1,
              assessed_on: fixture.today, valid_until: null, basis: 'Учебная проверка после отзыва' });
            revoke();
          }
        }
        writes.push({ role, method: req.method(), path: pathname, body, phase });
        return route.continue();
      } catch (error) {
        blocked.push({ role, method: req.method(), path: pathname, error: String(error) });
        return route.abort('blockedbyclient');
      }
    });
  }
  async function loginPage(browser: Browser, role: Role) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU',
      timezoneId: 'Asia/Qyzylorda', serviceWorkers: 'block' });
    contexts.push(context); await fence(context, role);
    const csrf = await (await context.request.get('/api/auth/csrf/')).json();
    const login = await context.request.post('/api/auth/callback/credentials/', { form: {
      csrfToken: csrf.csrfToken, username: fixture.users[role].username, password, json: 'true',
    } });
    expect(login.status()).toBe(200); expect((await login.json()).url).not.toContain('error=');
    const session = await (await context.request.get('/api/auth/session/')).json();
    expect(session.error).toBeUndefined(); expect(session.user.name).toBe(fixture.users[role].username);
    const page = await context.newPage(); pages[role] = page; watch(page, role);
    await page.goto(`/security-ops/profile/${employee}/?directory=1`);
    await expect(page.getByRole('region', { name: 'Квалификация сотрудника', exact: true })).toBeVisible();
    return page;
  }
  async function fillAssessment(page: Page, data: AssessmentInput) {
    const section = page.getByRole('region', { name: 'Квалификация сотрудника', exact: true });
    const open = section.getByRole('button', { name: 'Записать проверку', exact: true });
    await expect(open).toBeEnabled(); await open.click();
    await section.getByRole('combobox', { name: 'Навык', exact: true }).selectOption(data.skill);
    await section.getByRole('combobox', { name: 'Оценка', exact: true }).selectOption(String(data.score));
    await section.getByLabel('Дата проверки', { exact: true }).fill(data.assessed_on);
    await section.getByLabel('Действует по (необязательно)', { exact: true }).fill(data.valid_until || '');
    await section.getByRole('textbox', { name: 'Основание (документ, проверяющий)', exact: true }).fill(data.basis);
    return section;
  }

  try {
    for (const role of (['editor', 'reader', 'foreign_editor', 'self'] as const)) {
      let api = await request.newContext({ baseURL: origin }); apis[role] = api;
      const response = await api.post('/api/token/', { data: { username: fixture.users[role].username, password } });
      expect(response.status()).toBe(200); const access = (await response.json()).access;
      const claims = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8'));
      expect(String(claims.user_id)).toBe(String(fixture.users[role].id));
      await api.dispose(); api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: 'Bearer ' + access } });
      apis[role] = api;
      const rights = await (await api.get('/api/operations/my-permissions/')).json();
      expect(rights.permissions.sort()).toEqual([...fixture.users[role].permissions].sort()); expect(rights.global_permissions).toEqual([]);
      if (fixture.users[role].role) expect(rights.roles).toEqual([expect.objectContaining({ code: fixture.users[role].role, scope_division_id: fixture.users[role].scope })]);
      else expect(rights.roles).toEqual([]);
    }
    const targets: Record<Role, Person> = { editor: 'own', reader: 'own', foreign_editor: 'foreign', self: 'self' };
    const accessProof: Record<string, unknown> = {};
    for (const role of Object.keys(targets) as Role[]) {
      const person = targets[role], id = fixture.people[person].id;
      const response = await apis[role].get(`/api/core/service-employees/${id}/qualifications/`);
      expect(response.status()).toBe(200);
      const value = await response.json() as QualificationsResponse;
      expect(value.history.count).toBe(0); expect(value.today).toBe(fixture.today);
      expect(value.can_edit).toBe(role === 'editor' || role === 'foreign_editor');
      for (const skill of Object.values(value.current)) expect(skill).toEqual({state:'unknown', assessment:null});
      const result = await apis[role].get(`/api/core/service-employees/${id}/service-profile/`);
      expect(result.status()).toBe(200);
      const profile = await result.json() as ServiceProfileResponse;
      if (person === 'own') {
        expect(profile.revision).toBe(fixture.legacyRevision); expect(profile.profile.skills).toEqual(fixture.legacyProfile.skills);
      }
      accessProof[role] = { qualifications:value, profile };
    }
    save('initial-actor-access.json', accessProof);
    const initial = capture('before-scope-denials.json');
    const scopeCases: [Role, Person, 'GET' | 'POST', number][] = [
      ['reader','own','POST',403], ['editor','foreign','GET',404], ['editor','foreign','POST',404],
      ['foreign_editor','own','POST',404], ['self','self','POST',403], ['self','own','GET',404],
    ];
    const scopeDenials: Record<string, unknown>[] = [];
    for (const [role, person, method, status] of scopeCases) {
      const endpoint = `/api/core/service-employees/${fixture.people[person].id}/qualifications/`;
      const response = method === 'GET' ? await apis[role].get(endpoint) : await apis[role].post(endpoint, {data:{
        ...fixture.assessments[0], revision: person === 'own' ? fixture.legacyRevision : 0, request_key:freshKey(),
      }});
      expect(response.status()).toBe(status); scopeDenials.push({role,person,method,status,body:await response.json()});
    }
    const afterScopes = capture('after-scope-denials.json');
    expect(domain(afterScopes)).toEqual(domain(initial));
    expect(afterScopes.tables.ops_employee_qualifications.rows).toBe(0);
    expect(afterScopes.tables.employee_service_profiles.rows).toBe(1);
    save('scope-denials.json', scopeDenials);
    const readerPage = await loginPage(browser, 'reader');
    const editorPage = await loginPage(browser, 'editor');
    const readerSection = readerPage.getByRole('region', { name: 'Квалификация сотрудника', exact: true });
    const editorSection = editorPage.getByRole('region', { name: 'Квалификация сотрудника', exact: true });
    await expect(readerSection.getByText('5 / 5 · без записи о проверке', { exact: true })).toBeVisible();
    await expect(readerSection.getByRole('button', { name: 'Записать проверку', exact: true })).toHaveCount(0);
    await expect(editorSection.getByText('5 / 5 · без записи о проверке', { exact: true })).toBeVisible();
    const before = capture('before-ui-writes.json');
    expect(before.tables.ops_employee_qualifications.rows).toBe(0); expect(before.tables.employee_service_profiles.rows).toBe(1);
    phase = 'profile';
    await editorPage.getByRole('button', { name: 'Редактировать личный профиль', exact: true }).click();
    await expect(editorSection.getByRole('button', { name: 'Записать проверку', exact: true })).toBeDisabled();
    await editorPage.getByLabel('Рост, см', { exact: true }).fill('181');
    const profileSaving = editorPage.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === profilePath);
    await editorPage.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    const profileResponse = await profileSaving; expect(profileResponse.status()).toBe(200);
    const updated = await profileResponse.json(); save('profile-put.json', updated);
    expect(updated.revision).toBe(fixture.legacyRevision + 1); expect(updated.profile.height_cm).toBe(181);
    expect(updated.profile.skills).toEqual(fixture.legacyProfile.skills);
    await expect(editorPage.getByText('Профиль сохранён.', { exact: true })).toBeVisible();
    await expect(editorSection.getByRole('button', { name: 'Записать проверку', exact: true })).toBeEnabled();
    expect((await (await apis.editor.get(qualificationPath)).json()).history.count).toBe(0);
    phase = 'assessments'; const created: QualificationAssessment[] = [];
    for (let index = 0; index < 4; index += 1) {
      const data = fixture.assessments[index];
      const section = await fillAssessment(editorPage, data);
      const saving = editorPage.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === qualificationPath);
      await section.getByRole('button', { name: 'Сохранить проверку', exact: true }).click();
      const response = await saving; expect(response.status()).toBe(201);
      const value = await response.json() as QualificationsResponse; save(`assessment-${index + 1}.json`, value);
      expect(value.revision).toBe(fixture.legacyRevision + 2 + index); expect(value.history.count).toBe(index + 1);
      const row = value.history.results.find(row => row.basis === data.basis);
      if (!row) throw new Error('Saved assessment missing from its actual response.');
      expect(row).toMatchObject({ ...data, recorded_by: String(fixture.users.editor.id), recorded_by_name: fixture.users.editor.username });
      expect(row.id).toMatch(/^[a-f0-9-]{36}$/); created.push(row);
      expect(value.current.shooting.assessment?.id).toBe(created[0].id); expect(value.current.shooting.assessment?.score).toBe(4);
      expect(value.current.shooting.state).toBe('valid');
      await expect(section.getByRole('button', { name: 'Записать проверку', exact: true })).toBeEnabled();
      await expect(section.getByText('4 / 5 · Срок не истёк', { exact: true })).toBeVisible();
      if (index === 0) {
        await expect(section.getByText(data.basis, { exact: true })).not.toBeVisible();
        await section.locator('summary').filter({ hasText: 'История проверок' }).click();
        await expect(section.getByText(data.basis, { exact: true })).toBeVisible();
      }
    }
    const current = await (await apis.editor.get(qualificationPath)).json() as QualificationsResponse; save('current-qualified.json', current);
    assertQualifiedHistory(current, fixture, created);
    const profile = await (await apis.editor.get(profilePath)).json() as ServiceProfileResponse; save('profile-after-assessments.json', profile);
    expect(profile.revision).toBe(current.revision); expect(profile.profile.height_cm).toBe(181); expect(profile.profile.weight_kg).toBe(75);
    expect(profile.profile.skills).toEqual({ shooting: 4, hand_to_hand: 2, physical_fitness: 3 });
    expect(profile.profile.inventory).toEqual(fixture.legacyProfile.inventory); expect(profile.profile.health).toEqual(fixture.legacyProfile.health);
    expect(Number.isFinite(Date.parse(profile.profile.updated_at || ''))).toBe(true);
    await expect(editorSection.getByText('2 / 5 · Истёк срок действия', { exact: true })).toBeVisible();
    await expect(editorSection.getByText('3 / 5 · Не подтверждена актуальность', { exact: true })).toBeVisible();
    const afterValid = capture('after-valid-writes.json');
    const changed = Object.keys(before.tables).filter(name => JSON.stringify(before.tables[name]) !== JSON.stringify(afterValid.tables[name]));
    expect(changed.sort()).toEqual([...before.businessTables].sort());
    expect(writes).toHaveLength(5); expect(afterValid.tables.ops_employee_qualifications.rows).toBe(4);
    save('positive-receipt.json', { complete: true, writes, created, changedTables: changed, current, profile });
    console.log(JSON.stringify({ phase: 'four real assessments and shared profile revision', writes: 5, qualifications: 4, revision: current.revision }));
    const firstWrite = writes.find(row => row.method === 'POST');
    if (!firstWrite) throw new Error('First confirmed assessment body missing.');
    const firstBody = firstWrite.body;
    const replay = await apis.editor.post(qualificationPath, { data: firstBody });
    expect(replay.status()).toBe(200); expect(await replay.json()).toEqual(current);
    expect(domain(capture('after-replay.json'))).toEqual(domain(afterValid));
    const negatives: Record<string, unknown>[] = [];
    const reject = async (method: 'post' | 'put' | 'patch' | 'delete', endpoint: string, body: unknown, status: number, label: string, api = apis.editor) => {
      const response = await api[method](endpoint, body === undefined ? undefined : { data: body });
      const payload = await response.json(); expect(response.status(), label + JSON.stringify(payload)).toBe(status);
      negatives.push({ label, status, payload });
    };
    await reject('post', qualificationPath, { ...firstBody, score: 5 }, 409, 'same key changed payload');
    await reject('post', qualificationPath, { ...firstBody, request_key: freshKey() }, 409, 'stale revision new key');
    const valid = { ...fixture.assessments[0], revision: current.revision, request_key: freshKey() };
    await reject('post', qualificationPath, { ...valid, assessed_on: fixture.tomorrow, valid_until: null }, 400, 'future assessment');
    await reject('post', qualificationPath, { ...valid, recorded_by: String(fixture.users.self.id) }, 400, 'forged author');
    await reject('post', qualificationPath, { ...valid, score: true }, 400, 'boolean score');
    await reject('post', qualificationPath, { ...valid, basis: '' }, 400, 'missing basis');
    const { updated_at, ...profileInput } = profile.profile;
    await reject('put', profilePath, { revision: current.revision, profile: { ...profileInput, skills: { ...profileInput.skills, shooting: 5 } } }, 400, 'verified score override');
    await reject('patch', qualificationPath, {}, 405, 'assessment patch unsupported');
    await reject('delete', qualificationPath, undefined, 405, 'assessment delete unsupported');
    await reject('post', qualificationPath, { ...valid, request_key: freshKey() }, 403, 'reader cannot append', apis.reader);
    await reject('post', qualificationPath, { ...valid, request_key: freshKey() }, 404, 'foreign editor cannot append', apis.foreign_editor);
    expect(domain(capture('after-denials.json'))).toEqual(domain(afterValid)); save('negative-api-checks.json', negatives);
    await editorPage.setViewportSize({ width: 390, height: 1000 });
    await expect.poll(() => editorPage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      { message: 'History must fit after the responsive sidebar transition settles' }).toBeLessThanOrEqual(1);
    const mobileMetrics = await editorPage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    save('mobile-metrics.json', mobileMetrics);
    await testInfo.attach('mobile-history', {body:await editorPage.screenshot({fullPage:true}),contentType:'image/png'});
    await readerPage.reload();
    await expect(readerSection.getByText('4 / 5 · Срок не истёк', { exact: true })).toBeVisible();
    await expect(readerSection.getByRole('button', { name: 'Записать проверку', exact: true })).toHaveCount(0);
    phase = 'withdrawal';
    const deniedDraft: AssessmentInput = { skill: 'shooting', score: 1, assessed_on: fixture.today, valid_until: null, basis: 'Учебная проверка после отзыва' };
    const section = await fillAssessment(editorPage, deniedDraft);
    capture('before-fixture-withdrawal.json');
    const rejected = editorPage.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === qualificationPath);
    await section.getByRole('button', { name: 'Сохранить проверку', exact: true }).click();
    const rejectedResponse = await rejected; expect(rejectedResponse.status()).toBe(403);
    save('revoked-post.json', { status: rejectedResponse.status(), body: await rejectedResponse.json() });
    expect(revoked).toBe(true);
    for (const record of fixture.assessments) await expect(editorPage.getByText(record.basis, { exact: true })).toHaveCount(0);
    await expect(editorPage.getByRole('button', { name: 'Записать проверку', exact: true })).toHaveCount(0);
    const basisField = editorPage.getByRole('textbox', {name:'Основание (документ, проверяющий)',exact:true});
    const saveCheck = editorPage.getByRole('button', {name:'Сохранить проверку',exact:true});
    await expect(basisField).toHaveCount(0); await expect(saveCheck).toHaveCount(0);
    save('revoked-editor-dom.json', {basisTextboxCount:await basisField.count(),saveCheckButtonCount:await saveCheck.count(),
      previousBasisCounts:await Promise.all(fixture.assessments.map(record => editorPage.getByText(record.basis,{exact:true}).count()))});
    const afterRevoke = saved['after-fixture-withdrawal.json'] as Fingerprint;
    expect(domain(capture('after-revoked-post.json'))).toEqual(domain(afterRevoke));
    const retained = await (await apis.reader.get(qualificationPath)).json() as QualificationsResponse; save('reader-retained-history.json', retained);
    expect(retained.can_edit).toBe(false); expect(retained.revision).toBe(current.revision);
    expect(retained.current).toEqual(current.current); expect(retained.history).toEqual(current.history);
    const rights = await (await apis.editor.get('/api/operations/my-permissions/')).json();
    expect(rights.permissions).toEqual([]); expect(rights.roles).toEqual([]); expect(rights.global_permissions).toEqual([]);
    save('revoked-rights.json', rights);
    await testInfo.attach('mobile-revoked', {body:await editorPage.screenshot({fullPage:true}),contentType:'image/png'});
    expect(writes).toHaveLength(6); expect(blocked).toEqual([]); expect(errors).toEqual([]);
    const unexpected = trace.filter(row => row.status >= 400 && !(row.role === 'editor' && row.phase === 'revoked' && knownDeniedPaths.has(row.path) && [403, 404].includes(row.status)));
    expect(unexpected).toEqual([]);
    audit(created);
    save('receipt.json', { complete: true, scopeDenials:scopeDenials.length, businessApisMocked: false, realBrowser: true, realNextAuthJwt: true,
      ordinaryActors: 4, noGlobalGrants: true, profileRevision: current.revision, qualifications: 4,
      legacyInitiallyUnverified: true, olderAssessmentDidNotWin: true, states: ['valid', 'expired', 'unknown'],
      replayCreatedNoRowsOrRevision: true, apiNegativeChecks: negatives.length, editorGrantRevokedBeforeForwarding: true,
      revokedUiPostStatus: 403, privateQualificationDataCleared: true, draftFormRemoved: true, rawAuditApiRowsBound: true, readerHistoryPreserved: true,
      nonAuditTablesPreservedAfterReplayAndDenials: Object.keys(domain(afterValid)).length,
      changedTablesDuringPositiveWrites: changed, expectedFixtureGrantTransitionSeparate: true,
      mobileMetrics,
      writes, requests: trace, errors, blocked, expectedConsole, checks, modelUsed: false });
    console.log(JSON.stringify({ complete: true, qualifications: 4, successfulUiWrites: 5, deniedUiWrites: 1, profileRevision: current.revision, requests: trace.length }));
  } catch (error) {
    save('failure.json', { error: String(error), phase, assessmentIndex, profileSaved, revoked, writes, blocked, errors, expectedConsole, requests: trace });
    for (const [role, page] of Object.entries(pages)) {
      save(role + '-failure-view.json', { text: await page.locator('body').innerText().catch(() => 'unavailable') });
      await testInfo.attach(role + '-failure', {body:await page.screenshot({fullPage:true}),contentType:'image/png'}).catch(() => {});
    }
    throw error;
  } finally {
    for (const api of Object.values(apis)) await api.dispose();
    for (const context of contexts) await context.close();
    for (const [name,value] of Object.entries(saved)) await testInfo.attach(name, {body:JSON.stringify(value,null,2),contentType:'application/json'});
  }
});
