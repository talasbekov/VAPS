"use client";

// Каталог охраняемых лиц. Справочник читается целиком: делений, кроме
// «Наши / Иностранные», у него нет, а вкладка — фильтр на клиенте.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { PROTECTED_PERSONS_PATH } from "@/entities/protected-person";
import type { ListProtectedPersonsResponse } from "@/entities/protected-person";

export function useProtectedPersons(options: { enabled?: boolean } = {}) {
  return useQuery<ListProtectedPersonsResponse, OpsApiFailure>({
    queryKey: ["ops-protected-persons"],
    queryFn: () =>
      opsApiClient.get<ListProtectedPersonsResponse>(PROTECTED_PERSONS_PATH),
    enabled: options.enabled ?? true,
  });
}
