// MSW handlers оперативного рейтинга — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  EVALUATION_CORRECT_PATH_PATTERN,
  EVALUATION_DETAIL_PATH_PATTERN,
  EVALUATION_SUBMIT_PATH_PATTERN,
  EVALUATION_REGISTRY_PATH,
  EVALUATION_WORKSPACE_PATH,
  RATING_AUDIT_PATH,
  RATING_NOTIFICATIONS_PATH,
  RATING_EMPLOYEE_DETAIL_PATH,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
} from '../api/pending-contracts'
import type {
  CorrectEvaluationRequest,
  SubmitEvaluationRequest,
} from '../api/pending-contracts'
import {
  createRatingsRepository,
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'

function envelope(
  clock: DemoClock,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error_code: code, message, details, request_id: null, timestamp: clock.now() }
}

/**
 * Отказ формы едет СВОИМ кодом (§19.9): экран ставит сообщение рядом с полем
 * по КОДУ, а не разбирая текст сообщения. 422 — правило предметной области,
 * как и у остальных repositories проекта.
 */
function mapRepositoryError(error: unknown, clock: DemoClock): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
      status: 403,
    })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(envelope(clock, 'ENTITY_NOT_FOUND', 'Задание не найдено.'), {
      status: 404,
    })
  }
  // §19.25: конфликт редакции — 409 и СВОЙ код, которого нет в
  // `OVERRIDABLE_CODES`. Это не формальность: overridable-код открыл бы общий
  // `ConflictDialog` с кнопкой «повторить с обоснованием», а промпт прямо
  // запрещает вести конфликт версии оценки через диалог назначений.
  if (error instanceof RepositoryConflictError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message, error.details), {
      status: 409,
    })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

export function createRatingsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createRatingsRepository(adapter, clock)

  return [
    // Отправка оценки зарегистрирована ДО чтений: путь строки задания похож
    // формой на путь рабочего пространства, а MSW разрешает коллизию молча в
    // пользу первого совпавшего handler'а (инцидент Этапа 39).
    http.post(`*${EVALUATION_SUBMIT_PATH_PATTERN}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const workItemId = String(params.workItemId)
      const body = (await request.json()) as SubmitEvaluationRequest
      try {
        return HttpResponse.json(
          await repository.submitEvaluation(actorUserId, workItemId, body),
          { status: 201 },
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.post(`*${EVALUATION_CORRECT_PATH_PATTERN}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const workItemId = String(params.workItemId)
      const body = (await request.json()) as CorrectEvaluationRequest
      try {
        return HttpResponse.json(
          await repository.correctEvaluation(actorUserId, workItemId, body),
          { status: 201 },
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${EVALUATION_DETAIL_PATH_PATTERN}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(
          await repository.getSubmittedEvaluationDetail(actorUserId, String(params.workItemId)),
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${EVALUATION_WORKSPACE_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const eventId = new URL(request.url).searchParams.get('event')
      try {
        return HttpResponse.json(await repository.getEvaluationWorkspace(actorUserId, eventId))
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${EVALUATION_REGISTRY_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      // Фильтры разбираются ЗДЕСЬ, на границе: в repository приходит уже
      // типизированный объект, а не сырые строки запроса.
      const number = (name: string, fallback: number): number => {
        const raw = params.get(name)
        const parsed = raw === null ? Number.NaN : Number(raw)
        return Number.isFinite(parsed) ? parsed : fallback
      }
      try {
        return HttpResponse.json(
          await repository.listEvaluationRegistry(actorUserId, {
            from: params.get('from'),
            to: params.get('to'),
            event: params.get('event'),
            unit: params.get('unit'),
            employee: params.get('employee'),
            direction: params.get('direction') as never,
            method: params.get('method') as never,
            correctedOnly: params.get('corrected') === 'true',
            search: params.get('search') ?? '',
            page: number('page', 1),
          }),
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${RATING_NOTIFICATIONS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listRatingNotifications(actorUserId))
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${RATING_AUDIT_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const raw = Number(new URL(request.url).searchParams.get('page') ?? '1')
      try {
        return HttpResponse.json(
          await repository.listRatingAudit(actorUserId, Number.isFinite(raw) ? raw : 1),
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${RATING_EMPLOYEE_DETAIL_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const employeeId = new URL(request.url).searchParams.get('employee')
      try {
        return HttpResponse.json(
          await repository.getRatingEmployeeDetail(actorUserId, employeeId),
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${OPERATIONAL_RATINGS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listOperationalRatings(actorUserId))
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
            status: 403,
          })
        }
        throw error
      }
    }),

    http.get(`*${OPERATIONAL_RATING_DYNAMICS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const employeeId = new URL(request.url).searchParams.get('employee')
      try {
        return HttpResponse.json(await repository.getRatingDynamics(actorUserId, employeeId))
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
            status: 403,
          })
        }
        throw error
      }
    }),

    http.get(`*${RATING_ANALYTICS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.getRatingAnalytics(actorUserId))
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
            status: 403,
          })
        }
        throw error
      }
    }),
  ]
}
