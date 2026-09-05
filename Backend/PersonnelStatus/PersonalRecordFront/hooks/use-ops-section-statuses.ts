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

/**
 * Ключ участия ПО ТОМУ, ЧТО ВИДНО В СТРОКЕ (Plane №819).
 *
 * Им же сводятся повторы в `byEmployee` и адресуются узлы списка в
 * `SectionAccountCell`: ключ, собранный из чего-то другого (например из одного
 * `event_id`), либо склеил бы РАЗНЫЕ строки одного мероприятия, либо оставил
 * бы React два узла с одним ключом.
 */
export function participationLabelKey(participation: {
  event_id: number;
  visit_object_name?: string;
  post_label?: string;
  acknowledged_at?: string | null;
}): string {
  return [
    participation.event_id,
    participation.visit_object_name ?? "",
    participation.post_label ?? "",
    participation.acknowledged_at ? "1" : "0",
  ].join("|");
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

  // 🔴 ОДНО УЧАСТИЕ — ОДНА СТРОКА В ЯЧЕЙКЕ (Plane №819). Строк статуса у
  // сотрудника на день бывает НЕСКОЛЬКО, и одно и то же участие приезжает на
  // каждой из них: на стенде у сотрудника 1 две действующие строки `IN_EVENT`,
  // обе несут `ОМ-2026-11#3264`. Склейка без сведения печатала эту ссылку
  // дважды — ячейка утверждала «привлечён на ОМ дважды», факт о расстановке,
  // которого нет, — и заодно давала React два узла с одним ключом (тот же
  // класс, что №482).
  //
  // Сводим ПО ВИДИМОЙ ПОДПИСИ, а не по `event_id`: у одного мероприятия
  // законно бывает несколько участий — разные объект посещения и пост, и они
  // обязаны остаться видимыми каждое своей строкой. Одинаково выглядящие
  // строки не несут ничего, кроме повтора.
  const byEmployee = new Map<number, OpsStatusParticipation[]>();
  const seenByEmployee = new Map<number, Set<string>>();
  for (const row of statuses.data ?? []) {
    if (row.participations.length === 0) continue;
    const kept = byEmployee.get(row.employee_id) ?? [];
    const seen = seenByEmployee.get(row.employee_id) ?? new Set<string>();
    for (const participation of row.participations) {
      const key = participationLabelKey(participation);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(participation);
    }
    byEmployee.set(row.employee_id, kept);
    seenByEmployee.set(row.employee_id, seen);
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
