"use client";

// Запросы реестра объектов ОМ (конвенция OLD: hooks поверх клиента).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
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
  return useQuery<ListObjectHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-object-history", id],
    queryFn: () =>
      opsApiClient.get<ListObjectHistoryResponse>(
        objectHistoryPath(id as string)
      ),
    enabled: id !== null,
  });
}
