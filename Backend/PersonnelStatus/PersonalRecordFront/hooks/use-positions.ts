import { useQuery } from "@tanstack/react-query";
import { apiClient, type Position } from "@/lib/api";
import { retryUnlessClientError } from "@/lib/query-retry";

/**
 * Справочник должностей. `enabled` — НЕ украшение (Plane №329).
 *
 * Ручка `/api/dictionaries/positions/` закрыта правом `dictionary.view`, и у
 * ролевых учёток раздела его нет. Хук живёт в диалоге заведения сотрудника, а
 * диалог смонтирован вместе со страницей — то есть справочник запрашивался при
 * ОТКРЫТИИ экрана, ещё до того, как человек нажал «Добавить», и у трёх десятков
 * учёток консоль на каждом заходе получала 403 за данные, которые никто не
 * просил. Теперь запрос идёт только при открытом диалоге.
 */
export function usePositions(enabled = true) {
  return useQuery<Position[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const data = await apiClient.getPositions();
      return data.results;
    },
    enabled,
    // Отказ по правам не станет успехом от повтора, а react-query по умолчанию
    // переспросит трижды: три 403 в сети вместо одного.
    retry: retryUnlessClientError,
    // Справочник меняется реже, чем открывают экраны: минутный staleTime
    // заставлял перезапрашивать пачки по 200 строк на каждый переход.
    staleTime: 10 * 60_000,
  });
}
