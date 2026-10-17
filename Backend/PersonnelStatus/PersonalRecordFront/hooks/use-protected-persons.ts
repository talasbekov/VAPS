"use client";

// Каталог охраняемых лиц. Справочник читается целиком: делений, кроме
// «Наши / Иностранные», у него нет, а вкладка — фильтр на клиенте.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { isReadAccessBlocked, readWithAccessCheck } from "@/lib/query-read-access";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  PROTECTED_PERSONS_PATH,
  protectedPersonHistoryPath,
  protectedPersonPhotoPath,
} from "@/entities/protected-person";
import type {
  CreateProtectedPersonRequest,
  ListPersonHistoryResponse,
  ListProtectedPersonsResponse,
  ProtectedPerson,
} from "@/entities/protected-person";

export function useProtectedPersons(options: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const key = ["ops-protected-persons"] as const;
  const query = useQuery<ListProtectedPersonsResponse, OpsApiFailure>({
    queryKey: ["ops-protected-persons"],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListProtectedPersonsResponse>(PROTECTED_PERSONS_PATH)),
    enabled: options.enabled ?? true,
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

/**
 * История ОМ охраняемого лица (Plane №38). Запрос уходит ТОЛЬКО когда историю
 * открыли: список закрытых мероприятий нужен по кнопке, а не всем строкам
 * каталога сразу.
 */
/** Заведение лица с экрана сводки ГВО (Plane №951). Каталог после этого
 * перечитывается: новое лицо должно появиться в списке выбора сразу. */
export function useCreateProtectedPerson() {
  const queryClient = useQueryClient();
  return useMutation<ProtectedPerson, OpsApiFailure, CreateProtectedPersonRequest>({
    mutationFn: (body) =>
      opsApiClient.post<ProtectedPerson>(PROTECTED_PERSONS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-protected-persons"] });
    },
  });
}

/** Снимок лица (Plane №951). Сводки перечитываются тоже: карточка лица в
 * сводке ГВО берёт снимок из справочника при сборке. */
export function useUploadProtectedPersonPhoto() {
  const queryClient = useQueryClient();
  return useMutation<ProtectedPerson, OpsApiFailure, { id: string; file: File }>({
    mutationFn: ({ id, file }) => {
      const form = new FormData();
      form.append("photo", file);
      return opsApiClient.postForm<ProtectedPerson>(protectedPersonPhotoPath(id), form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-protected-persons"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-gvo-summaries"] });
    },
  });
}

export function usePersonEventHistory(id: string | null) {
  const client = useQueryClient();
  const key = ["ops-person-history", id] as const;
  const query = useQuery<ListPersonHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-person-history", id],
    queryFn: ({ signal, queryKey }) => readWithAccessCheck(client, queryKey, signal, () =>
      opsApiClient.get<ListPersonHistoryResponse>(
        protectedPersonHistoryPath(id as string)
      )),
    enabled: id !== null,
  });
  const readAccessBlocked = isReadAccessBlocked(client, key);
  return { ...query, data: readAccessBlocked ? undefined : query.data, readAccessBlocked };
}

/** Catalog edits also refresh every summary that reads profile values. */
export function useUpdateProtectedPerson() {
  const client = useQueryClient();
  return useMutation<ProtectedPerson, OpsApiFailure, { id: string; values: CreateProtectedPersonRequest }>({
    mutationFn: ({ id, values }) => opsApiClient.patch<ProtectedPerson>(`${PROTECTED_PERSONS_PATH}${encodeURIComponent(id)}/`, values),
    onSuccess: () => {
      for (const key of ["ops-protected-persons", "ops-gvo-summary", "ops-gvo-summaries"]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
