import { expect, test } from '@playwright/test'
import { createOwnEvent, standCall, type StandCall } from './prepare-events'

export function requireIsolatedForcesClone() {
  test.skip(process.env.SMOKE_ISOLATED_CLONE !== '1', 'Нужен изолированный clone: SMOKE_ISOLATED_CLONE=1; сценарий создаёт и удаляет собственное ОМ')
  // Match one complete binding before any request; never mix allowed fields.
  expect([
    { api: 'http://127.0.0.1:18349', app: 'http://127.0.0.1:3350',
      database: 'smart_refine_20261008', container: 'smart-refine-20261008-backend-1' },
    { api: 'http://127.0.0.1:18351', app: 'http://localhost:3354',
      database: 'smart_eight_hours_20261009', container: 'smart-eight-hours-20261009-backend-1' },
  ]).toContainEqual({ api: process.env.SMOKE_API, app: process.env.SMOKE_APP,
    database: process.env.PR_DB_NAME, container: process.env.SMOKE_DOCKER_CONTAINER })
}

export type OwnedForcesFixture = {
  id: string; code: string; base: string; call: StandCall
  allocationId: string; employeeIds: string[]; divisionId: number
  post: { id: string; post: string }; businessDate: string
  initialEvent?: { total: number; group: number; squad: number }
}

/** Only this newly created event is writable; existing passports and people are read-only inputs. */
export async function withOwnedForcesFixture(
  token: string,
  options: { group?: boolean; accepted?: boolean },
  run: (fixture: OwnedForcesFixture) => Promise<void>,
) {
  requireIsolatedForcesClone()
  const call = standCall(token)
  const initialReport = await call('GET', '/api/operations/strength-report/')
  const businessDate = initialReport.business_date
  const created = await createOwnEvent(call, token, {
    name: `Изолированная проверка сил ${Date.now()}`, businessDate,
  })
  const base = `/api/ops/security-events/${created.id}`
  try {
    await call('POST', `${base}/recon/import-from-passport/`)
    const imported = await call('GET', `${base}/`)
    expect(imported.reconSectorPosts.length, 'паспорт содержит пост').toBeGreaterThan(0)
    await call('PATCH', `${base}/recon/`, {
      checklist: imported.reconChecklist.map((row: Record<string, unknown>) => ({
        ...row, state: 'NORMAL', done: true, result: 'MATCHES',
      })),
      sectorPosts: imported.reconSectorPosts.map((row: Record<string, unknown>, i: number) =>
        i === 0 ? { ...row, need: 1, minRating: null } : row),
    })
    await call('POST', `${base}/recon/complete/`)
    const divisions: { id: number; parent: number | null; type_code: string }[] =
      (await call('GET', '/api/core/divisions/?page_size=1000')).results
    const directorate = divisions.find(row => row.type_code === 'directorate' &&
      divisions.some(parent => parent.id === row.parent && parent.type_code === 'department'))
    expect(directorate, 'управление внутри департамента').toBeDefined()
    const allocation = await call('POST', `${base}/forces/allocation/`, {
      draft: false,
      rows: [{ departmentId: String(directorate!.parent), need: 1 }],
    })
    const allocationId = allocation.forceAllocation[0].id as string
    const allocationBase = `${base}/forces/allocation/${allocationId}`
    await call('POST', `${allocationBase}/split/`, {
      rows: [{ divisionId: String(directorate!.id), need: 1 }],
    })
    await call('POST', `${allocationBase}/notify/`)
    const people: { id: string }[] = (await call('GET',
      `/api/ops/personnel/?division_id=${directorate!.id}&page_size=500`)).results
    const groupRole = options.group
      ? (await call('GET', '/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/')).results
        .find((row: { groupCode: string; isActive: boolean }) => row.groupCode === 'SCREENING_GROUP' && row.isActive)?.code
      : undefined
    const employeeIds: string[] = []
    for (const person of people) {
      if (employeeIds.length === 2) break
      const group = options.group && employeeIds.length === 1
      const path = group
        ? `/api/ops/security-events/forces/requests/${allocationId}/directorate/select/`
        : `${allocationBase}/members/`
      const response = await fetch(`${process.env.SMOKE_API}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(group
          ? { employeeIds: [String(person.id)], kindCode: 'SCREENING_GROUP', roleCode: groupRole }
          : { employeeId: String(person.id) }),
      })
      const result = await response.json()
      // An occupied employee is never overridden; every other refusal fails preparation.
      const refusal = group ? result.refused?.[0]?.code : result.error_code
      if (refusal === 'STATUS_OVERLAP_WARNING' || refusal === 'OVERLAPPING_HARD_STATUS') continue
      expect(response.ok, JSON.stringify(result)).toBe(true)
      if (group) expect(result.selected).toContain(String(person.id))
      else expect(result.error_code).toBeUndefined()
      employeeIds.push(String(person.id))
    }
    expect(employeeIds, 'два свободных сотрудника, без обхода чужих назначений').toHaveLength(2)
    if (options.accepted) {
      await call('POST', `${allocationBase}/submit/`)
      await call('POST', `${allocationBase}/accept/`)
    }
    const card = await call('GET', `${base}/`)
    if (options.accepted) {
      expect(card.forceRoster.map((row: { employeeId: string }) => String(row.employeeId)))
        .toEqual(expect.arrayContaining(employeeIds))
    }
    await run({ id: created.id, code: card.code, base, call, allocationId, employeeIds,
      divisionId: Number(card.forceAllocation.find((row: { id: string }) => row.id === allocationId).members[0].divisionId),
      post: card.reconSectorPosts[0], businessDate, initialEvent: initialReport.totals.event })
  } finally {
    const card = await call('GET', `${base}/`)
    expect(String(card.id)).toBe(created.id)
    expect(card.title).toBe(created.title)
    for (const assignment of card.placementAssignments ?? []) {
      await call('DELETE', `${base}/placement/${assignment.id}/`)
    }
    // Event deletion also removes its own participation statuses, including today's.
    await call('DELETE', `${base}/`)
    const deleted = await fetch(`${process.env.SMOKE_API}${base}/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(deleted.status, 'собственное ОМ удалено').toBe(404)
  }
}
