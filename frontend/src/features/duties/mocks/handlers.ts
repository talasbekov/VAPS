// MSW handlers — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  DUTY_ROUTES_PATH,
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
  combatDutyShiftAcknowledgePath,
  combatDutyShiftCheckInPath,
  combatDutyShiftCompletePath,
  combatDutyShiftReplacePath,
  combatDutyShiftReviewPath,
  combatDutyShiftSubmitPath,
  dutyShiftAcknowledgePath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
} from '../api/pending-contracts'
import type {
  AcknowledgeCombatDutyRequest,
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatGroupRequest,
} from '../api/pending-contracts'
import {
  createDutiesRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'

function permissionDeniedEnvelope(clock: DemoClock): ErrorEnvelope {
  return {
    error_code: 'PERMISSION_DENIED',
    message: 'Недостаточно прав.',
    details: {},
    request_id: null,
    timestamp: clock.now(),
  }
}

function notFoundEnvelope(clock: DemoClock, id: string): ErrorEnvelope {
  return {
    error_code: 'ENTITY_NOT_FOUND',
    message: 'Дежурство не найдено.',
    details: { id },
    request_id: null,
    timestamp: clock.now(),
  }
}

function businessRuleEnvelope(clock: DemoClock, errorCode: string, message: string): ErrorEnvelope {
  return { error_code: errorCode, message, details: {}, request_id: null, timestamp: clock.now() }
}

function mapRepositoryError(error: unknown, clock: DemoClock, entityId: string): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(permissionDeniedEnvelope(clock), { status: 403 })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(notFoundEnvelope(clock, entityId), { status: 404 })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(businessRuleEnvelope(clock, error.errorCode, error.message), {
      status: 422,
    })
  }
  return null
}

export function createDutiesHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createDutiesRepository(adapter, clock)

  return [
    http.get(`*${DUTY_TYPES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listDutyTypes(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${DUTY_SHIFTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listShifts(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.post(`*${dutyShiftAcknowledgePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.acknowledge(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dutyShiftClockInPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.clockIn(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dutyShiftClockOutPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.clockOut(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.get(`*${COMBAT_DUTY_TYPES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listCombatDutyTypes(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${DUTY_ROUTES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listRoutes(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${COMBAT_ROSTER_CANDIDATES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listRosterCandidates(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${COMBAT_DUTY_SHIFTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listCombatShifts(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.post(`*${COMBAT_DUTY_SHIFTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        const body = (await request.json()) as CreateCombatDutyShiftRequest
        return HttpResponse.json(await repository.createCombatDutyShift(body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftSubmitPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as SubmitCombatGroupRequest
        return HttpResponse.json(await repository.submitCombatGroup(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftReviewPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as ReviewCombatGroupRequest
        return HttpResponse.json(await repository.reviewCombatGroup(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftAcknowledgePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as AcknowledgeCombatDutyRequest
        return HttpResponse.json(
          await repository.acknowledgeCombatDuty(id, body.employeeName, actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftCheckInPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.checkInCombatDuty(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftCompletePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as CompleteCombatDutyRequest
        return HttpResponse.json(await repository.completeCombatDuty(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${combatDutyShiftReplacePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as RequestCombatDutyReplacementRequest
        return HttpResponse.json(await repository.requestReplacement(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
  ]
}
