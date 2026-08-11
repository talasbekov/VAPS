"use client";

// Запросы реестра ОМ.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  SECURITY_EVENTS_PATH,
  securityEventDetailPath,
  type ListSecurityEventsParams,
  type ListSecurityEventsResponse,
  type SecurityEvent,
} from "@/entities/security-event";

function listQueryString(params: ListSecurityEventsParams): string {
  const qs = new URLSearchParams();
  if (params.search !== "") qs.set("search", params.search);
  if (params.stage !== "ALL") qs.set("stage", params.stage);
  qs.set("page", String(params.page));
  qs.set("page_size", String(params.pageSize));
  return qs.toString();
}

// options.enabled — для экранов, где реестр показывается ПО ПРАВУ
// (`event.view`): без права запрос не уходит вовсе, иначе календарь на каждом
// рендере получает с бэка 403.
export function useSecurityEvents(
  params: ListSecurityEventsParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ListSecurityEventsResponse, OpsApiFailure>({
    queryKey: ["ops-security-events", params],
    queryFn: () =>
      opsApiClient.get<ListSecurityEventsResponse>(
        `${SECURITY_EVENTS_PATH}?${listQueryString(params)}`
      ),
    enabled: options.enabled ?? true,
  });
}

export function useSecurityEvent(id: string) {
  return useQuery<SecurityEvent, OpsApiFailure>({
    queryKey: ["ops-security-events", "detail", id],
    queryFn: () =>
      opsApiClient.get<SecurityEvent>(securityEventDetailPath(id)),
    enabled: id !== "",
  });
}
