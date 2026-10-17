import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { readEventsStore, securityEventsHandlers } from '../mocks/ops/security-events-handlers'
import { securityEventPlacementAssignPath, securityEventReplaceAssignmentPath } from '../entities/security-event'
import type { SecurityEvent } from '../entities/security-event'

// Execute the registered MSW handler directly: no browser/server/network and
// no writes to a real database. Each test owns its in-process fixture only.
async function post(path: string, body: unknown): Promise<SecurityEvent> {
  const request = new Request(`http://mock.invalid${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  for (const handler of securityEventsHandlers) {
    const match = await handler.run({ request, requestId: randomUUID() })
    if (match?.response) {
      expect(match.response.status).toBe(200)
      return await match.response.json() as SecurityEvent
    }
  }
  throw new Error(`Unmatched mock route: ${path}`)
}

for (const operation of ['assign', 'replace'] as const) {
 for (const [employeeId, callsign] of [['emp-9', 'Беркут'], ['emp-10', '']] as const) {
  test(`mock ${operation} retains the incoming callsign (${employeeId})`, async () => {
    const seed = readEventsStore()[0]
    expect(seed).toBeDefined()
    const fixture = structuredClone(seed)
    fixture.id = `callsign-${randomUUID()}`
    fixture.stage = 'PLACEMENT'
    fixture.placementAssignments = []
    fixture.forceRoster = []
    fixture.visitObjects = fixture.visitObjects.slice(0, 1).map(visit => ({ ...visit, stage: 'PLACEMENT' }))
    fixture.reconSectorPosts = [{
      id: `${fixture.id}-post`, sector: 'A', post: 'Пост', task: '', need: 1,
      requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null,
      sourcePostId: null, minRating: null, visitObjectId: fixture.visitObjects[0]?.id ?? null,
    }]
    readEventsStore().push(fixture)
    try {
      let event = await post(securityEventPlacementAssignPath(fixture.id), {
        postId: fixture.reconSectorPosts[0].id, employeeId: operation === 'assign' ? employeeId : 'emp-1',
      })
      if (operation === 'replace') {
        const stored = readEventsStore().find(row => row.id === fixture.id)!
        stored.stage = 'ACKNOWLEDGEMENT'
        stored.visitObjects.forEach(visit => { visit.stage = 'ACKNOWLEDGEMENT' })
        event = await post(securityEventReplaceAssignmentPath(fixture.id), {
          assignmentId: event.placementAssignments[0].id, incomingEmployeeId: employeeId, reasonCode: 'Замена',
        })
      }
      expect(event.placementAssignments).toHaveLength(1)
      expect(event.placementAssignments[0]).toMatchObject({ employeeId, callsign })
    } finally {
      const store = readEventsStore()
      const index = store.findIndex(row => row.id === fixture.id)
      if (index !== -1) store.splice(index, 1)
    }
  })
 }
}
