// Isolated Night regression: owned employee saves use actual APIs and UI.
// Physical disposal refuses other databases and unexpected related records.
// The separately labelled permission-loading contract holds an ACTUAL HTTP
// response; it does not prove that a previously populated cache is hidden.
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { runBackendCommand } from './backend-command'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { nativeCombatSmokeDatabase } from './native-combat-smoke'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:18346'
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3347'
const STAFF = '/api/staff_unit/staff-units/directorate/'
const ACCESS = '/api/operations/'
const RIGHTS = ['admin.roles', 'dictionary.view', 'orgstructure.manage', 'orgstructure.view', 'personnel.view', 'status.view']
// Mutations require one complete approved tuple; mixed targets are rejected.
function isolatedDatabase(): string {
  const native = nativeCombatSmokeDatabase(API, APP)
  if (native) return native
  const api = new URL(API)
  const app = new URL(APP)
  const local = (url: URL) => url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/' &&
    !url.username && !url.password && !url.search && !url.hash
  const targets = [
    ['18346', '3347', 'smart-night-20261008-backend-1', 'smart_night_20261008'],
    ['18349', '3350', 'smart-complete-20261008-backend-1', 'smart_complete_20261008'],
    ['18349', '3350', 'smart-refine-20261008-backend-1', 'smart_refine_20261008'],
    ['18351', '3354', 'smart-eight-hours-20261009-backend-1', 'smart_eight_hours_20261009'],
  ]
  const target = targets.find(([apiPort, appPort, container]) =>
    api.port === apiPort && app.port === appPort && process.env.SMOKE_DOCKER_CONTAINER === container)
  if (!local(api) || !local(app) || !target) throw new Error('Refuse mutations outside an approved isolated API/UI/container tuple')
  return target[3]
}

type Headers = { Authorization: string }
interface MyPermissions { permissions: string[]; global_permissions: string[] }
interface Account { id: number; username: string; employee_id: number | null; is_active: boolean }
interface Role { code: string; name: string; description: string; permissions: string[] }
interface Grant { id: number; user_id: string; role_code: string; scope_division_id: number | null; is_active: boolean }
interface StaffRow {
  id: number
  division: { id: number }
  position: { id: number }
  employee: { id: number; first_name: string; last_name: string }
  management: { staff_unit_id: number; callsign: string; user: { id: number; username: string } | null }
}
interface OwnEmployee {
  key: string; username: string; password: string; roleCode: string; roleName: string; roleDescription: string
  iin: string; firstName: string; lastName: string; callsign: string; changedCallsign: string
  accountId?: number; employeeId?: number; slotId?: number; positionId?: number; personnelNumber?: string
}

async function token(request: APIRequestContext, username: string, password: string): Promise<Headers> {
  isolatedDatabase()
  const response = await request.post(`${API}/api/token/`, { data: { username, password } })
  expect(response.status()).toBe(200)
  const body = await response.json() as { access: string }
  expect(body.access).toBeTruthy()
  return { Authorization: `Bearer ${body.access}` }
}

async function signIn(page: Page, own: OwnEmployee): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  expect(csrf.status()).toBe(200)
  const signed = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: (await csrf.json()).csrfToken, username: own.username, password: own.password, json: 'true' },
  })
  expect(signed.status()).toBe(200)
  expect((await signed.json()).url).not.toContain('error=')
}

function ownIdentity(): OwnEmployee {
  const key = randomUUID()
  return {
    key, username: `e2e_employee_account_${key}`, password: randomBytes(24).toString('base64url'),
    roleCode: `E2E_EMP_${key}`, roleName: `Owned employee scope ${key}`, roleDescription: `e2e-employee-account:${key}`,
    // The actual model validator checks exactly twelve digits. UUID names and
    // callsign remain the ownership guard even if this random IIN collides.
    iin: `90${randomInt(0, 10_000_000_000).toString().padStart(10, '0')}`,
    firstName: 'Owned', lastName: `E2E-${key}`, callsign: `OWN-${key}`, changedCallsign: `EDIT-${key}`,
  }
}

async function getJson<T>(request: APIRequestContext, path: string, headers: Headers): Promise<T> {
  const response = await request.get(`${API}${path}`, { headers })
  expect(response.status()).toBe(200)
  return await response.json() as T
}

