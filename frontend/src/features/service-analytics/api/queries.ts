// Query hooks аналитики службы (§7.10, §5.4).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  ANALYTICS_DRILLDOWN_PATH,
  ANALYTICS_PRESETS_PATH,
  ANALYTICS_SNAPSHOT_PATH,
} from './pending-contracts'
import type {
  AnalyticsPresetsResponse,
  DrilldownQuery,
  DrilldownResponse,
  ServiceAnalyticsResponse,
} from './pending-contracts'

export interface AnalyticsPeriodRequest {
  presetCode: string | null
  from: string
  to: string
}

function periodParams(period: AnalyticsPeriodRequest): URLSearchParams {
  const params = new URLSearchParams()
  if (period.presetCode !== null) params.set('preset', period.presetCode)
  else {
    params.set('from', period.from)
    params.set('to', period.to)
  }
  return params
}

export function useAnalyticsPresets() {
  return useQuery<AnalyticsPresetsResponse, ApiFailure>({
    queryKey: ['service-analytics', 'presets'],
    queryFn: () => apiClient.get<AnalyticsPresetsResponse>(ANALYTICS_PRESETS_PATH),
    staleTime: 5 * 60_000,
  })
}

/**
 * §22.4 снимок. Период входит в ключ кэша: два периода — два РАЗНЫХ снимка, и
 * подменять один другим нельзя (у них разные `snapshotId`, а drill-down
 * привязан именно к нему).
 *
 * `enabled` — потому что до загрузки пресетов сервер не знает, какой период
 * спрашивают: §22.6 требует, чтобы значения по умолчанию приходили с сервера,
 * а не выбирались экраном.
 */
export function useServiceAnalytics(period: AnalyticsPeriodRequest | null) {
  return useQuery<ServiceAnalyticsResponse, ApiFailure>({
    queryKey: [
      'service-analytics',
      'snapshot',
      period?.presetCode ?? 'CUSTOM',
      period?.from ?? '',
      period?.to ?? '',
    ],
    queryFn: () =>
      apiClient.get<ServiceAnalyticsResponse>(
        `${ANALYTICS_SNAPSHOT_PATH}?${periodParams(period as AnalyticsPeriodRequest).toString()}`,
      ),
    enabled: period !== null,
  })
}

/**
 * §22.12 выборка показателя. Отдельный запрос, а не поле снимка: §22.12 прямо
 * запрещает передавать набор скрытых строк вместе с KPI-ответом.
 */
export function useAnalyticsDrilldown(query: DrilldownQuery | null) {
  return useQuery<DrilldownResponse, ApiFailure>({
    queryKey: [
      'service-analytics',
      'drilldown',
      query?.snapshotId ?? '',
      query?.metricCode ?? '',
      query?.cursor ?? '',
    ],
    queryFn: () => {
      const active = query as DrilldownQuery
      const params = periodParams({
        presetCode: active.presetCode,
        from: active.from,
        to: active.to,
      })
      params.set('snapshot_id', active.snapshotId)
      params.set('metric_code', active.metricCode)
      if (active.cursor !== null) params.set('cursor', active.cursor)
      return apiClient.get<DrilldownResponse>(`${ANALYTICS_DRILLDOWN_PATH}?${params.toString()}`)
    },
    enabled: query !== null,
    // Отказ по праву или устаревшему снимку повторять нечем: ответ не изменится
    // оттого, что мы спросим ещё раз.
    retry: false,
  })
}
