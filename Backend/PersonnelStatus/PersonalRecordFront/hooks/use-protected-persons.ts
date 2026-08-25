"use client";

// Каталог охраняемых лиц. Справочник читается целиком: делений, кроме
// «Наши / Иностранные», у него нет, а вкладка — фильтр на клиенте.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  PROTECTED_PERSONS_PATH,
  protectedPersonHistoryPath,
} from "@/entities/protected-person";
import type {
  ListPersonHistoryResponse,
  ListProtectedPersonsResponse,
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