async function ownAccount(request: APIRequestContext, headers: Headers, own: OwnEmployee): Promise<Account | null> {
  if (own.accountId === undefined) {
    // Recovery after a committed POST whose stdout/body was not captured.
    const body = await getJson<{ results: Account[]; next: string | null }>(request,
      `${ACCESS}accounts/?search=${encodeURIComponent(own.username)}&limit=1000`, headers)
    const exact = body.results.filter(row => row.username === own.username)
    expect(exact.length).toBeLessThanOrEqual(1)
    expect(body.next).toBeNull()
    if (exact.length === 0) return null
    own.accountId = exact[0].id
  }
  const row = await getJson<Account>(request, `${ACCESS}accounts/${own.accountId}/`, headers)
  expect(row).toMatchObject({ id: own.accountId, username: own.username })
  return row
}

async function ownRole(request: APIRequestContext, headers: Headers, own: OwnEmployee): Promise<Role | null> {
  const response = await request.get(`${API}${ACCESS}roles/${own.roleCode}/`, { headers })
  if (response.status() === 404) return null
  expect(response.status()).toBe(200)
  const row = await response.json() as Role
  expect(row).toMatchObject({ code: own.roleCode, name: own.roleName, description: own.roleDescription })
  expect(row.permissions.every(code => RIGHTS.includes(code))).toBe(true)
  return row
}

async function prepare(request: APIRequestContext, admin: Headers, own: OwnEmployee): Promise<Headers> {
  // This draft authorizes management cleanup ONLY on the isolated Night stack.
  // Prevent provisioning on the user's 3345/18345 stand before the first write.
  isolatedDatabase()
  const adminRights = await getJson<MyPermissions>(request, `${ACCESS}my-permissions/`, admin)
  expect(adminRights.global_permissions.some(code => code === '*' || code === 'admin.roles')).toBe(true)
  expect(adminRights.permissions.some(code => code === '*' || code === 'orgstructure.manage')).toBe(true)
  expect(await getJson(request, '/api/core/divisions/2/', admin)).toMatchObject({ id: 2, parent: 1, type_code: 'department' })
  expect(await getJson(request, '/api/core/divisions/3/', admin)).toMatchObject({ id: 3, parent: 2, type_code: 'directorate' })

  const absent = await request.get(`${API}${ACCESS}roles/${own.roleCode}/`, { headers: admin })
  expect(absent.status()).toBe(404)
  const createdAccount = await request.post(`${API}${ACCESS}accounts/`, {
    headers: admin, data: { username: own.username, password: own.password, is_active: true },
  })
  expect(createdAccount.status()).toBe(201)
  const account = await createdAccount.json() as Account
  expect(Number.isSafeInteger(account.id) && account.id > 0).toBe(true)
  own.accountId = account.id
  expect(account).toMatchObject({ username: own.username, employee_id: null, is_active: true })
  const createdRole = await request.post(`${API}${ACCESS}roles/`, {
    headers: admin, data: { code: own.roleCode, name: own.roleName, description: own.roleDescription, is_active: true },
  })
  expect(createdRole.status()).toBe(201)
  expect((await ownRole(request, admin, own))?.permissions).toEqual([])
  const composed = await request.post(`${API}${ACCESS}roles/${own.roleCode}/permissions/`, {
    headers: admin, data: { add: RIGHTS },
  })
  expect(composed.status()).toBe(200)
  expect((await composed.json()).permissions).toEqual(RIGHTS)
  const granted = await request.post(`${API}${ACCESS}user-roles/`, {
    headers: admin, data: { user_id: String(own.accountId), role_code: own.roleCode, scope_division_id: 2 },
  })
  expect(granted.status()).toBe(201)
  expect(await granted.json()).toMatchObject({ user_id: String(own.accountId), role_code: own.roleCode, scope_division_id: 2, is_active: true })

  const positions = await getJson<{ results: { id: number; is_active: boolean }[] }>(request,
    '/api/dictionaries/positions/?limit=1000', admin)
  const position = positions.results.find(row => row.is_active)
  expect(position, 'the real active position catalog is a creation prerequisite').toBeDefined()
  own.positionId = position!.id
  const created = await request.post(`${API}${STAFF}`, {
    headers: admin,
    data: {
      employee_admin: true, atomic: true,
      employees: [{ first_name: own.firstName, last_name: own.lastName, middle_name: '',
        iin: own.iin, callsign: own.callsign, rank: null, user: own.accountId }],
      staff_units: [{ division: 3, position: own.positionId }],
    },
  })
  expect(created.status()).toBe(201)
  const body = await created.json() as {
    success: boolean; errors: unknown; rolled_back: boolean
    created: { employees: { id: number; personnel_number: string }[]; staff_units: { id: number; employee: number; division: number; position: number }[] }
  }
  expect(body).toMatchObject({ success: true, errors: null, rolled_back: false })
  expect(body.created.employees).toHaveLength(1)
  expect(body.created.staff_units).toHaveLength(1)
  own.employeeId = body.created.employees[0].id
  own.personnelNumber = body.created.employees[0].personnel_number
  own.slotId = body.created.staff_units[0].id
  expect(Number.isSafeInteger(own.employeeId) && own.employeeId > 0).toBe(true)
  expect(Number.isSafeInteger(own.slotId) && own.slotId > 0).toBe(true)
  expect(body.created.staff_units[0]).toMatchObject({ employee: own.employeeId, division: 3, position: own.positionId })
  expect(await ownAccount(request, admin, own)).toMatchObject({ employee_id: own.employeeId })
  const actor = await token(request, own.username, own.password)
  const rights = await getJson<MyPermissions>(request, `${ACCESS}my-permissions/`, actor)
  expect(rights.permissions).toEqual(RIGHTS)
  expect(rights.global_permissions).toEqual([])
  // A real unauthorised account read proves this is the nonglobal persona,
  // before browser listeners are installed. It is not a UI route mock.
  const forbidden = await request.get(`${API}${ACCESS}accounts/`, { headers: actor })
  expect(forbidden.status()).toBe(403)
  return actor
}

