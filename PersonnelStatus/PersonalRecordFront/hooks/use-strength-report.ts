"use client";

// Живой расход (строевая записка) — источник численности личного состава.
import { useQuery } from "@tanstack/react-query";
import { apiClient, type StrengthReport } from "@/lib/api";

/**
 * Расход за СЕГОДНЯ. Дата намеренно не передаётся: её ставит сервер по Clock
 * раздела, а «сегодня», посчитанное в браузере, зависело бы от зоны машины —
 * в минусовых зонах запрос уходил бы за вчерашний день.
 *
 * Область видимости сужает выборку на сервере всегда, право чтения —
 * `status.view`; без него бэк отвечает 403, поэтому запрос включается только
 * при наличии права (иначе экран ловил бы отказ как «ошибку загрузки»).
 */
export function useStrengthReport(enabled: boolean) {
  return useQuery<StrengthReport>({
    queryKey: ["strength-report", "live", "today"],
    queryFn: () => apiClient.getStrengthReport({}),
    enabled,
  });
}
