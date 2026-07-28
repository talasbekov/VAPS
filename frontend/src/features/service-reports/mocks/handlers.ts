// MSW handlers отчётного реестра — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
} from '../api/pending-contracts'
import type { CreateReportJobRequest } from '../api/pending-contracts'
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
    return HttpResponse.json(envelope(clock, 'ENTITY_NOT_FOUND', 'Артефакт не найден.'), {
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
    http.get(`*${REPORT_JOBS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listReportJobs(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
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