async function ownStaff(request: APIRequestContext, headers: Headers, own: OwnEmployee): Promise<StaffRow> {
  const body = await getJson<{ staff_units: StaffRow[] }>(request, `${STAFF}?employee_ids=${own.employeeId}`, headers)
  expect(body.staff_units).toHaveLength(1)
  const row = body.staff_units[0]
  expect(row).toMatchObject({ id: own.slotId, division: { id: 3 }, position: { id: own.positionId },
    employee: { id: own.employeeId, first_name: own.firstName, last_name: own.lastName },
    management: { staff_unit_id: own.slotId, user: { id: own.accountId, username: own.username } } })
  return row
}

// Only disposal needs management: there is no public single-transaction API
// which deletes employee + leaf staff slot + its generated status/history.
// Discoveries after partial preparation are bounded by the pre-generated UUID.
const CLEANUP_EMPLOYEE = String.raw`
import json, os
from django.apps import apps
from django.db import connection, transaction
from django.conf import settings
from django.contrib.auth.models import User
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus, StatusChangeHistory
f = json.loads(os.environ['E2E_EMPLOYEE_FIXTURE'])
assert os.environ['E2E_EXPECTED_DB'] in ('smart_night_20261008', 'smart_complete_20261008', 'smart_refine_20261008', 'smart_eight_hours_20261009', 'sj_combat_smoke')
assert connection.settings_dict['NAME'] == os.environ['E2E_EXPECTED_DB'], 'refuse disposal outside the selected isolated database'
if os.environ['E2E_EXPECTED_DB'] == 'sj_combat_smoke':
    assert connection.settings_dict['PORT'] == '15434'
    assert 'smoke-files' in settings.OPS_PRIVATE_STORAGE_ROOT
def reverse_relations(model):
    # related_objects omits hidden reverse FK relations (related_name='+').
    # Those still participate in Django's delete/SET_NULL collection.
    return (field for field in model._meta.get_fields(include_hidden=True)
            if field.auto_created and not field.concrete and field.is_relation)
removed = None
with transaction.atomic():
    people = list(Employee.objects.select_for_update().filter(iin=f['iin'], last_name=f['lastName']))
    assert len(people) <= 1, 'ambiguous UUID employee; preserve all records'
    if people:
        employee = people[0]
        assert f.get('employeeId') in (None, employee.pk)
        assert employee.first_name == f['firstName'] and employee.middle_name == ''
        assert employee.callsign in (f['callsign'], f['changedCallsign'])
        assert employee.user_id in (None, f.get('accountId')), 'foreign linked account; preserve employee'
        assert employee.rank_id is None and employee.is_active and employee.employment_status == 'working'
        assert employee.external_id is None and not employee.photo
        assert f.get('personnelNumber') in (None, employee.personnel_number)
        if employee.user_id is not None:
            assert User.objects.get(pk=employee.user_id).username == f['username']
        slots = list(StaffUnit.objects.select_for_update().filter(employee=employee))
        assert len(slots) == 1
        slot = slots[0]
        assert f.get('slotId') in (None, slot.pk)
        assert slot.division_id == 3 and slot.division.parent_id == 2 and slot.division.parent.parent_id == 1
        assert slot.division.division_type == 'directorate' and slot.division.parent.division_type == 'department'
        assert slot.position_id == f['positionId'] and slot.vacancy_id is None and slot.external_id is None
        assert not slot.get_descendants().exists(), 'never delete another staff child'
        for relation in reverse_relations(StaffUnit):
            assert not relation.related_model.objects.filter(**{relation.field.name: slot}).exists(), 'staff slot has a foreign/history reference'
        statuses = list(EmployeeStatus.objects.select_for_update().filter(employee=employee))
        assert len(statuses) == 1, 'unexpected status history; preserve employee'
        status = statuses[0]
        assert status.status_type == 'in_service' and status.state == 'active'
        assert status.comment == 'Автоматически создан при создании сотрудника'
        assert status.created_by is not None and status.created_by.username == os.environ['E2E_EMPLOYEE_ADMIN']
        assert status.end_date is None and status.actual_end_date is None and status.related_division_id is None
        history = list(StatusChangeHistory.objects.filter(status=status))
        assert len(history) == 1 and history[0].change_type == 'created'
        assert history[0].changed_by_id == status.created_by_id
        for relation in reverse_relations(EmployeeStatus):
            if relation.related_model is StatusChangeHistory and relation.field.name == 'status':
                assert list(relation.related_model.objects.filter(**{relation.field.name: status}).values_list('pk', flat=True)) == [history[0].pk]
                continue
            assert not relation.related_model.objects.filter(**{relation.field.name: status}).exists(), 'status has a foreign/document reference'
        for relation in reverse_relations(Employee):
            if relation.related_model is StaffUnit and relation.field.name == 'employee':
                assert list(StaffUnit.objects.filter(employee=employee).values_list('pk', flat=True)) == [slot.pk]
                continue
            if relation.related_model is EmployeeStatus and relation.field.name == 'employee':
                assert list(EmployeeStatus.objects.filter(employee=employee).values_list('pk', flat=True)) == [status.pk]
                continue
            assert not relation.related_model.objects.filter(**{relation.field.name: employee}).exists(), 'employee has historical/foreign references'
        # Operations also preserve scalar IDs and provenance keys without FK.
        # Include event/object chiefs and force member/assignment/pool history;
        # integer and string fields normalise these two forms through the ORM.
        for model in apps.get_models():
            if model._meta.app_label not in ('operations', 'ops'):
                continue
            for field in model._meta.fields:
                if field.name in ('employee_id', 'chief_employee_id', 'employee_key'):
                    references = model.objects.filter(**{field.name + '__in': [employee.pk, str(employee.pk)]})
                    assert not references.exists(), 'operational employee/provenance reference; preserve fixture'
        removed = {'employeeId': employee.pk, 'slotId': slot.pk, 'statusId': status.pk, 'historyId': history[0].pk}
        status.delete()
        slot.delete()
        employee.delete()
        assert not Employee.objects.filter(pk=removed['employeeId']).exists()
        assert not StaffUnit.objects.filter(pk=removed['slotId']).exists()
        assert not EmployeeStatus.objects.filter(pk=removed['statusId']).exists()
        assert not StatusChangeHistory.objects.filter(pk=removed['historyId']).exists()
    else:
        assert not f.get('employeeId'), 'captured employee unexpectedly missing; preserve other rows'
print('OWN_EMPLOYEE_REMOVED=' + json.dumps({'key': f['key'], 'removed': removed}))
`

