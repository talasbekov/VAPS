// MSW handlers обратной связи — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import { FEEDBACK_REQUESTS_PATH, feedbackSubmitPath } from '../api/pending-contracts'
import type { CreateFeedbackRequest } from '../api/pending-contracts'
import type { FeedbackStatusCode, FeedbackTypeCode } from '../model/types'
import {
  createFeedbackRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'

function envelope(clock: DemoClock, code: string, message: string): ErrorEnvelope {
  return { error_code: code, message, details: {}, request_id: null, timestamp: clock.now() }
}

function mapRepositoryError(error: unknown, clock: DemoClock): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
      status: 403,
    })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(envelope(clock, 'ENTITY_NOT_FOUND', 'Обращение не найдено.'), {
      status: 404,
    })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

function optional(value: string | null): string | undefined {
  return value === null ? undefined : value
}

export function createFeedbackHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createFeedbackRepository(adapter, clock)

  return [
    // Отправка черновика зарегистрирована ДО коллекции: путь строки —
    // продолжение пути реестра, а MSW разрешает коллизию молча в пользу
    // первого совпавшего handler'а (инцидент Этапа 39).
    http.post(`*${feedbackSubmitPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(
          await repository.submitFeedback(String(params.id), actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${FEEDBACK_REQUESTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      const page = Number(params.get('page') ?? '1')
      try {
        return HttpResponse.json(
          await repository.listFeedback(actorUserId, {
            search: optional(params.get('search')),
            typeCode: optional(params.get('type')) as FeedbackTypeCode | undefined,
            statusCode: optional(params.get('status')) as FeedbackStatusCode | undefined,
            moduleCode: optional(params.get('module')),
            page: Number.isFinite(page) ? page : 1,
            mine: params.get('mine') === 'true',
          }),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.post(`*${FEEDBACK_REQUESTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as CreateFeedbackRequest
      try {
        return HttpResponse.json(await repository.createFeedback(body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
  ]
}
