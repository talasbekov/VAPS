"use client";

// «Кто я» и справочники, которыми карточка расшифровывает свои коды.
import { useQuery } from "@tanstack/react-query";
import {
  apiClient,
  type CoreDivision,
  type CorePosition,
  type CoreRank,
  type MyEmployeeResponse,
  type OpsEmployeeStatusRow,
} from "@/lib/api";

/**
 * Кадровая запись самого пользователя. Ручка самообслуживающая — прав раздела
 * не спрашивает, поэтому запрос уходит всегда: включать его по праву значило
 * бы закрыть человеку его же карточку.
 *
 * Повтор выключен: «связи с кадровой записью нет» — это ответ, а не сбой, и
 * переспрашивать его нечем.
 */
export function useMyEmployee() {
  return useQuery<MyEmployeeResponse>({
    queryKey: ["my-employee"],
    queryFn: () => apiClient.getMyEmployee(),
    retry: false,
  });
}

/**
 * Справочники ядра для подписей: карточка ссылается на звание и должность
 * КОДОМ, а на подразделение — идентификатором. Справочники маленькие и
 * меняются редко, поэтому берутся целиком и надолго.
 */
export function useCoreDirectories() {
  const ranks = useQuery<CoreRank[]>({
    queryKey: ["core-ranks"],
    queryFn: () => apiClient.getCoreRanks(),
    staleTime: 10 * 60_000,
  });
  const positions = useQuery<CorePosition[]>({
    queryKey: ["core-positions"],
    queryFn: () => apiClient.getCorePositions(),
    staleTime: 10 * 60_000,
  });
  const divisions = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
  });

  return {
    /** Подпись звания по коду; неизвестный код печатается сам собой. */
    rankLabel: (code: string | null): string | null =>
      code === null
        ? null
        : (ranks.data?.find((item) => item.code === code)?.name ?? code),
    positionLabel: (code: string | null): string | null =>
      code === null
        ? null
        : (positions.data?.find((item) => item.code === code)?.name ?? code),
    divisionLabel: (id: number | null): string | null =>
      id === null
        ? null
        : (divisions.data?.find((item) => item.id === id)?.name ??
          `подразделение №${id}`),
    isLoading: ranks.isPending || positions.isPending || divisions.isPending,
  };
}

/**
 * Статусы одного сотрудника. Фильтрует СЕРВЕР: выбирать своё из общего списка
 * на клиенте значило бы сначала получить чужие строки, а потом надеяться, что
 * их никто не покажет.
 */
export function useEmployeeStatuses(employeeId: number | null) {
  return useQuery<OpsEmployeeStatusRow[]>({
    queryKey: ["ops-statuses", "employee", employeeId ?? 0],
    queryFn: () => apiClient.getOpsStatusesFor(employeeId as number),
    enabled: employeeId !== null,
  });
}
