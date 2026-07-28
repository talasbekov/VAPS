// MSW handlers аналитики службы — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  ANALYTICS_DRILLDOWN_PATH,
  ANALYTICS_PRESETS_PATH,
  ANALYTICS_SNAPSHOT_PATH,
} from '../api/pending-contracts'
import {
  createServiceAnalyticsRepository,
  RepositoryBusinessRuleError,
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
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

/** Пустая строка и отсутствующий параметр — одно и то же: `?preset=` в URL
 * появляется при сбросе фильтра, и трактовать его как код пресета значило бы
 * искать пресет с пустым именем. */
function param(value: string | null): string | null {
  return value === null || value === '' ? null : value
}

export function createServiceAnalyticsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createServiceAnalyticsRepository(adapter, clock)

  return [
    http.get(`*${ANALYTICS_PRESETS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listPresets(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${ANALYTICS_DRILLDOWN_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      try {
        return HttpResponse.json(
          await repository.getDrilldown(actorUserId, {
            snapshotId: params.get('snapshot_id') ?? '',
            metricCode: params.get('metric_code') ?? '',
            presetCode: param(params.get('preset')),
            from: params.get('from') ?? '',
            to: params.get('to') ?? '',
            cursor: param(params.get('cursor')),
          }),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${ANALYTICS_SNAPSHOT_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const params = new URL(request.url).searchParams
      try {
        return HttpResponse.json(
          await repository.getServiceAnalytics(actorUserId, {
            presetCode: param(params.get('preset')),
            from: params.get('from') ?? '',
            to: params.get('to') ?? '',
          }),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
  ]
}
