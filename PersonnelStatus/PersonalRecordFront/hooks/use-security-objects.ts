"use client";

// Запросы реестра объектов ОМ (конвенция OLD: hooks поверх клиента).
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import type { ListObjectHistoryResponse } from "@/entities/protected-person";
import {
  OPS_OBJECTS_PATH,
  objectDetailPath,
  objectHistoryPath,
  type ListObjectsResponse,
  type SecurityObject,
} from "@/entities/security-object";

export function useSecurityObjects() {
  return useQuery<ListObjectsResponse, OpsApiFailure>({
    queryKey: ["ops-objects"],
    queryFn: () => opsApiClient.get<ListObjectsResponse>(OPS_OBJECTS_PATH),
  });
}

export function useSecurityObject(id: string) {
  return useQuery<SecurityObject, OpsApiFailure>({
    queryKey: ["ops-objects", id],
    queryFn: () => opsApiClient.get<SecurityObject>(objectDetailPath(id)),
    enabled: id !== "",
  });
}

/** История ОМ на объекте (Plane №38). Запрос — только по открытию истории. */
export function useObjectEventHistory(id: string | null) {
  return useQuery<ListObjectHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-object-history", id],
    queryFn: () =>
      opsApiClient.get<ListObjectHistoryResponse>(
        objectHistoryPath(id as string)
      ),
    enabled: id !== null,
  });
}
