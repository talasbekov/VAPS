"use client";

// Запросы реестра объектов ОМ (конвенция OLD: hooks поверх клиента).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import type { OpsApiFailure } from "@/lib/ops-errors";
import type { ListObjectHistoryResponse } from "@/entities/protected-person";
import {
  OPS_OBJECTS_PATH,
  objectDetailPath,
  objectHistoryPath,
  objectPhotoPath,
  type ListObjectsResponse,
  type SecurityObject,
} from "@/entities/security-object";

export function useSecurityObjects(options: { enabled?: boolean; fresh?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-objects"] as const;
  const query = useQuery<ListObjectsResponse, OpsApiFailure>({
    queryKey: ["ops-objects"],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListObjectsResponse>(OPS_OBJECTS_PATH)),
    enabled: options.enabled ?? true,
    ...(options.fresh ? { staleTime: 0, refetchOnMount: "always" as const } : {}),
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

export function useSecurityObject(id: string, options: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-objects", id] as const;
  const query = useQuery<SecurityObject, OpsApiFailure>({
    queryKey: ["ops-objects", id],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<SecurityObject>(objectDetailPath(id))),
    enabled: id !== "" && (options.enabled ?? true),
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

/** Снимок объекта-каталога (Plane SJ-1049). Реестр перечитывается: карточка
 * объекта в раскрытии «Реестра ОМ» берёт снимок из каталога, а не хранит
 * свою копию. */
export function useUploadObjectPhoto() {
  const queryClient = useQueryClient();
  return useMutation<SecurityObject, OpsApiFailure, { id: string; file: File }>({
    mutationFn: ({ id, file }) => {
      const form = new FormData();
      form.append("photo", file);
      return opsApiClient.postForm<SecurityObject>(objectPhotoPath(id), form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-objects"] });
    },
  });
}

/** История ОМ на объекте (Plane №38). Запрос — только по открытию истории. */
export function useObjectEventHistory(id: string | null) {
  const client = useQueryClient();
  const key = ["ops-object-history", id] as const;
  const query = useQuery<ListObjectHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-object-history", id],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListObjectHistoryResponse>(
        objectHistoryPath(id as string)
      )),
    enabled: id !== null,
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}