async function cleanup(request: APIRequestContext, admin: Headers, own: OwnEmployee, primaryError: unknown): Promise<void> {
  const expectedDatabase = isolatedDatabase()
  const failures: unknown[] = []
  let removed: unknown
  const { password: _password, ...publicIdentity } = own
  try {
    const output = await runBackendCommand(['shell', '-c', CLEANUP_EMPLOYEE], {
      env: { E2E_EMPLOYEE_FIXTURE: JSON.stringify(publicIdentity), E2E_EMPLOYEE_ADMIN: STAND_USERNAME, E2E_EXPECTED_DB: expectedDatabase },
    })
    const line = output.split(/\r?\n/).find(item => item.startsWith('OWN_EMPLOYEE_REMOVED='))
    expect(line, 'management cleanup must report its exact owned identity').toBeDefined()
    const body = JSON.parse(line!.slice('OWN_EMPLOYEE_REMOVED='.length)) as { key: string; removed: unknown }
    expect(body.key).toBe(own.key)
    removed = body.removed
  } catch (error) { failures.push(error) }
  // Every safety step is independent: a refused employee disposal must still
  // revoke/clear/disable only the owned role and owned account.
  try {
    const account = await ownAccount(request, admin, own)
    if (account !== null) {
      const body = await getJson<{ results: Grant[]; next: string | null }>(request,
        `${ACCESS}user-roles/?user_id=${account.id}&limit=1000`, admin)
      expect(body.next).toBeNull()
      expect(body.results.length).toBeLessThanOrEqual(1)
      for (const grant of body.results) {
        expect(grant).toMatchObject({ user_id: String(account.id), role_code: own.roleCode, scope_division_id: 2 })
        const revoked = await request.delete(`${API}${ACCESS}user-roles/${grant.id}/`, { headers: admin })
        expect(revoked.status()).toBe(204)
      }
      const after = await getJson<{ results: Grant[] }>(request, `${ACCESS}user-roles/?user_id=${account.id}&limit=1000`, admin)
      expect(after.results.every(grant => !grant.is_active)).toBe(true)
    }
  } catch (error) { failures.push(error) }
  try {
    const role = await ownRole(request, admin, own)
    if (role !== null) {
      const emptied = await request.post(`${API}${ACCESS}roles/${own.roleCode}/permissions/`, {
        headers: admin, data: { remove: RIGHTS },
      })
      expect(emptied.status()).toBe(200)
      expect((await emptied.json()).permissions).toEqual([])
    }
  } catch (error) { failures.push(error) }
  try {
    if (await ownRole(request, admin, own)) {
      const disabled = await request.patch(`${API}${ACCESS}roles/${own.roleCode}/`, { headers: admin, data: { is_active: false } })
      expect(disabled.status()).toBe(200)
      expect(await disabled.json()).toMatchObject({ code: own.roleCode, is_active: false })
    }
  } catch (error) { failures.push(error) }
  try {
    const account = await ownAccount(request, admin, own)
    if (account !== null) {
      // UUID username + exact captured/recovered PK owns this account even if
      // employee disposal was refused. This PATCH never changes its link.
      const disabled = await request.patch(`${API}${ACCESS}accounts/${account.id}/`, { headers: admin, data: { is_active: false } })
      expect(disabled.status()).toBe(200)
      expect(await disabled.json()).toMatchObject({ id: account.id, username: own.username, is_active: false })
    }
  } catch (error) { failures.push(error) }
  // Never attach own.password, Authorization or tokens.
  await test.info().attach('owned-employee-account-fixture', {
    contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...publicIdentity, recoveredAccountId: own.accountId, removed, cleanupFailures: failures.length }, null, 2)),
  })
  if (failures.length) throw new AggregateError(primaryError === undefined ? failures : [primaryError, ...failures], 'own employee/account cleanup failed')
}

