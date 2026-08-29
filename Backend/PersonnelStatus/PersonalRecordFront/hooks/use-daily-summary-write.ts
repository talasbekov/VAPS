"use client";

// Сборка суточного свода департамента — вторая ступень цепочки расхода
// (Plane №297, Ш-4 плана №273).
//
// Заказчик описывает её так: «Далее он нажимает на кнопку и отправляет
// Оперативному дежурному, который сводит за Организацию». Отдельного действия
// «отправить» на сервере НЕТ и заводить его не нужно: свод департамента и ЕСТЬ
// его заявление наверх — он хранится той же строкой (`OpsDailySubmission`) с
// `division_id` составного подразделения, и оперативный дежурный собирает свою
// сводку из сводов департаментов ровно так же, как департамент — из сдач
// управлений. Кнопка зовёт сборку, право у неё СВОЁ (`daily_report.generate`,
// не то же, что сдача дня управлением).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

/** Право сборки свода — отдельное от права сдачи дня: консолидировать
 * эшелон и отмечать статусы у себя это разные полномочия (см. докстринг
 * `DailySummaryViewSet` на бэке). */
export const SUMMARY_ASSEMBLE_PERMISSION = "daily_report.generate";

export interface AssembleSummaryRequest extends Record<string, unknown> {
  division_id: number;
  business_date: string;
}

export function useAssembleSummary() {
  const client = useQueryClient();
  return useMutation<unknown, OpsApiFailure, AssembleSummaryRequest>({
    mutationFn: (body) =>
      opsApiClient.post("/api/operations/daily-summaries/", body),
    onSuccess: () => {
      // Свод — часть той же семьи ключей, что и остальной борд: список версий
      // свода, сводка сдачи и строки расхода читают одно и то же состояние.
      void client.invalidateQueries({ queryKey: ["daily-expense-board"] });
    },
  });
}
