// MSW handlers отчётного реестра — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
  reportJobPath,
  reportJobRerunPath,
} from '../api/pending-contracts'
import type { CreateReportJobRequest } from '../api/pending-contracts'
import type { ReportJobState } from '../model/types'
import {
  createServiceReportsRepository,
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
    // Одно сообщение и на артефакт, и на работу: разные тексты подсказывали бы,
    // существует ли скрытая от смотрящего выгрузка.
    return HttpResponse.json(envelope(clock, 'ENTITY_NOT_FOUND', 'Запись не найдена.'), {
      status: 404,
    })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

export function createServiceReportsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createServiceReportsRepository(adapter, clock)

  return [
    http.get(`*${REPORT_TYPES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listReportTypes(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    // §22.27 карточка работы. Зарегистрирована ДО коллекции намеренно: путь
    // строки — продолжение пути реестра, и порядок handler'ов в MSW значим
    // (коллизия разрешается молча в пользу первого — инцидент Этапа 39).
    http.get(`*${reportJobPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.getReportJob(String(params.id), actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${REPORT_JOBS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      const state = params.get('state')
      try {
        return HttpResponse.json(
          await repository.listReportJobs(actorUserId, {
            state: state === null ? undefined : (state as ReportJobState),
            mine: params.get('mine') === 'true',
          }),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    ...(['RETRY', 'NEW_REVISION'] as const).map((mode) =>
      http.post(`*${reportJobRerunPath(':id', mode)}`, async ({ request, params }) => {
        const actorUserId = request.headers.get('X-User-Id')
        try {
          return HttpResponse.json(
            await repository.rerunReportJob(String(params.id), mode, actorUserId),
          )
        } catch (error) {
          return mapRepositoryError(error, clock) ?? HttpResponse.error()
        }
      }),
    ),
    http.post(`*${REPORT_JOBS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as CreateReportJobRequest
      try {
        return HttpResponse.json(await repository.createReportJob(body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.post(`*${reportArtifactDownloadPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(
          await repository.downloadArtifact(String(params.id), actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
  ]
}
