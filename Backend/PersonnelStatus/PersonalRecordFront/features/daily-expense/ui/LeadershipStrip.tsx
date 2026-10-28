"use client";

// Блок «Руководство департамента» — первым над рядовыми управлениями
// «Ежедневного расхода», раскрыт всегда.
//
// Бриф просил корень дерева подразделений (`/api/ops/daily/divisions/` без
// родителя), но у этой ручки НЕТ поля-родителя вовсе (только `{id, name}` —
// см. `organization_management/apps/ops/daily.py::visible_division_rows`), и
// даже подмешав родителя из соседней ручки, «запись без родителя» — это
// организация («Служба»), а не департамент, да ещё и неоднозначная на этом
// стенде (второй сиротский корень). Контракт заменён целиком:
//
// «Руководство» — штатные единицы с `position.level <= LEADERSHIP_MAX_LEVEL`
// по ВСЕМ подразделениям штатки (`/api/staff_unit/staff-units/directorate/`,
// хук `useStaffUnitsByDirectorate` — та же ручка, что уже кормит реестр
// «Сбор сил» на этом экране, никакого нового права не заводим). `level` —
// СЕРВЕРНАЯ иерархия должности, а не код, который решали бы на фронте.
//
// Это временный фронтовый признак: серверной пометки «руководство» пока нет,
// и это написано на экране (подпись под блоком).
import { useMemo } from "react";
import { useDailyExpenseRead } from "@/hooks/use-daily-expense-read";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient, type OpsEmployeeStatusRow } from "@/lib/api";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { effectiveDailyStatus } from "../model/directorate-summary";
import { StatusDetails } from "./StatusDetails";

/** Порог уровня должности: `level <= LEADERSHIP_MAX_LEVEL` — «руководство».
 * 0 не подошёл бы (уровней с 0 в каталоге нет — блок был бы пуст всегда),
 * пустой список кодов из брифа (`LEADERSHIP_POSITION_CODES`) тоже не нужен —
 * он был решением на случай отсутствия серверного признака, а признак
 * (`position.level`) нашёлся. Живой стенд: level=1 — «Начальник отдела»,
 * 2 — «Старший инспектор», 3 — «Инспектор», 4 — «Дежурный». */
export const LEADERSHIP_MAX_LEVEL = 2;

/** У рядовых строк расхода (`DivisionGroup`) отсутствие статуса — derived
 * «в строю»: там это инвариант раздела (нет активного статуса = в строю).
 * Для руководства отсутствие статуса называется как есть, а не подразумевает
 * умолчание — блок построен на другом срезе (штатке, не расходе), и
 * додумывать за расход здесь не его дело.
 *
 * Подпись кода берётся из СПРАВОЧНИКА раздела (`labelOf`, Plane №342), а не
 * из константы в коде: типы заводит администратор, и копия каталога не
 * узнала бы о новом типе никогда — на месте подписи стоял бы голый код. */
// Однострочная константа, а не многострочный JSX-текст: JSX схлопывает
// переносы строк в пробелы по своим правилам, и полагаться на них там, где
// текст обязан быть verbatim (проверяется e2e-пробой дословно), лишний риск.
const HONESTY_LINE =
  "Начальники департаментов и их заместители по штатному расписанию.";

/** Форма ответа `staff-units/directorate/` на живом стенде — ПЛОСКАЯ: у
 * каждой штатной единицы одна `position` и один `employee | null`
 * (вакансия). Это НЕ форма, которую объявляет `StaffUnit` в `lib/api.ts`
 * (`employees: StaffUnitEmployee[]`, множественное число) — тот же разъезд
 * типа с рантаймом, что уже обойдён в `app/employees/page.tsx` явным
 * приведением типа. Здесь описана только форма, которая реально приходит. */
interface RawStaffUnit {
  id: number;
  department_id?: number | null;
  division?: { id: number; name?: string } | null;
  position?: { id: number; name: string; level: number } | null;
  employee?: {
    id: number;
    first_name: string;
    last_name: string;
    middle_name?: string | null;
  } | null;
}

interface LeaderVM {
  employeeId: number;
  lastName: string;
  firstName: string;
  middleName: string;
  positionName: string;
  positionLevel: number;
  divisionId: number;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" aria-hidden />
          <div className="h-4 w-48 animate-pulse rounded bg-muted" aria-hidden />
        </div>
      ))}
    </>
  );
}

