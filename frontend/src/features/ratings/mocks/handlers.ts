// MSW handlers оперативного рейтинга — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
} from '../api/pending-contracts'
import { createRatingsRepository, RepositoryPermissionError } from './repository'

function envelope(clock: DemoClock, code: string, message: string): ErrorEnvelope {
  return { error_code: code, message, details: {}, request_id: null, timestamp: clock.now() }
}

export function createRatingsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createRatingsRepository(adapter, clock)

  return [
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
