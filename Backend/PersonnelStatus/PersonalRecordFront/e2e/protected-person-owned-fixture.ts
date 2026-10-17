// Own domestic person fixture uses the real catalog API on Night only.
// Public provisioning; guarded Night-only soft cleanup preserves audit/history.
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { runBackendCommand } from './backend-command'
import { test as base, ownGvoHeaders, resetOwnGvoSummary, isolatedDatabase } from './gvo-owned-fixture'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:18346'
interface PersonIdentity {
  marker: string; name: string; callsign: string; bio: string; category: 'OURS'
  country: string; position: string; facts: never[]; id?: string; code?: string
}
interface OwnDomestic extends PersonIdentity { id: string; code: string; role: string }

const INACTIVATE = String.raw`
import json, os
from django.db import connection, transaction
from organization_management.apps.operations.models_gvo import OpsProtectedPerson, OpsGvoSummaryPatch, OpsForeignVisit
f = json.loads(os.environ['E2E_OWN_DOMESTIC'])
assert os.environ['E2E_EXPECTED_DB'] in ('smart_night_20261008', 'smart_complete_20261008', 'smart_refine_20261008', 'smart_eight_hours_20261009')
assert connection.settings_dict['NAME'] == os.environ['E2E_EXPECTED_DB'], 'refuse cleanup outside the selected isolated database'
assert f['marker'].startswith('e2e-domestic-owned:')
assert f['name'] == 'Собственное ОЛ ' + f['marker']
assert f['bio'] == f['marker'] and f['callsign'] == f['marker']
with transaction.atomic():
    rows = list(OpsProtectedPerson.objects.select_for_update().filter(name=f['name']))
    assert len(rows) <= 1, 'ambiguous own catalog name; preserve all'
    if rows:
        person = rows[0]
        assert f.get('id') in (None, str(person.pk))
        assert f.get('code') in (None, person.display_code)
        assert person.category == 'OURS' and person.name == f['name']
        assert person.callsign == f['callsign'] and person.bio == f['bio']
        assert person.country == '' and person.position == '' and person.facts == []
        assert not person.photo and person.is_active, 'unexpected owned catalog state'
        # Include hidden reverse relations: ForeignVisit uses related_name='+'.
        for relation in person._meta.get_fields(include_hidden=True):
            if relation.auto_created and not relation.concrete and relation.is_relation:
                related = relation.related_model.objects.filter(**{relation.field.name: person})
                assert not related.exists(), 'unexpected persisted person reference: ' + relation.name
        def mentions(value):
            if isinstance(value, dict):
                if any(str(value.get(key)) == str(person.pk) for key in ('personId', 'protectedPersonId', 'person_id')):
                    return True
                return any(mentions(item) for item in value.values())
            if isinstance(value, list):
                return any(mentions(item) for item in value)
            return isinstance(value, str) and (f['marker'] in value or value == person.display_code)
        for patch in OpsGvoSummaryPatch.objects.values_list('patch', flat=True):
            assert not mentions(patch), 'own person still appears in persisted GVO patch'
        for data in OpsForeignVisit.objects.values_list('data', flat=True):
            assert not mentions(data), 'own person still appears in persisted foreign visit data'
        person.is_active = False
        person.save(update_fields=['is_active', 'updated_at'])
        person.refresh_from_db()
        assert not person.is_active
        result = {'id': str(person.pk), 'code': person.display_code, 'isActive': person.is_active}
    else:
        assert not f.get('id'), 'captured own catalog person unexpectedly missing'
        result = None
print('OWN_DOMESTIC_INACTIVE=' + json.dumps({'marker': f['marker'], 'person': result}))
`

export const test = base.extend<{ ownDomestic: OwnDomestic }>({
  ownDomestic: async ({ request, ownForeign }, use) => {
    const marker = `e2e-domestic-owned:${randomUUID()}`
    const own: PersonIdentity = { marker, name: `Собственное ОЛ ${marker}`,
      callsign: marker, bio: marker, category: 'OURS', country: '', position: '', facts: [] }
    const headers = await ownGvoHeaders(request)
    let primary: unknown
    try {
      const response = await request.post(`${API}/api/ops/protected-persons/`, {
        headers, data: { name: own.name, category: own.category, callsign: own.callsign,
          bio: own.bio, country: own.country, position: own.position, facts: own.facts },
      })
      expect(response.status()).toBe(201)
      const row = await response.json() as OwnDomestic
      if (row.id !== undefined && row.id !== null) own.id = String(row.id)
      if (row.code !== undefined && row.code !== null) own.code = row.code
      expect(Number.isSafeInteger(Number(own.id)) && Number(own.id) > 0).toBe(true)
      expect(own.code).toMatch(/^OL-\d+$/)
      expect(row).toMatchObject({ id: own.id, code: own.code, name: own.name,
        category: own.category, callsign: own.callsign, bio: own.bio,
        country: '', position: '', facts: [] })
      const catalog = await request.get(`${API}/api/ops/protected-persons/`, { headers })
      expect(catalog.status()).toBe(200)
      expect((await catalog.json()).results.filter((person: { name: string }) => person.name === own.name))
        .toEqual([row])
      await use({ ...row, ...own, id: own.id!, code: own.code!, role: `Куратор визитов (${marker})` })
    } catch (error) { primary = error; throw error }
    finally {
      const errors: unknown[] = []
      // This is exactly the dependent own FOREIGN, not a scan/reset of other OMs.
      try { await resetOwnGvoSummary(request, ownForeign) } catch (error) { errors.push(error) }
      try {
        const stdout = await runBackendCommand(['shell', '-c', INACTIVATE], {
          env: { E2E_OWN_DOMESTIC: JSON.stringify(own), E2E_EXPECTED_DB: isolatedDatabase() },
        })
        const line = stdout.split(/\r?\n/).find(item => item.startsWith('OWN_DOMESTIC_INACTIVE='))
        expect(line).toBeDefined()
        expect(JSON.parse(line!.slice('OWN_DOMESTIC_INACTIVE='.length)).marker).toBe(marker)
        await base.info().attach('own-domestic-person-cleanup', {
          contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...own, cleanup: line }, null, 2)),
        })
      } catch (error) { errors.push(error) }
      if (errors.length) throw new AggregateError(primary === undefined ? errors : [primary, ...errors],
        'own domestic person cleanup failed; shared catalog/history preserved')
    }
  },
})
