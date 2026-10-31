// Own GVO fixtures use the real API on the isolated Night stand.
// Cleanup validates a UUID singleton before touching persisted records.
import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext } from '@playwright/test'
import { runBackendCommand } from './backend-command'
import { uniqueBusinessDate } from './business-date'
import { objectWithPassport, type StandCall } from './prepare-events'
import { probeTitle } from './probe-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { nativeCombatSmokeDatabase } from './native-combat-smoke'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:18346'
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3347'
// Mutations require one complete approved tuple; mixed targets are rejected.
export function isolatedDatabase(): string {
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

type Kind = 'INTERNAL' | 'FOREIGN'
type Headers = { Authorization: string }
interface Identity {
  marker: string; title: string; businessDate: string; kind: Kind
  id?: string; code?: string; objectId?: string
}
export interface OwnedGvoEvent extends Identity {
  id: string; code: string; objectId: string; stage: 'RECON'
  visitObjects: { id: string; objectName: string }[]
  countryAbbreviation?: string
}

export async function ownGvoHeaders(request: APIRequestContext): Promise<Headers> {
  // Guard before acquiring credentials or creating a fixture on another stand.
  isolatedDatabase()
  const response = await request.post(`${API}/api/token/`, {
    data: { username: STAND_USERNAME, password: STAND_PASSWORD },
  })
  expect(response.status()).toBe(200)
  const body = await response.json() as { access: string }
  expect(body.access).toBeTruthy()
  return { Authorization: `Bearer ${body.access}` }
}

async function detail(request: APIRequestContext, headers: Headers, own: Identity): Promise<OwnedGvoEvent> {
  const response = await request.get(`${API}/api/ops/security-events/${own.id}/`, { headers })
  expect(response.status()).toBe(200)
  const row = await response.json() as OwnedGvoEvent
  expect(row).toMatchObject({ id: own.id, code: own.code, title: own.title,
    kind: own.kind, businessDate: own.businessDate, objectId: own.objectId })
  return row
}

async function create(request: APIRequestContext, headers: Headers, own: Identity): Promise<OwnedGvoEvent> {
  const read: StandCall = async (method, path) => {
    expect(method).toBe('GET')
    const response = await request.get(`${API}${path}`, { headers })
    expect(response.status()).toBe(200)
    return await response.json()
  }
  own.objectId = (await objectWithPassport(read)).id
  const personnelResponse = await request.get(`${API}/api/ops/personnel/?page_size=1`, { headers })
  expect(personnelResponse.status()).toBe(200)
  const personnel = await personnelResponse.json() as { results: { id: string | number }[] }
  expect(Array.isArray(personnel.results)).toBe(true)
  const chiefEmployeeId = String(personnel.results[0]?.id ?? '')
  expect(Number.isSafeInteger(Number(chiefEmployeeId)) && Number(chiefEmployeeId) > 0).toBe(true)
  let protectedPersonId: string | undefined
  if (own.kind === 'FOREIGN') {
    const response = await request.get(`${API}/api/ops/protected-persons/`, { headers })
    expect(response.status()).toBe(200)
    const body = await response.json() as { results: { id: string; category: string; country: string }[] }
    expect(Array.isArray(body.results)).toBe(true)
    const person = body.results.find(row => row.category === 'FOREIGN' &&
      /[А-Яа-яЁёA-Za-z]/.test(row.country))
    expect(person, 'a real active foreign catalog person with country is a readonly prerequisite').toBeDefined()
    protectedPersonId = person!.id
  }
  const response = await request.post(`${API}/api/ops/security-events/`, {
    headers, data: { title: own.title, businessDate: own.businessDate, kind: own.kind,
      objectId: own.objectId, chiefEmployeeId,
      ...(protectedPersonId === undefined ? {} : { protectedPersonId }) },
  })
  expect(response.status()).toBe(201)
  const row = await response.json() as OwnedGvoEvent
  // Capture identity before any DTO assertion; cleanup can rediscover the
  // UUID title if a committed response fails before identity is captured.
  if (row.id !== undefined && row.id !== null) own.id = String(row.id)
  if (row.code !== undefined && row.code !== null) own.code = row.code
  expect(Number.isSafeInteger(Number(own.id)) && Number(own.id) > 0).toBe(true)
  expect(own.code).toBeTruthy()
  expect(row).toMatchObject({ id: own.id, code: own.code, title: own.title,
    kind: own.kind, businessDate: own.businessDate, objectId: own.objectId, stage: 'RECON' })
  expect(row.visitObjects).toHaveLength(1)
  const actual = await detail(request, headers, own)
  expect(actual.visitObjects).toHaveLength(1)
  if (protectedPersonId !== undefined) {
    // GET does not create OpsForeignVisit. Public PATCH does; resetting its
    // empty payload keeps READY while filled=false and the registry says draft.
    const initialize = await request.patch(
      `${API}/api/ops/gvo-summaries/${encodeURIComponent(actual.code)}/`,
      { headers, data: { values: {} } },
    )
    expect(initialize.status()).toBe(200)
    expect((await initialize.json()).omCode).toBe(actual.code)
    await resetOwnGvoSummary(request, actual)
    const summaryResponse = await request.get(
      `${API}/api/ops/gvo-summaries/${encodeURIComponent(actual.code)}/`, { headers },
    )
    expect(summaryResponse.status()).toBe(200)
    const body = await summaryResponse.json() as {
      filled: boolean; visit: { status: string; version: number } | null
      summary: { country: string; persons: { personId?: string; code?: string }[];
        senior: { employeeId: string; name: string } | null }
    }
    expect(body.visit, 'public PATCH must initialize the own foreign visit').not.toBeNull()
    expect(body.visit!.status).toBe('READY')
    expect(body.filled).toBe(false)
    expect(body.summary.senior).not.toBeNull()
    expect(String(body.summary.senior!.employeeId)).toBe(chiefEmployeeId)
    expect(body.summary.senior!.name.trim()).not.toBe('')
    expect(body.summary.senior!.name).not.toBe('уточняется')
    const linked = body.summary.persons.find(person => person.personId === protectedPersonId)
    expect(linked, 'own FOREIGN must expose the actual protected-person reference').toBeDefined()
    expect(linked!.code).toBeTruthy()
    const letters = body.summary.country.replace(/[^А-Яа-яЁёA-Za-z]/g, '').slice(0, 2)
    expect(letters, 'country abbreviation must contain visible letters').not.toBe('')
    actual.countryAbbreviation = letters.toUpperCase()
  }
  return actual
}

const PURGE = String.raw`
import json, os
from django.core.management import call_command
from django.db import connection, transaction
from django.conf import settings
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsForeignVisit
f = json.loads(os.environ['E2E_GVO_OWN'])
assert os.environ['E2E_EXPECTED_DB'] in ('smart_night_20261008', 'smart_complete_20261008', 'smart_refine_20261008', 'smart_eight_hours_20261009', 'sj_combat_smoke')
assert connection.settings_dict['NAME'] == os.environ['E2E_EXPECTED_DB'], 'refuse cleanup on a different database'
if os.environ['E2E_EXPECTED_DB'] == 'sj_combat_smoke':
    assert str(connection.settings_dict['PORT']) == '15434' and connection.settings_dict['HOST'] == '127.0.0.1'
    assert 'smoke-files' in settings.OPS_PRIVATE_STORAGE_ROOT
assert f['title'] == 'Проба собственной сводки ГВО ' + f['marker'] + ' (e2e)'
with transaction.atomic():
    rows = list(OpsSecurityEvent.objects.select_for_update().filter(title=f['title']))
    assert len(rows) <= 1, 'ambiguous owned title; preserve all'
    if rows:
        event = rows[0]
        assert f.get('id') in (None, str(event.pk)), 'unexpected event ID'
        assert f.get('code') in (None, event.code), 'unexpected event code'
        assert event.kind == f['kind'] and str(event.business_date) == f['businessDate']
        assert f.get('objectId') in (None, str(event.security_object_id))
        assert list(OpsSecurityEvent.objects.filter(title__contains=f['title']).values_list('pk', flat=True)) == [event.pk]
        assert not event.vehicles.exists(), 'fixture unexpectedly has vehicle allocations'
        assert not event.force_campaign_assignments.exists(), 'fixture unexpectedly belongs to a force campaign'
        visits = list(OpsForeignVisit.objects.filter(event=event).values_list('pk', flat=True))
        removed = {'eventId': event.pk, 'code': event.code, 'foreignVisitIds': visits}
        call_command('purge_probe_events', marker=f['title'], yes=True, force=True, actor='e2e-gvo-owned')
        assert not OpsSecurityEvent.objects.filter(pk=removed['eventId']).exists()
        assert not OpsForeignVisit.objects.filter(pk__in=visits).exists()
    else:
        assert not f.get('id'), 'captured owned event unexpectedly missing'
        removed = None
print('OWN_GVO_REMOVED=' + json.dumps({'marker': f['marker'], 'removed': removed}))
`

async function dispose(own: Identity): Promise<string> {
  // The established purge service owns event/visit/patch/participation cleanup;
  // its marker is the FULL singleton title, never the generic '(e2e)' marker.
  const output = await runBackendCommand(['shell', '-c', PURGE], {
    env: { E2E_GVO_OWN: JSON.stringify(own), E2E_EXPECTED_DB: isolatedDatabase() },
  })
  const line = output.split(/\r?\n/).find(item => item.startsWith('OWN_GVO_REMOVED='))
  expect(line).toBeDefined()
  expect(JSON.parse(line!.slice('OWN_GVO_REMOVED='.length)).marker).toBe(own.marker)
  return line!
}

function fixture(kind: Kind) {
  return async ({ request }: { request: APIRequestContext }, use: (own: OwnedGvoEvent) => Promise<void>) => {
    const marker = `e2e-gvo-owned:${randomUUID()}`
    const own: Identity = { marker, title: probeTitle(`Проба собственной сводки ГВО ${marker}`),
      businessDate: uniqueBusinessDate(), kind }
    // A failed stand guard must not invoke management cleanup on another stand.
    const headers = await ownGvoHeaders(request)
    let primary: unknown
    try {
      await use(await create(request, headers, own))
    } catch (error) { primary = error; throw error }
    finally {
      try {
        const cleanup = await dispose(own)
        await base.info().attach(`own-gvo-${kind.toLowerCase()}`, {
          contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...own, cleanup }, null, 2)),
        })
      } catch (error) {
        throw new AggregateError(primary === undefined ? [error] : [primary, error], 'owned GVO fixture cleanup failed')
      }
    }
  }
}

export const test = base.extend<{ ownForeign: OwnedGvoEvent; ownInternal: OwnedGvoEvent }>({
  ownForeign: fixture('FOREIGN'), ownInternal: fixture('INTERNAL'),
})

export async function resetOwnGvoSummary(request: APIRequestContext, own: OwnedGvoEvent): Promise<void> {
  const headers = await ownGvoHeaders(request)
  await detail(request, headers, own)
  const response = await request.post(`${API}/api/ops/gvo-summaries/${encodeURIComponent(own.code)}/reset/`, {
    headers, data: {},
  })
  expect(response.status()).toBe(200)
  expect((await response.json()).omCode).toBe(own.code)
}