test('live nonglobal employee edit preserves its linked account on unchanged and other-field saves', async ({ page, request }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'requires isolated Night real UI/API')
  const own = ownIdentity()
  const admin = await token(request, STAND_USERNAME, STAND_PASSWORD)
  let primaryError: unknown
  const accountReads: string[] = []
  try {
    const actor = await prepare(request, admin, own)
    expect((await ownStaff(request, actor, own)).management.callsign).toBe(own.callsign)
    await signIn(page, own)
    page.on('request', req => {
      if (req.method() === 'GET' && new URL(req.url()).pathname.startsWith(`${ACCESS}accounts/`)) accountReads.push(req.url())
    })
    await page.goto(`${APP}/service-employees/?search=${encodeURIComponent(own.personnelNumber!)}&edit=${own.employeeId}`)
    for (const change of [false, true]) {
      const dialog = page.getByRole('dialog', { name: 'Изменить сотрудника', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('#staff-callsign')).toHaveValue(own.callsign)
      // Either removal or a disabled field is valid. A selectable account
      // control cannot imply a global operation that this actor cannot read.
      const selector = dialog.locator('#staff-user')
      if (await selector.count()) await expect(selector).toBeDisabled()
      const accountSearch = dialog.locator('#staff-account-search')
      if (await accountSearch.count()) await expect(accountSearch).toBeDisabled()
      if (change) await dialog.locator('#staff-callsign').fill(own.changedCallsign)
      const saved = page.waitForResponse(response => response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === STAFF)
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
      const response = await saved
      const payload = response.request().postDataJSON() as { employees: Record<string, unknown>[]; staff_units: Record<string, unknown>[] }
      expect(payload.employees).toHaveLength(1)
      expect(payload.employees[0]).toMatchObject({ id: own.employeeId, callsign: change ? own.changedCallsign : own.callsign })
      expect(payload.employees[0], 'OMIT user; hidden/disabled select must not become user:null').not.toHaveProperty('user')
      expect(payload.staff_units).toEqual([{ id: own.slotId, division: 3, position: own.positionId }])
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ success: true, updated: { employees: 1, staff_units: 1 } })
      expect(body.errors ?? []).toEqual([])
      expect(body.rolled_back ?? false).toBe(false)
      await expect(dialog).toHaveCount(0)
      const actual = await ownStaff(request, actor, own)
      expect(actual.management.callsign).toBe(change ? own.changedCallsign : own.callsign)
      expect(await ownAccount(request, admin, own)).toMatchObject({ employee_id: own.employeeId })
      if (!change) {
        const row = page.getByTestId('service-employee-row').filter({
          has: page.locator(`a[href^="/security-ops/profile/${own.employeeId}?"], a[href^="/security-ops/profile/${own.employeeId}/?"]`),
        })
        await expect(row).toHaveCount(1)
        await row.getByRole('button', { name: 'Изменить', exact: true }).click()
      }
    }
    await page.waitForLoadState('networkidle')
    expect(accountReads, 'nonglobal employee edit must never fetch global account lists').toEqual([])
  } catch (error) { primaryError = error; throw error }
  finally { await cleanup(request, admin, own, primaryError) }
})

