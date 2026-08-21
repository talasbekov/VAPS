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
import { useQueries } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { apiClient, type OpsEmployeeStatusRow } from "@/lib/api";
import { STATUS_LABEL_BY_CODE } from "@/entities/daily-grid";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";

/** Порог уровня должности: `level <= LEADERSHIP_MAX_LEVEL` — «руководство».
 * 0 не подошёл бы (уровней с 0 в каталоге нет — блок был бы пуст всегда),
 * пустой список кодов из брифа (`LEADERSHIP_POSITION_CODES`) тоже не нужен —
 * он был решением на случай отсутствия серверного признака, а признак
 * (`position.level`) нашёлся. Живой стенд: level=1 — «Начальник отдела»,
 * 2 — «Старший инспектор», 3 — «Инспектор», 4 — «Дежурный». */
export const LEADERSHIP_MAX_LEVEL = 1;

/** У рядовых строк расхода (`DivisionGroup`) отсутствие статуса — derived
 * «в строю»: там это инвариант раздела (нет активного статуса = в строю).
 * Для руководства отсутствие статуса называется как есть, а не подразумевает
 * умолчание — блок построен на другом срезе (штатке, не расходе), и
 * додумывать за расход здесь не его дело. */
function leadershipStatusLabel(code: string | null): string {
  if (code === null) return "статус не заведён";
  return STATUS_LABEL_BY_CODE.get(code) ?? code;
}

// Однострочная константа, а не многострочный JSX-текст: JSX схлопывает
// переносы строк в пробелы по своим правилам, и полагаться на них там, где
// текст обязан быть verbatim (проверяется e2e-пробой дословно), лишний риск.
const HONESTY_LINE =
  "Руководство собрано по уровню должности из штатного расписания (level ≤ 1); отдельного серверного признака „руководство\" нет — появится бэк-этапом.";

/** Форма ответа `staff-units/directorate/` на живом стенде — ПЛОСКАЯ: у
 * каждой штатной единицы одна `position` и один `employee | null`
 * (вакансия). Это НЕ форма, которую объявляет `StaffUnit` в `lib/api.ts`
 * (`employees: StaffUnitEmployee[]`, множественное число) — тот же разъезд
 * типа с рантаймом, что уже обойдён в `app/employees/page.tsx` явным
 * приведением типа. Здесь описана только форма, которая реально приходит. */
interface RawStaffUnit {
  id: number;
  division?: { id: number; name?: string } | null;
  position?: { id: number; name: string; level: number } | null;
  employee?: {
    id: number;
    first_name: string;
    last_name: string;
  } | null;
}

interface LeaderVM {
  employeeId: number;
  lastName: string;
  firstName: string;
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
  const staffUnits = useStaffUnitsByDirectorate();

  const leaders = useMemo<LeaderVM[]>(() => {
    const raw = (staffUnits.data?.staff_units ?? []) as unknown as RawStaffUnit[];
    const result: LeaderVM[] = [];
    for (const unit of raw) {
      const position = unit.position;
      const employee = unit.employee;
      const divisionId = unit.division?.id;
      if (!position || position.level > LEADERSHIP_MAX_LEVEL) continue;
      // Вакантная должность руководителя — некого показать строкой: у
      // `DivisionGroup` та же логика (список людей, а не штатных единиц).
      if (!employee || divisionId === undefined) continue;
      result.push({
        employeeId: employee.id,
        lastName: employee.last_name,
        firstName: employee.first_name,
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

  // Подразделения руководителей — не обязательно те же, что раскрыты в
  // рядовых `DivisionGroup` ниже, поэтому запрос свой. Ключ ИЗ ТОЙ ЖЕ семьи,
  // что у `DivisionGroup` (`["daily-expense-board", "statuses", id, date]`):
  // если пользователь уже раскрыл управление, чей начальник тут же показан
  // строкой, кэш переиспользуется, а не дублируется вторым запросом.
  const divisionIds = useMemo(
    () => Array.from(new Set(leaders.map((leader) => leader.divisionId))),
    [leaders]
  );

  const statusQueries = useQueries({
    queries: divisionIds.map((divisionId) => ({
      queryKey: ["daily-expense-board", "statuses", divisionId, businessDate],
      queryFn: () => apiClient.getOpsStatusesOn({ businessDate, divisionId }),
    })),
  });

  const statusByEmployee = new Map<number, string>();
  for (const query of statusQueries) {
    for (const row of (query.data as OpsEmployeeStatusRow[] | undefined) ?? []) {
      statusByEmployee.set(row.employee_id, row.status_type_code);
    }
  }

  const isPending =
    staffUnits.isPending || statusQueries.some((query) => query.isPending);
  const isError = staffUnits.isError;

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
            </p>
          )}
          {!isPending && !isError && leaders.length === 0 && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              начальников отделов в штатном расписании нет
            </p>
          )}
          {!isPending &&
            !isError &&
            leaders.map((leader) => {
              const initials = `${leader.lastName.slice(0, 1)}${leader.firstName.slice(0, 1)}`;
              const statusCode = statusByEmployee.get(leader.employeeId) ?? null;
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
                      {leader.lastName} {leader.firstName}
                    </p>
                    <p className="text-xs text-muted-foreground">{leader.positionName}</p>
                  </div>
                  <Badge variant="secondary">{leadershipStatusLabel(statusCode)}</Badge>
                </div>
              );
            })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{HONESTY_LINE}</p>
    </section>
  );
}
