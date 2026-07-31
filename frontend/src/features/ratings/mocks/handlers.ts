// MSW handlers оперативного рейтинга — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  EVALUATION_SUBMIT_PATH_PATTERN,
  EVALUATION_WORKSPACE_PATH,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
} from '../api/pending-contracts'
import type { SubmitEvaluationRequest } from '../api/pending-contracts'
import {
  createRatingsRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'

function envelope(clock: DemoClock, code: string, message: string): ErrorEnvelope {
  return { error_code: code, message, details: {}, request_id: null, timestamp: clock.now() }
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
