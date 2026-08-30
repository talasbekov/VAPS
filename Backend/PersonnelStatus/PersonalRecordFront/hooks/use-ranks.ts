import { useQuery } from "@tanstack/react-query";
import { apiClient, type Rank } from "@/lib/api";
import { retryUnlessClientError } from "@/lib/query-retry";

/**
 * Справочник званий. Про `enabled` и почему он обязателен — см. коммент к
 * `usePositions`: та же ручка под тем же правом `dictionary.view`, тот же
 * запрос из смонтированного, но закрытого диалога (Plane №329).
 */
export function useRanks(enabled = true) {
  return useQuery<Rank[]>({
    queryKey: ["ranks"],
    queryFn: async () => {
      const data = await apiClient.getRanks();
      return data.results;
    },
    enabled,
    retry: retryUnlessClientError,
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать пачки по 200 строк на каждый переход.
    staleTime: 10 * 60_000,
  });
}
