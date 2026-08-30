"use client";

import { useQuery } from "@tanstack/react-query";

import {
  apiClient,
  type OpsEmployeeStatusRow,
  type OpsStatusParticipation,
  type OpsStatusType,
  type StrengthReport,
} from "@/lib/api";

/** Учёт РАЗДЕЛА ОМ по сотруднику на деловую дату: статус и мероприятия.
 *
 * Хук назывался `useEventParticipations` и отдавал одни участия (Plane №281).
 * С №314 экран статусов показывает учёт раздела ОТДЕЛЬНОЙ КОЛОНКОЙ, и колонке
 * нужен сам статус раздела, а не только «на какое ОМ привлечён». Имя менялось
 * вместе с работой: хук, отдающий статус, но названный «участиями», врал бы о
 * себе первому же читателю.
 *
 * Мероприятия сотрудника на деловую дату раздела (Plane №281).
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
/** Статус сотрудника ПО КАТАЛОГУ РАЗДЕЛА: код и его имя из справочника. */
export interface OpsSectionStatus {
  code: string;
  name: string;
}

export function useOpsSectionStatuses(enabled = true) {
  const report = useQuery<StrengthReport>({
    // Ключ ТОТ ЖЕ, что у разреза «Сбор сил»: расход за день один, и второй
    // ключ означал бы второй запрос за тем же ответом.
    queryKey: ["strength-report", "live", "today"],
    queryFn: () => apiClient.getStrengthReport({}),
    enabled,
  });

  const businessDate = report.data?.business_date ?? null;

  const statusTypes = useQuery<OpsStatusType[]>({
    // Ключ ТОТ ЖЕ, что у разреза «Сбор сил»: справочник один, и второй ключ
    // означал бы второй запрос за тем же ответом.
    queryKey: ["ops-status-types"],
    queryFn: () => apiClient.getOpsStatusTypes(),
    // Справочник меняется в админке, а не по ходу дня.
    staleTime: 5 * 60 * 1000,
    enabled,
  });

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

  // Имена кодов — ИЗ СПРАВОЧНИКА раздела, а не своим словарём на клиенте
  // (Plane №314): каталог правится в админке, и копия разошлась бы с ним при
  // первой же правке. Незнакомый код печатается сам собой — он должен быть
  // виден, а не исчезнуть под пустой подписью.
  const nameOfCode = new Map(
    (statusTypes.data ?? []).map((type) => [type.code, type.name])
  );

  // 🔴 ДЕЙСТВУЮЩИЙ статус раздела, а не первый попавшийся. Ручка отдаёт и
  // запланированные, и отменённые строки; колонка обязана показывать то, что
  // ВЕРНО НА ДЕНЬ. Регистр кода состояния здесь ПРОПИСНОЙ — у кадровой ручки
  // он строчный, и это расхождение закреплено решением заказчика (№317):
  // сравнивать состояния двух каталогов между собой нельзя вовсе, каждый
  // читается своим регистром.
  const statusByEmployee = new Map<number, OpsSectionStatus>();
  for (const row of statuses.data ?? []) {
    if (row.state !== "ACTIVE") continue;
    const known = statusByEmployee.get(row.employee_id);
    // Строк может быть несколько (человек и на дежурстве, и привлечён);
    // берётся первая действующая, остальные видны участиями ниже.
    if (known !== undefined) continue;
    statusByEmployee.set(row.employee_id, {
      code: row.status_type_code,
      name: nameOfCode.get(row.status_type_code) ?? row.status_type_code,
    });
  }

  return {
    byEmployee,
    statusByEmployee,
    businessDate,
    // «Данных ещё нет» и «мероприятий нет» — РАЗНЫЕ ответы: пока идёт запрос,
    // экран не вправе утверждать, что человек ни на что не привлечён.
    loading: report.isLoading || statuses.isLoading || statusTypes.isLoading,
  };
}
