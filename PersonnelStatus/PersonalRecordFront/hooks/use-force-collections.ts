"use client";

// Сборы глазами ШТАБА (Plane №271, Ш-1).
//
// Зеркало департаментского разреза: тот отвечает на вопрос «что просят у
// меня», этот — «сколько я раздал и сколько мне вернули». Вопросы разные,
// поэтому и запрос свой, а не тот же список под другим правом: колонки,
// порядок и действия не совпадают.
import { useQuery } from "@tanstack/react-query";

import {
  securityEventForceCollectionPath,
  securityEventForceCollectionsPath,
  type ForceCollectionDetail,
  type ForceCollectionRow,
} from "@/entities/security-event";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

export const FORCE_COLLECTIONS_KEY = ["ops-force-collections"] as const;

export function useForceCollections(options: { enabled?: boolean } = {}) {
  return useQuery<{ results: ForceCollectionRow[] }, OpsApiFailure>({
    queryKey: FORCE_COLLECTIONS_KEY,
    queryFn: () =>
      opsApiClient.get<{ results: ForceCollectionRow[] }>(
        securityEventForceCollectionsPath()
      ),
    enabled: options.enabled ?? true,
  });
}

/** Один сбор целиком: плитки и раскладка с людьми (Plane №271, Ш-2). */
export function useForceCollection(
  eventId: string | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ForceCollectionDetail, OpsApiFailure>({
    queryKey: ["ops-force-collection", eventId],
    queryFn: () =>
      opsApiClient.get<ForceCollectionDetail>(
        securityEventForceCollectionPath(eventId as string)
      ),
    enabled: (options.enabled ?? true) && eventId !== null,
  });
}
