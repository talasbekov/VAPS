"use client";

// Каталог охраняемых лиц. Справочник читается целиком: делений, кроме
// «Наши / Иностранные», у него нет, а вкладка — фильтр на клиенте.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
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
  return useQuery<ListProtectedPersonsResponse, OpsApiFailure>({
    queryKey: ["ops-protected-persons"],
    queryFn: () =>
      opsApiClient.get<ListProtectedPersonsResponse>(PROTECTED_PERSONS_PATH),
    enabled: options.enabled ?? true,
  });
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
  return useQuery<ListPersonHistoryResponse, OpsApiFailure>({
    queryKey: ["ops-person-history", id],
    queryFn: () =>
      opsApiClient.get<ListPersonHistoryResponse>(
        protectedPersonHistoryPath(id as string)
      ),
    enabled: id !== null,
  });
}
