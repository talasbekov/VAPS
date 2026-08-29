"use client";

// Данные экрана «Сбор сил на ОМ»: кого собрали на мероприятия и кто остался.
//
// Источников ТРИ, и каждый отвечает за своё:
//
// 1. РАСХОД (`strength-report`) — знаменатели: штат, список и колонки
//    состояний по подразделениям. Свой счёт личного состава здесь заводить
//    нельзя: владелец этих чисел один, и второй посчитал бы иначе.
// 2. СТАТУСЫ на деловую дату — поимённый разрез. Он нужен именно потому, что
//    расход его НЕ даёт: «Привлечён на мероприятие» ложится в колонку «В
//    строю» (`report_column_code`), и из расхода эти две группы неразличимы.
// 3. СПРАВОЧНИК типов — чтобы «в строю» определялось колонкой расхода, а не
//    списком кодов, переписанным на фронте.
//
// Люди по подразделениям берутся адаптером расхода дня
// (`/api/ops/daily/employees/`): он даёт ФИО и звание, которых нет ни в
// статусе, ни в расходе. Запрос на подразделение — своя строка кэша: список
// личного состава меняется несравнимо реже статусов.
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type {
  OpsEmployeeStatusRow,
  OpsStatusType,
  StrengthReport,
} from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import {
  DAILY_EMPLOYEES_PATH,
  EVENT_PARTICIPATION_STATUS_CODES,
} from "@/entities/daily-grid";

/** Код статуса «Участие в ОМ» из справочника раздела.
 *
 * 🔴 ОДНОГО КОДА МАЛО, и это стоило разреза (Plane №274, Ш-5). Участий в ОМ
 * ДВА: физический наряд (`EVENT_ASSIGNMENT`) и специфическая группа
 * (`EVENT_ASSIGNMENT_GROUP`). Разрез знал только первый, поэтому человек,
 * привлечённый группой досмотра, не попадал в выделенные — и, что хуже,
 * `isInService` относила его к «В строю»: расход показывал его свободным и
 * предлагал на новое привлечение. Проверять надо ОБА кода, и список у них
 * теперь общий с диалогом постановки статуса. */
export const EVENT_ASSIGNMENT_CODE = "EVENT_ASSIGNMENT";

/** Колонка расхода, в которую ложится «в строю» (и, увы, участие в ОМ). */
export const IN_SERVICE_COLUMN = "IN_SERVICE";

export interface GatheringPerson {
  employeeId: number;
  fullName: string;
  rankCode: string;
  divisionId: number;
  divisionName: string;
  /** Код активного статуса; null — статуса нет вовсе, что и есть «в строю». */
  statusCode: string | null;
  statusLabel: string | null;
}

interface DailyEmployeesResponse {
  results: { id: string; full_name: string; rank_code: string }[];
}

