"use client";

// Живой расход (строевая записка) — источник численности личного состава.
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import type { UseQueryResult } from "@tanstack/react-query";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  apiClient,
  type StrengthReport,
  type StrengthReportPeriod,
  type TrafficLightTree,
} from "@/lib/api";

type StrengthRead<T> = UseQueryResult<T, OpsApiFailure> &
  Pick<ReturnType<typeof useOpsProtectedRead<T>>, "readAccessBlocked" | "readKey" | "canAct">;

/** Preserve the query contract: isSuccess guarantees that data can be read. */
function strengthRead<T>(result: ReturnType<typeof useOpsProtectedRead<T>>): StrengthRead<T> {
  if (result.isSuccess && result.data === undefined) {
    return { ...result, status: "pending", isSuccess: false, isPending: true,
      isLoading: result.isFetching, isInitialLoading: result.isFetching } as StrengthRead<T>;
  }
  return result as StrengthRead<T>;
}

/**
 * Живой расход. Без `businessDate` — «сегодня» сервера по Clock раздела
 * (браузер дату не считает: в минусовых зонах «сегодня» клиента ушло бы за
 * вчера). С `businessDate` — тот же расход явно на переданный день; это и
 * есть единственный вход даты для «Ежедневного расхода» (Plane №988) — экран
 * передаёт СВОЙ businessDate, а не полагается на умолчание сервера.
 *
 * Область видимости сужает выборку на сервере всегда, право чтения —
 * `status.view`; без него бэк отвечает 403, поэтому запрос включается только
 * при наличии права (иначе экран ловил бы отказ как «ошибку загрузки»).
 */
export function useStrengthReport(enabled: boolean, businessDate?: string) {
  const access = useOpsReadAccess("status.view");
  return strengthRead<StrengthReport>(useOpsProtectedRead<StrengthReport>(["strength-report", "live"], [businessDate ?? "today"], access,
    () => apiClient.getStrengthReport({ businessDate }), { enabled, staleTime: 60_000 }));
}

/**
 * Расход за ПЕРИОД — страница на дату; источник ряда «динамики доступности».
 *
 * Даты приходят снаружи (из периода аналитического снимка), а не считаются
 * здесь: экран показывает ряд ровно за тот период, за который посчитаны
 * показатели, иначе график и плитки говорили бы о разных днях.
 */
export function useStrengthReportPeriod(
  period: { from: string; to: string } | null,
  enabled: boolean,
  // Плановые дни (Plane №1197): «расход по датам» у ответственного смотрит
  // вперёд — на завтра и дальше, — а `FACT` (умолчание) закрыт для будущего.
  mode?: "FACT" | "PLAN"
) {
  const access = useOpsReadAccess("status.view");
  return strengthRead<StrengthReportPeriod>(useOpsProtectedRead<StrengthReportPeriod>(["strength-report", "period"],
    [period?.from ?? "", period?.to ?? "", mode ?? "FACT"], access, () =>
      apiClient.getStrengthReportPeriod({
        dateFrom: (period as { from: string; to: string }).from,
        dateTo: (period as { from: string; to: string }).to,
        mode,
      }), { enabled: enabled && period !== null, staleTime: 60_000 }));
}

/**
 * Светофор сдачи дня — та же дата, что и у расхода (см. `useStrengthReport`):
 * без `businessDate` сервер отвечает про «сегодня», с ним — про переданный
 * день. «Ежедневный расход» обязан передавать один и тот же businessDate
 * сюда и в расход — иначе дерево сдачи и плитки численности говорили бы о
 * разных днях (Plane №988).
 */
export function useTrafficLightTree(enabled: boolean, businessDate?: string) {
  const access = useOpsReadAccess("status.view");
  return strengthRead<TrafficLightTree>(useOpsProtectedRead<TrafficLightTree>(["traffic-light", "tree"], [businessDate ?? "today"], access,
    () => apiClient.getTrafficLightTree({ businessDate }), { enabled, staleTime: 60_000 }));
}
