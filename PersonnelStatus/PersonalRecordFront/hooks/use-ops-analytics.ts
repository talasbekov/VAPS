"use client";

// Query-хуки аналитики службы (/security-ops/analytics*). Период входит в ключ
// кэша: два периода — два РАЗНЫХ снимка с разными snapshotId, и подменять один
// другим нельзя (drill-down привязан к снимку).
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  ANALYTICS_ATTENTION_PATH,
  ANALYTICS_DRILLDOWN_PATH,
  ANALYTICS_PRESETS_PATH,
  ANALYTICS_SNAPSHOT_PATH,
  LOAD_ANALYTICS_PATH,
  OPERATIONS_ANALYTICS_PATH,
} from "@/entities/service-analytics";
import type {
  AnalyticsPresetsResponse,
  AttentionResponse,
  DrilldownQuery,
  DrilldownResponse,
  LoadAnalyticsResponse,
  OperationsAnalyticsResponse,
  OperationsQuery,
  ServiceAnalyticsResponse,
} from "@/entities/service-analytics";

export interface AnalyticsPeriodRequest {
  presetCode: string | null;
  from: string;
  to: string;
}

function periodParams(period: AnalyticsPeriodRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (period.presetCode !== null) params.set("preset", period.presetCode);
  else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return params;
}

export function useAnalyticsPresets() {
  return useQuery<AnalyticsPresetsResponse, OpsApiFailure>({
    queryKey: ["ops-analytics", "presets"],
    queryFn: () =>
      opsApiClient.get<AnalyticsPresetsResponse>(ANALYTICS_PRESETS_PATH),
    staleTime: 5 * 60_000,
  });
}

/** §22.4 снимок. `enabled` — до загрузки пресетов период спрашивать нечем:
 * значения по умолчанию приходят с сервера (§22.6). */
export function useServiceAnalytics(period: AnalyticsPeriodRequest | null) {
  return useQuery<ServiceAnalyticsResponse, OpsApiFailure>({
    queryKey: [
      "ops-analytics",
      "snapshot",
      period?.presetCode ?? "CUSTOM",
      period?.from ?? "",
      period?.to ?? "",
    ],
    queryFn: () =>
      opsApiClient.get<ServiceAnalyticsResponse>(
        `${ANALYTICS_SNAPSHOT_PATH}?${periodParams(period as AnalyticsPeriodRequest).toString()}`
      ),
    enabled: period !== null,
  });
}

/** §22.11: отдельный запрос — наблюдения делает другой детектор с другой
 * политикой; приехав полем снимка KPI, они читались бы как его следствие. */
export function useAttentionItems(period: AnalyticsPeriodRequest | null) {
  return useQuery<AttentionResponse, OpsApiFailure>({
    queryKey: [
      "ops-analytics",
      "attention",
      period?.presetCode ?? "CUSTOM",
      period?.from ?? "",
      period?.to ?? "",
    ],
    queryFn: () =>
      opsApiClient.get<AttentionResponse>(
        `${ANALYTICS_ATTENTION_PATH}?${periodParams(period as AnalyticsPeriodRequest).toString()}`
      ),
    enabled: period !== null,
  });
}

/** §22.9: периодом владеет политика — параметров запроса нет. */
export function useLoadAnalytics() {
  return useQuery<LoadAnalyticsResponse, OpsApiFailure>({
    queryKey: ["ops-analytics", "load"],
    queryFn: () => opsApiClient.get<LoadAnalyticsResponse>(LOAD_ANALYTICS_PATH),
  });
}

/** §22.13-22.15: уровень и цель — в ключе кэша целиком. */
export function useOperationsAnalytics(query: OperationsQuery) {
  return useQuery<OperationsAnalyticsResponse, OpsApiFailure>({
    queryKey: [
      "ops-analytics",
      "operations",
      query.level,
      query.objectId ?? "",
      query.eventId ?? "",
      query.directionId ?? "",
      query.postId ?? "",
    ],
    queryFn: () => {
      const params = new URLSearchParams({ level: query.level });
      if (query.objectId !== undefined) params.set("object_id", query.objectId);
      if (query.eventId !== undefined) params.set("event_id", query.eventId);
      if (query.directionId !== undefined)
        params.set("direction_id", query.directionId);
      if (query.postId !== undefined) params.set("post_id", query.postId);
      return opsApiClient.get<OperationsAnalyticsResponse>(
        `${OPERATIONS_ANALYTICS_PATH}?${params.toString()}`
      );
    },
    // Несуществующая цель уровня — отказ по смыслу, повторять его нечем.
    retry: false,
  });
}

/** §22.12: отдельный запрос — набор строк не едет вместе с KPI-ответом. */
export function useAnalyticsDrilldown(query: DrilldownQuery | null) {
  return useQuery<DrilldownResponse, OpsApiFailure>({
    queryKey: [
      "ops-analytics",
      "drilldown",
      query?.snapshotId ?? "",
      query?.metricCode ?? "",
      query?.cursor ?? "",
    ],
    queryFn: () => {
      const active = query as DrilldownQuery;
      const params = periodParams({
        presetCode: active.presetCode,
        from: active.from,
        to: active.to,
      });
      params.set("snapshot_id", active.snapshotId);
      params.set("metric_code", active.metricCode);
      if (active.cursor !== null) params.set("cursor", active.cursor);
      return opsApiClient.get<DrilldownResponse>(
        `${ANALYTICS_DRILLDOWN_PATH}?${params.toString()}`
      );
    },
    enabled: query !== null,
    // Отказ по устаревшему снимку повторять нечем.
    retry: false,
  });
}
