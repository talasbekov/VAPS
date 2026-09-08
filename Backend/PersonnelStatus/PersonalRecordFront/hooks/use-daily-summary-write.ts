"use client";

// Сборка и отправка суточного свода департамента — две СТУПЕНИ, а не одна
// (Plane №990, §20.4 п.6).
//
// ДО №990 здесь стояло другое решение — заказчик его сам отменил: «Собрать
// свод» и «Отправить дежурному» были ОДНОЙ кнопкой («сборка и ЕСТЬ заявление
// наверх»), и различить состояния «Собран» и «Отправлен дежурному» было
// нечем. Причина пересмотра — `[РАСХ-РШ-01]`: неполный свод (не все
// управления сдали) теперь разрешено СОБРАТЬ, но ОТПРАВИТЬ его можно только
// после явного предупреждения и причины — а для этого сборка и отправка
// обязаны быть разными действиями с разным моментом времени.
//
// Хранится свод по-прежнему ОДНОЙ строкой (`OpsDailySubmission` составного
// подразделения) — отправка не создаёт новую версию, а дописывает в ТУ ЖЕ
// строку факт доставки (`sent_at`/`sent_by`), тем же приёмом, что и `late`.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

/** Право сборки/отправки свода — отдельное от права сдачи дня: консолидировать
 * эшелон и отмечать статусы у себя это разные полномочия (см. докстринг
 * `DailySummaryViewSet` на бэке). Кто вправе собрать, тот вправе и отправить
 * собранное — право одно на оба действия. */
export const SUMMARY_ASSEMBLE_PERMISSION = "daily_report.generate";

export interface AssembleSummaryRequest extends Record<string, unknown> {
  division_id: number;
  business_date: string;
}

export function useAssembleSummary() {
  const client = useQueryClient();
  return useMutation<unknown, OpsApiFailure, AssembleSummaryRequest>({
    mutationFn: (body) =>
      opsApiClient.post("/api/operations/daily-summaries/", {
        ...body,
        // Полнота больше не гейтит СБОРКУ (Plane №990) — она гейтит ТОЛЬКО
        // отправку (`useSendSummary`, причина обязательна для неполной).
        // Умолчание ручки — `false` (старое поведение для читателей, не
        // знающих о смене), поэтому кнопка передаёт `true` явно.
        allow_incomplete: true,
      }),
    onSuccess: () => {
      // Свод читают ДВА разных набора ключей на РАЗНЫХ уровнях дерева
      // (Plane №992): «Свод департамента» — `daily-expense-board` (борд того
      // же подразделения), «Свод по Службе» — `service-summary` (дерево ВСЕЙ
      // организации, `useServiceTree`). Обе мутации общие для обоих экранов
      // (сборка/отправка — одно действие на любом уровне дерева), поэтому обе
      // семьи ключей инвалидируются здесь, а не в каждом экране по отдельности
      // — иначе кнопка «Собрать» осталась бы висеть после реального успеха:
      // так и было найдено (собственный e2e «Свод по Службе» ловил именно
      // это — сборка на бэке проходила, а кнопка не менялась НИКОГДА).
      void client.invalidateQueries({ queryKey: ["daily-expense-board"] });
      void client.invalidateQueries({ queryKey: ["service-summary"] });
    },
  });
}

export interface SendSummaryRequest extends Record<string, unknown> {
  division_id: number;
  business_date: string;
  reason?: string;
}

export function useSendSummary() {
  const client = useQueryClient();
  return useMutation<unknown, OpsApiFailure, SendSummaryRequest>({
    mutationFn: (body) =>
      opsApiClient.post("/api/operations/daily-summaries/send/", body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["daily-expense-board"] });
      void client.invalidateQueries({ queryKey: ["service-summary"] });
    },
  });
}
