// Story 16.8h1: MSW handlers для dev:mock demo-режима над
// /api/operations/assignment-versions/* и /placement-assignments/*
// (прецедент duty-plans/mocks/handlers.ts). Покрывает list/retrieve/
// conflicts/submit/return/approve/acknowledge (все 16.8a-f).
import { http, HttpResponse } from 'msw'
import { ASSIGNMENT_VERSIONS } from './fixtures'
import type { AssignmentVersionFixture } from './fixtures'

let nextVersionId = ASSIGNMENT_VERSIONS.length + 1

function findVersion(id: number) {
  return ASSIGNMENT_VERSIONS.find((v) => v.id === id)
}

export const placementHandlers = [
  http.post('*/api/operations/security-events/:id/placement/draft/', ({ params }) => {
    const eventId = Number(params.id)
    if (ASSIGNMENT_VERSIONS.some((v) => v.event === eventId && v.is_current)) {
      return HttpResponse.json(
        { error_code: 'PLACEMENT_DRAFT_ALREADY_EXISTS' },
        { status: 409 },
      )
    }
    const now = new Date().toISOString()
    const draft: AssignmentVersionFixture = {
      id: nextVersionId++,
      event: eventId,
      status: 'DRAFT',
      version: 1,
      is_current: true,
      signature_hash: '',
      created_at: now,
      updated_at: now,
      assignments: [],
    }
    ASSIGNMENT_VERSIONS.push(draft)
    return HttpResponse.json(draft, { status: 201 })
  }),
  http.get('*/api/operations/assignment-versions/', ({ request }) => {
    const url = new URL(request.url)
    const eventId = url.searchParams.get('event')
    const results = eventId
      ? ASSIGNMENT_VERSIONS.filter((v) => v.event === Number(eventId))
      : ASSIGNMENT_VERSIONS
    return HttpResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results: results.map((v) => {
        const copy: Partial<AssignmentVersionFixture> = { ...v }
        delete copy.assignments
        return copy
      }),
    })
  }),
  http.get('*/api/operations/assignment-versions/:id/', ({ params }) => {
    const version = findVersion(Number(params.id))
    if (!version) return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
    return HttpResponse.json(version)
  }),
  http.get('*/api/operations/assignment-versions/:id/conflicts/', ({ params }) => {
    const version = findVersion(Number(params.id))
    if (!version) return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
    return HttpResponse.json(version.assignments.filter((a) => a.conflict_severity))
  }),
  http.post('*/api/operations/assignment-versions/:id/submit/', ({ params }) => {
    const version = findVersion(Number(params.id))
    if (!version) return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
    version.status = 'SUBMITTED'
    version.updated_at = new Date().toISOString()
    return HttpResponse.json(version)
  }),
  http.post('*/api/operations/assignment-versions/:id/return/', async ({ params, request }) => {
    const version = findVersion(Number(params.id))
    if (!version) return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
    const body = (await request.json()) as { reason?: string }
    if (!body.reason?.trim()) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', details: { reason: ['Обязательное поле.'] } },
        { status: 400 },
      )
    }
    version.status = 'RETURNED'
    version.is_current = false
    const newDraft: AssignmentVersionFixture = {
      ...version,
      id: nextVersionId++,
      status: 'DRAFT',
      version: version.version + 1,
      is_current: true,
      // Real backend bulk_creates new rows carrying only version/employee_id/
      // post_id (services.py) — conflict/ack state resets, never copied.
      assignments: version.assignments.map((a) => ({
        ...a,
        conflict_severity: '' as const,
        conflict_codes: [],
        acknowledged_at: null,
        ack_escalated_at: null,
      })),
    }
    ASSIGNMENT_VERSIONS.push(newDraft)
    return HttpResponse.json({ ...version, new_draft_version: newDraft })
  }),
  http.post(
    '*/api/operations/assignment-versions/:id/approve/',
    async ({ params, request }) => {
      const version = findVersion(Number(params.id))
      if (!version) return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
      const body = (await request.json()) as { override?: boolean; override_reason?: string }
      const hasConflict = version.assignments.some((a) => a.conflict_severity)
      if (hasConflict && !(body.override && body.override_reason?.trim())) {
        return HttpResponse.json({ error_code: 'SOFT_CONFLICT_DETECTED' }, { status: 409 })
      }
      version.status = 'APPROVED'
      version.signature_hash = 'demo-hash'
      version.updated_at = new Date().toISOString()
      return HttpResponse.json(version)
    },
  ),
  http.post('*/api/operations/placement-assignments/:id/acknowledge/', ({ params }) => {
    for (const version of ASSIGNMENT_VERSIONS) {
      const assignment = version.assignments.find((a) => a.id === Number(params.id))
      if (assignment) {
        assignment.acknowledged_at ??= new Date().toISOString()
        return HttpResponse.json(assignment)
      }
    }
    return HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 })
  }),
]
