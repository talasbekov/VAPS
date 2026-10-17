"use client";

// Живой расход (строевая записка) — источник численности личного состава.
import { useQuery } from "@tanstack/react-query";
import {
  apiClient,
  type StrengthReport,
  type StrengthReportPeriod,
  type TrafficLightTree,
} from "@/lib/api";

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
  return useQuery<StrengthReport>({
    queryKey: ["strength-report", "live", businessDate ?? "today"],
    queryFn: () => apiClient.getStrengthReport({ businessDate }),
    enabled,
  });
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
  return useQuery<StrengthReportPeriod>({
    queryKey: ["strength-report", "period", period?.from ?? "", period?.to ?? "", mode ?? "FACT"],
    queryFn: () =>
      apiClient.getStrengthReportPeriod({
        dateFrom: (period as { from: string; to: string }).from,
        dateTo: (period as { from: string; to: string }).to,
        mode,
      }),
    enabled: enabled && period !== null,
  });
}

/**
 * Светофор сдачи дня — та же дата, что и у расхода (см. `useStrengthReport`):
 * без `businessDate` сервер отвечает про «сегодня», с ним — про переданный
 * день. «Ежедневный расход» обязан передавать один и тот же businessDate
 * сюда и в расход — иначе дерево сдачи и плитки численности говорили бы о
 * разных днях (Plane №988).
 */
export function useTrafficLightTree(enabled: boolean, businessDate?: string) {
  return useQuery<TrafficLightTree>({
    queryKey: ["traffic-light", "tree", businessDate ?? "today"],
    queryFn: () => apiClient.getTrafficLightTree({ businessDate }),
    enabled,
  });
}