export function useForcesGathering() {
  const report = useQuery<StrengthReport>({
    queryKey: ["strength-report", "live", "today"],
    queryFn: () => apiClient.getStrengthReport({}),
  });

  const statusTypes = useQuery<OpsStatusType[]>({
    queryKey: ["ops-status-types"],
    queryFn: () => apiClient.getOpsStatusTypes(),
    // Справочник меняется в админке, а не по ходу дня.
    staleTime: 5 * 60 * 1000,
  });

  // Дата берётся ИЗ ОТВЕТА РАСХОДА, а не считается в браузере и не опускается.
  //
  // 🔴 Опустить её нельзя: без `business_date` ручка не фильтрует по дню вовсе
  // и отдаёт статусы ЗА ВСЕ ДАТЫ — завершённое дежурство недельной давности
  // перетирало живое состояние, и человек, стоящий в строю, выпадал из счёта
  // (проверено живой пробой: 10 против 12 в расходе).
  //
  // Считать «сегодня» в браузере тоже нельзя: в минусовых зонах запрос уходил
  // бы за вчера. Дата раздела приезжает вместе с расходом — тем самым оба
  // блока экрана говорят об одном дне по построению.
  const businessDate = report.data?.business_date ?? null;
  const statuses = useQuery<OpsEmployeeStatusRow[]>({
    queryKey: ["ops-statuses", "on", businessDate],
    queryFn: () =>
      apiClient.getOpsStatusesOn({ businessDate: businessDate as string }),
    enabled: businessDate !== null,
  });

  const divisions = report.data?.rows ?? [];
  const people = useQueries({
    queries: divisions.map((row) => ({
      queryKey: ["daily-employees", row.division_id],
      queryFn: () =>
        opsApiClient.get<DailyEmployeesResponse>(
          `${DAILY_EMPLOYEES_PATH}?division_id=${row.division_id}`
        ),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const statusByEmployee = new Map<number, OpsEmployeeStatusRow>();
  for (const row of statuses.data ?? []) {
    // 🔴 ПЕРЕЗАПИСЬ ТЕРЯЛА ДАННЫЕ. Здесь стояло «активный статус на сотрудника
    // ОДИН, поэтому перезапись безопасна» — и это неправда о ВЫДАЧЕ: список
    // отфильтрован деловой датой, а в один день у человека законно живут две
    // строки (действующая и запланированная на завтра-послезавтра, начатая
    // сегодня). Побеждала последняя в порядке `-date_start`, то есть самая
    // СТАРАЯ, и участие в ОМ пропадало под ней.
    //
    // Замерено на стенде 29.08.2026: плитка «Участие в ОМ» показывала 51 при
    // 52 привлечённых по данным сервера — ровно один сотрудник (id 9) с двумя
    // строками. Дефект тихий: число выглядит правдоподобным и не проверяется
    // глазом.
    //
    // Правило выбора — ДЕЙСТВУЮЩАЯ строка, а при нескольких действующих
    // первая (список идёт от позднего начала к раннему).
    const kept = statusByEmployee.get(row.employee_id);
    if (kept === undefined) {
      statusByEmployee.set(row.employee_id, row);
      continue;
    }
    if (kept.state !== "ACTIVE" && row.state === "ACTIVE") {
      statusByEmployee.set(row.employee_id, row);
    }
  }

  const typeByCode = new Map<string, OpsStatusType>();
  for (const type of statusTypes.data ?? []) typeByCode.set(type.code, type);

  const persons: GatheringPerson[] = [];
  divisions.forEach((row, index) => {
    const response = people[index]?.data;
    for (const person of response?.results ?? []) {
      const employeeId = Number(person.id);
      if (!Number.isFinite(employeeId)) continue;
      const status = statusByEmployee.get(employeeId) ?? null;
      persons.push({
        employeeId,
        fullName: person.full_name,
        rankCode: person.rank_code,
        divisionId: row.division_id,
        divisionName: row.name,
        statusCode: status?.status_type_code ?? null,
        statusLabel:
          status === null
            ? null
            : typeByCode.get(status.status_type_code)?.name ??
              status.status_type_code,
      });
    }
  });

  /** «В строю» — не список кодов, а КОЛОНКА расхода: отсутствие статуса и
   * любой статус, который расход относит к строю, кроме участия в ОМ (его
   * справочник кладёт в ту же колонку, и не вычесть его значило бы посчитать
   * привлечённого дважды). */
  function isInService(person: GatheringPerson): boolean {
    if (person.statusCode === null) return true;
    if (EVENT_PARTICIPATION_STATUS_CODES.has(person.statusCode)) return false;
    return (
      typeByCode.get(person.statusCode)?.report_column_code ===
      IN_SERVICE_COLUMN
    );
  }

  const assigned = persons.filter(
    (person) =>
      person.statusCode !== null &&
      EVENT_PARTICIPATION_STATUS_CODES.has(person.statusCode)
  );
  const inService = persons.filter(isInService);

  const totals = report.data?.totals;
  return {
    isPending:
      report.isPending ||
      // Пока даты нет, запрос статусов ещё не запускался: `isPending` у
      // отключённого запроса истинно, и без этой оговорки экран висел бы в
      // загрузке навсегда, если бы расход отказал.
      (businessDate !== null && statuses.isPending) ||
      statusTypes.isPending ||
      people.some((query) => query.isPending),
    isError: report.isError || statuses.isError || statusTypes.isError,
    businessDate,
    // Знаменатели — из расхода как есть.
    staffTotal: totals?.staff_total ?? 0,
    listTotal: totals?.list_total ?? 0,
    // Колонка «в строю» расхода несёт и привлечённых на ОМ; на экране она
    // раскладывается на две — иначе «осталось» было бы больше, чем есть.
    inServiceColumn: totals?.columns?.[IN_SERVICE_COLUMN] ?? 0,
    assigned,
    inService,
    persons,
    divisions,
  };
}