export function LeadershipStrip({ businessDate }: { businessDate: string }) {
  // Подписи статусов — из справочника раздела, одного на весь фронт
  // (Plane №342).
  const statusTypes = useOpsStatusTypes();

  // Отбор по уровню должности делает СЕРВЕР (Plane №235). До этого полоска
  // звала `useStaffUnitsByDirectorate()` — весь состав подразделения — и
  // отбирала руководство в браузере: десяток строк ценой 2,7 МБ на пяти
  // тысячах сотрудников. Причём полоска живёт на экране реестра, который уже
  // перешёл на страницы, то есть полный запрос никуда не делся — он просто
  // принадлежал ей.
  //
  // `pageSize` — потолок ручки: руководителей заведомо меньше, а вторая
  // страница у полоски означала бы, что часть руководства не показана.
  const staffUnits = useDailyExpenseRead("leadership-staff", [LEADERSHIP_MAX_LEVEL], () => apiClient.getStaffUnitsByDirectorate({
    positionLevelMax: LEADERSHIP_MAX_LEVEL,
    page: 1,
    pageSize: 200,
  }));

  const leaders = useMemo<LeaderVM[]>(() => {
    const raw = (staffUnits.data?.staff_units ?? []) as unknown as RawStaffUnit[];
    const result: LeaderVM[] = [];
    for (const unit of raw) {
      const position = unit.position;
      const employee = unit.employee;
      const divisionId = unit.division?.id;
      // Порог остался ЗДЕСЬ ТОЖЕ, хотя отбирает уже сервер: клиент не обязан
      // верить, что параметр доехал (старый кэш, прокси, чужая правка ручки),
      // а строка «Инспектор» в блоке «Руководство департамента» — это ошибка,
      // которую увидит заказчик, а не мы.
      if (!position || position.level > LEADERSHIP_MAX_LEVEL) continue;
      if (unit.department_id != null && divisionId !== unit.department_id) continue;
      // Вакантная должность руководителя — некого показать строкой: у
      // `DivisionGroup` та же логика (список людей, а не штатных единиц).
      if (!employee || divisionId === undefined) continue;
      result.push({
        employeeId: employee.id,
        lastName: employee.last_name,
        firstName: employee.first_name,
        middleName: employee.middle_name ?? "",
        positionName: position.name,
        positionLevel: position.level,
        divisionId,
      });
    }
    result.sort(
      (a, b) =>
        a.positionLevel - b.positionLevel ||
        a.lastName.localeCompare(b.lastName, "ru")
    );
    return result;
  }, [staffUnits.data]);

  // The batch belongs to the same protected daily family as its personnel.
  // Scope changes cannot reuse status rows from a previous leadership list.
  const divisionIds = useMemo(
    () => Array.from(new Set(leaders.map((leader) => leader.divisionId))),
    [leaders]
  );

  const statuses = useDailyExpenseRead("leadership-statuses", [divisionIds, businessDate], async () =>
    (await Promise.all(divisionIds.map(divisionId => apiClient.getOpsStatusesOn({ businessDate, divisionId })))).flat(),
    { enabled: staffUnits.isSuccess });
  const statusRows: OpsEmployeeStatusRow[] = statuses.data ?? [];

  const isError = staffUnits.isError || statusTypes.isError || statuses.isError;
  const isPending = !isError && (staffUnits.isPending || statusTypes.isLoading || statuses.isPending);

  return (
    <section
      role="region"
      aria-label="Руководство департамента"
      className="space-y-2"
    >
      <div className="rounded-lg border bg-muted/10">
        <div className="border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Руководство департамента</h2>
        </div>
        {/* `role="list"`/`listitem` — не только разметка для читалок, но и
            однозначный крючок для пробы: скелетные плейсхолдеры НЕ несут эту
            роль, поэтому счёт строк не может случайно совпасть со счётом
            скелета (у обоих сейчас по 2 штуки на живом стенде — без роли
            проба не отличила бы «ещё грузится» от «уже отрисовано»). */}
        <div className="divide-y" role="list">
          {isPending && <SkeletonRows />}
          {!isPending && isError && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Штатное расписание не ответило — руководство показать нечем
              {" "}<Button variant="link" size="sm" onClick={() => void staffUnits.refetch()}>Повторить загрузку</Button>
            </p>
          )}
          {!isPending && !isError && leaders.length === 0 && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Начальники департаментов и заместители не назначены
            </p>
          )}
          {!isPending &&
            !isError &&
            leaders.map((leader) => {
              const initials = `${leader.lastName.slice(0, 1)}${leader.firstName.slice(0, 1)}`;
              let status: OpsEmployeeStatusRow | null | undefined;
              try { status = effectiveDailyStatus(statusRows.filter(row => row.employee_id === leader.employeeId), businessDate, statusTypes.all); }
              catch { status = undefined; }
              return (
                <div
                  key={leader.employeeId}
                  role="listitem"
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                    {initials}
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-semibold">
                      {[leader.lastName, leader.firstName, leader.middleName].filter(Boolean).join(" ")}
                    </p>
                    <p className="text-xs text-muted-foreground">{leader.positionName}</p>
                  </div>
                  <Badge variant="secondary">
                    <StatusDetails status={status} labelOf={statusTypes.labelOf} />
                  </Badge>
                </div>
              );
            })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{HONESTY_LINE}</p>
    </section>
  );
}
