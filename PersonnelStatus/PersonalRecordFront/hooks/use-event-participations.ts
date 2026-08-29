"use client";

import { useQuery } from "@tanstack/react-query";

import {
  apiClient,
  type OpsEmployeeStatusRow,
  type OpsStatusParticipation,
  type StrengthReport,
} from "@/lib/api";

/** Мероприятия сотрудника на деловую дату раздела (Plane №281).
 *
 * Отвечает на вопрос «на КАКОЕ ОМ человек привлечён» — тот самый, на который
 * экран статусов не отвечал: рядом со статусом «Участие в ОМ» стояла ссылка на
 * общий разрез «Сбор сил», и чтобы найти мероприятие, надо было идти в другой
 * раздел и искать себя в списках.
 *
 * ОДИН запрос на весь экран, а не запрос на строку: `/api/operations/statuses/`
 * отдаёт участия вместе со строками статусов, и таблице в 440 человек этого
 * достаточно.
 *
 * Дата берётся ИЗ ОТВЕТА РАСХОДА, а не считается в браузере: «сегодня» по
 * часам браузера в минусовых зонах спрашивало бы вчерашний день, а без даты
 * ручка отдаёт статусы за все даты сразу — завершённое дежурство недельной
 * давности выглядело бы действующим (та же ловушка описана в
 * `use-forces-gathering`).
 */
export function useEventParticipations(enabled = true) {
  const report = useQuery<StrengthReport>({
    // Ключ ТОТ ЖЕ, что у разреза «Сбор сил»: расход за день один, и второй
    // ключ означал бы второй запрос за тем же ответом.
    queryKey: ["strength-report", "live", "today"],
    queryFn: () => apiClient.getStrengthReport({}),
    enabled,
  });

  const businessDate = report.data?.business_date ?? null;

  const statuses = useQuery<OpsEmployeeStatusRow[]>({
    queryKey: ["ops-statuses", "on", businessDate],
    queryFn: () =>
      apiClient.getOpsStatusesOn({ businessDate: businessDate as string }),
    enabled: enabled && businessDate !== null,
  });

  const byEmployee = new Map<number, OpsStatusParticipation[]>();
  for (const row of statuses.data ?? []) {
    if (row.participations.length === 0) continue;
    const already = byEmployee.get(row.employee_id) ?? [];
    byEmployee.set(row.employee_id, [...already, ...row.participations]);
  }

  return {
    byEmployee,
    businessDate,
    // «Данных ещё нет» и «мероприятий нет» — РАЗНЫЕ ответы: пока идёт запрос,
    // экран не вправе утверждать, что человек ни на что не привлечён.
    loading: report.isLoading || statuses.isLoading,
  };
}
