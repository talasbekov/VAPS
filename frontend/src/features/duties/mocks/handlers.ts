// MSW handlers — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  DUTY_CANDIDATES_PATH,
  DUTY_MONTHLY_PLAN_PATH,
  DUTY_PLAN_OBJECTS_PATH,
  DUTY_SHIFT_LIST_PATH,
  DUTY_ROUTES_PATH,
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
  combatDutyShiftAcknowledgePath,
  combatDutyShiftCheckInPath,
  combatDutyShiftCompletePath,
  combatDutyShiftHandoverPath,
  combatDutyShiftReplacePath,
  combatDutyShiftReviewPath,
  combatDutyShiftSubmitPath,
  dutyPlanApprovePath,
  dutyPlanCheckPath,
  dutyPlanDraftPath,
  dutyPlanReopenPath,
  dutyShiftAcknowledgePath,
  dutyShiftDetailPath,
  dutyShiftUpdatePath,
  dutyShiftCancelPath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
} from '../api/pending-contracts'
import type {
  AcknowledgeCombatDutyRequest,
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  CancelDutyShiftRequest,
  CreateDutyShiftRequest,
  MonthlyPlanActionRequest,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatDutyHandoverRequest,
  SubmitCombatGroupRequest,
  UpdateDutyShiftRequest,
} from '../api/pending-contracts'
import {
  createDutiesRepository,
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'

/** §21.27: план на месяц ещё не сформирован — это не «нет такой смены». */
const PLAN_NOT_FOUND_TEXT = 'План на этот месяц не сформирован.'

function permissionDeniedEnvelope(clock: DemoClock): ErrorEnvelope {
  return {
    error_code: 'PERMISSION_DENIED',
    message: 'Недостаточно прав.',
    details: {},
    request_id: null,
    timestamp: clock.now(),
  }
}

function notFoundEnvelope(clock: DemoClock, id: string, message: string): ErrorEnvelope {
  return {
    error_code: 'ENTITY_NOT_FOUND',
    message,
    details: { id },
    request_id: null,
    timestamp: clock.now(),
  }
}

function businessRuleEnvelope(clock: DemoClock, errorCode: string, message: string): ErrorEnvelope {
  return { error_code: errorCode, message, details: {}, request_id: null, timestamp: clock.now() }
}

function mapRepositoryError(
  error: unknown,
  clock: DemoClock,
  entityId: string,
  // Сообщение 404 зависит от того, чего не нашли: у lifecycle плана «дежурство
  // не найдено» отправило бы читателя искать не тот объект.
  notFoundMessage = 'Дежурство не найдено.',
): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(permissionDeniedEnvelope(clock), { status: 403 })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(notFoundEnvelope(clock, entityId, notFoundMessage), { status: 404 })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(businessRuleEnvelope(clock, error.errorCode, error.message), {
      status: 422,
    })
  }
  // §21.34: soft-конфликт — 409, а не 422. Форма различает их по коду
  // состояния: 422 — отказ, 409 — «сохранить можно, нужно обоснование».
  if (error instanceof RepositoryConflictError) {
    const envelope: ErrorEnvelope = {
      error_code: error.errorCode,
      message: error.message,
      details: error.details,
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 409 })
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
    http.get(`*${DUTY_MONTHLY_PLAN_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      // Месяц — обязательный query-параметр: молчаливый дефолт «текущий
      // месяц» разошёлся бы с месяцем, который выбрал пользователь, и разница
      // была бы невидима — лучше явная 422.
      const month = new URL(request.url).searchParams.get('month') ?? ''
      try {
        return HttpResponse.json(await repository.getMonthlyPlan(month, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    // §21.27, четыре действия lifecycle. Каждое — своя операция под своим
    // путём, а не один `POST …/transition/` с кодом в теле: у них разные права
    // (`ops.duty.manage` против `ops.duty.approve_plan`) и разные отказы.
    http.post(`*${dutyPlanDraftPath()}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as MonthlyPlanActionRequest
      try {
        return HttpResponse.json(await repository.createPlanDraft(body, actorUserId))
      } catch (error) {
        return (
          mapRepositoryError(error, clock, body.month, PLAN_NOT_FOUND_TEXT) ?? HttpResponse.error()
        )
      }
    }),
    http.post(`*${dutyPlanCheckPath()}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as MonthlyPlanActionRequest
      try {
        return HttpResponse.json(await repository.checkPlanConflicts(body, actorUserId))
      } catch (error) {
        return (
          mapRepositoryError(error, clock, body.month, PLAN_NOT_FOUND_TEXT) ?? HttpResponse.error()
        )
      }
    }),
    http.post(`*${dutyPlanApprovePath()}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as MonthlyPlanActionRequest
      try {
        return HttpResponse.json(await repository.approvePlan(body, actorUserId))
      } catch (error) {
        return (
          mapRepositoryError(error, clock, body.month, PLAN_NOT_FOUND_TEXT) ?? HttpResponse.error()
        )
      }
    }),
    http.post(`*${dutyPlanReopenPath()}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as MonthlyPlanActionRequest
      try {
        return HttpResponse.json(await repository.reopenPlan(body, actorUserId))
      } catch (error) {
        return (
          mapRepositoryError(error, clock, body.month, PLAN_NOT_FOUND_TEXT) ?? HttpResponse.error()
        )
      }
    }),
    http.get(`*${DUTY_PLAN_OBJECTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      // Оба параметра обязательны по той же причине, что месяц у плана: без
      // даты нельзя выбрать действующую версию, без вида дежурства — применить
      // политику §21.31. Молчаливый дефолт разошёлся бы с формой невидимо.
      const businessDate = params.get('business_date') ?? ''
      const dutyTypeCode = params.get('duty_type_code') ?? ''
      try {
        return HttpResponse.json(
          await repository.listDutyPlanObjects(businessDate, dutyTypeCode, actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${DUTY_SHIFT_LIST_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      // Единственный допустимый второй режим — история; любое иное значение
      // трактуется как полный список, а не как ошибка: это фильтр показа, а не
      // бизнес-правило.
      const scope = new URL(request.url).searchParams.get('scope') === 'history' ? 'HISTORY' : 'ALL'
      try {
        return HttpResponse.json(await repository.listShiftList(scope, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${DUTY_CANDIDATES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const businessDate = new URL(request.url).searchParams.get('business_date') ?? ''
      try {
        return HttpResponse.json(await repository.listDutyCandidates(businessDate, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.post(`*${DUTY_SHIFTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        const body = (await request.json()) as CreateDutyShiftRequest
        return HttpResponse.json(await repository.createDutyShift(body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    // §21.32. Регистрируется ПОСЛЕ коллекционных GET-ов: `:id` — обязательный
    // сегмент, поэтому `/duty-shifts/` этим паттерном не матчится, но порядок
    // держим явным, чтобы правило было видно, а не подразумевалось.
    http.get(`*${dutyShiftDetailPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.getShiftDetail(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dutyShiftUpdatePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as UpdateDutyShiftRequest
        return HttpResponse.json(await repository.updateDutyShift(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dutyShiftCancelPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as CancelDutyShiftRequest
        return HttpResponse.json(await repository.cancelDutyShift(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
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
    http.post(`*${combatDutyShiftHandoverPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        const body = (await request.json()) as SubmitCombatDutyHandoverRequest
        return HttpResponse.json(await repository.submitCombatDutyHandover(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
  ]
}
