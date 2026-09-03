"use client";

// Сборы глазами ШТАБА (Plane №271, Ш-1).
//
// Зеркало департаментского разреза: тот отвечает на вопрос «что просят у
// меня», этот — «сколько я раздал и сколько мне вернули». Вопросы разные,
// поэтому и запрос свой, а не тот же список под другим правом: колонки,
// порядок и действия не совпадают.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  securityEventForceCollectionPath,
  securityEventForceCollectionsPath,
  type ForceCollectionDetail,
  type ForceCollectionRow,
  type ForceRosterMember,
  securityEventForceTopUpPath,
  type SecurityEvent,
  type TopUpAllocationRequest,
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

/** Состав с объектами и передача (Plane №390, `[СБС-13]`) — поверх карточки
 *  сбора, тем же ответом ручки `force-collection/`. Типы здесь, а не в общем
 *  `types.ts`: читатель один — карточка штаба. */
export interface ForceCollectionObject {
  visitObjectId: string;
  objectName: string;
  /** `null` — расчёт постов по объекту не размечен (см. №387). */
  need: number | null;
  assigned: number;
}

export interface ForceHandover {
  at?: string;
  by?: string;
  comment?: string;
  shortfall?: (ForceCollectionObject & { short: number })[];
}

export type ForceCollectionWithObjects = ForceCollectionDetail & {
  roster: (ForceRosterMember & { visitObjectId?: string | null })[];
  objects: ForceCollectionObject[];
  /** `{}` — состав ещё не передан на расстановку. */
  handover: ForceHandover;
};

/** Один сбор целиком: плитки и раскладка с людьми (Plane №271, Ш-2). */
export function useForceCollection(
  eventId: string | null,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ForceCollectionWithObjects, OpsApiFailure>({
    queryKey: ["ops-force-collection", eventId],
    queryFn: () =>
      opsApiClient.get<ForceCollectionWithObjects>(
        securityEventForceCollectionPath(eventId as string)
      ),
    enabled: (options.enabled ?? true) && eventId !== null,
  });
}

/** Отдать людей состава объектам посещения (Plane №390). */
export function useAssignRosterObjects(eventId: string) {
  const client = useQueryClient();
  return useMutation<
    ForceCollectionWithObjects,
    OpsApiFailure,
    { rows: { employeeId: string; visitObjectId: string | null }[] }
  >({
    mutationFn: (body) =>
      opsApiClient.post<ForceCollectionWithObjects>(
        `${securityEventForceCollectionPath(eventId)}objects/`,
        body
      ),
    onSuccess: (data) => {
      client.setQueryData(["ops-force-collection", eventId], data);
      void client.invalidateQueries({ queryKey: FORCE_COLLECTIONS_KEY });
    },
  });
}

/** «Передать на расстановку» (Plane №390): при недоборе — с комментарием. */
export function useHandOverToPlacement(eventId: string) {
  const client = useQueryClient();
  return useMutation<ForceCollectionWithObjects, OpsApiFailure, { comment: string }>({
    mutationFn: (body) =>
      opsApiClient.post<ForceCollectionWithObjects>(
        `${securityEventForceCollectionPath(eventId)}hand-over/`,
        body
      ),
    onSuccess: (data) => {
      client.setQueryData(["ops-force-collection", eventId], data);
      void client.invalidateQueries({ queryKey: FORCE_COLLECTIONS_KEY });
      // Расстановка читает состав из карточки мероприятия — ей тоже пора.
      void client.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}


/** «Довыделить недобор → …» (`[СБС-12]`, Plane №426): новая строка запроса
 *  тому же департаменту; отвечает карточкой ОМ, сбор перечитывается. */
export function useTopUpAllocation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation<SecurityEvent, OpsApiFailure, { allocationId: string } & TopUpAllocationRequest>({
    mutationFn: ({ allocationId, ...body }) =>
      opsApiClient.post<SecurityEvent>(securityEventForceTopUpPath(eventId, allocationId), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-force-collection", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["ops-force-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}