// CONTRACT ONLY: real fixture + real permission response, deliberately HELD
// before delivery. This checks initial loading, NOT populated-cache hiding.
test.describe('permission initial-loading HTTP-delivery contract', () => {
  test.use({ serviceWorkers: 'block' })
  test('contract: access settings form and selected-account child wait for actual permissions response', async ({ page, request }) => {
    test.skip(process.env.SMOKE_LIVE !== '1', 'requires isolated Night login; permission response delivery is held')
    const own = ownIdentity()
    const admin = await token(request, STAND_USERNAME, STAND_PASSWORD)
    let primaryError: unknown
    let deliveryError: unknown
    let release!: () => void
    let reached!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    const intercepted = new Promise<void>(resolve => { reached = resolve })
    const accessReads: string[] = []
    try {
      await prepare(request, admin, own)
      await signIn(page, own)
      page.on('request', req => {
        const path = new URL(req.url()).pathname
        if (req.method() === 'GET' && (/^\/api\/operations\/(accounts|roles|permissions|user-roles)\//.test(path) || path === '/api/ops/access-catalog/')) accessReads.push(req.url())
      })
      await page.route('**/api/operations/my-permissions/**', async route => {
        try {
          const actual = await route.fetch()
          expect(actual.status()).toBe(200)
          expect((await actual.json()).global_permissions).toEqual([])
          reached()
          await released
          await route.fulfill({ response: actual })
        } catch (error) {
          deliveryError = error
          reached()
          await route.abort()
        }
      })
      await page.goto(`${APP}/settings/users/?search=${encodeURIComponent(own.username)}&user=${own.accountId}`, { waitUntil: 'domcontentloaded' })
      await intercepted
      if (deliveryError !== undefined) throw deliveryError
      // The new page must expose its loading state positively. Adapt wording
      // only to the actual implemented guard; do not replace with a timer or
      // absence-only check that can pass before the page mounts.
      await expect(page.getByRole('status').filter({ hasText: /Загрузка прав|Проверка прав/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toHaveCount(0)
      await expect(page.getByLabel('Поиск сотрудника для учётной записи')).toHaveCount(0)
      expect(accessReads, 'loading must not prefetch access data or mount employee-options child').toEqual([])
      release()
      await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(accessReads).toEqual([])
    } catch (error) { primaryError = error; throw error }
    finally {
      release()
      // Finish the held delivery before deleting its owned account/employee.
      const teardownFailures: unknown[] = []
      try { await page.unrouteAll({ behavior: 'wait' }) } catch (error) { teardownFailures.push(error) }
      try { await cleanup(request, admin, own, primaryError) } catch (error) { teardownFailures.push(error) }
      if (teardownFailures.length) throw new AggregateError(primaryError === undefined ? teardownFailures : [primaryError, ...teardownFailures], 'contract delivery/owned cleanup failed')
    }
  })
})
