"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, User } from "lucide-react";
import { StaffUnit, StaffUnitEmployee, StaffUnitStatistics } from "@/lib/api";
import { useStaffUnits } from "@/hooks/use-staff-units";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import {
  EMPLOYEE_STATUS_PAINT,
  getEmployeeStatusLabel,
} from "@/lib/status";
import styles from "./org-board.module.css";

const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL || "";

// Шестой источник той же таблицы — теперь производная от общей палитры.
const statusColors: Record<string, string> = Object.fromEntries(
  Object.entries(EMPLOYEE_STATUS_PAINT).map(([code, paint]) => [code, paint.dot])
);



// Построение дерева из плоского списка
const buildTree = (units: StaffUnit[]): Map<number, StaffUnit> => {
  const unitMap = new Map<number, StaffUnit>();

  // Нормализуем данные: убеждаемся, что parent_id существует
  const normalizedUnits = units.map((unit) => ({
    ...unit,
    parent_id: unit.parent_id ?? null,
  }));

  // Создаем карту всех элементов
  normalizedUnits.forEach((unit) => {
    unitMap.set(unit.id, { ...unit, children: [] });
  });

  // Строим дерево
  normalizedUnits.forEach((unit) => {
    if (unit.parent_id !== null && unit.parent_id !== undefined) {
      const parent = unitMap.get(unit.parent_id);
      if (parent) {
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(unitMap.get(unit.id)!);
      }
    }
  });

  return unitMap;
};

// Структура для отображения
interface OrgStructure {
  departmentHead: StaffUnit | null;
  // Заместители начальника департамента – это сотрудники департамента,
  // а не отдельные подразделения
  deputies: StaffUnitEmployee[];
  managements: {
    unit: StaffUnit;
    divisions: {
      unit: StaffUnit;
      employees: StaffUnitEmployee[]; // Теперь это массив сотрудников, а не подразделений
    }[];
  }[];
}

/**
 * Структура доски — ИЗ НАСТОЯЩЕЙ ИЕРАРХИИ, а не из догадок о должностях
 * (Plane №269).
 *
 * Заказчик: «Структура организации должна показывать всю штатку
 * департамента». Причин неполноты было две, и обе здесь.
 *
 * 1. ДАННЫЕ. Ручка штатки постраничная, клиент брал первую страницу — 50
 *    единиц из 442. Починено в `getStaffUnits`.
 * 2. ОТБОР. Здесь. Прежняя сборка искала управления по ДОЛЖНОСТЯМ («level 5»,
 *    «НАЧАЛЬНИК УПРАВЛЕНИЯ») и связывала их через `parent_id` штатных единиц.
 *    Ни то, ни другое не работает: `parent_id` у ВСЕХ 442 строк пустой —
 *    иерархии в этой ручке нет вовсе, — а подразделение без начальника нужной
 *    подписи выпадало целиком вместе со своими отделами и людьми. На стенде
 *    доска показывала 57 человек из 440 и молчала об остальных.
 *
 * Настоящая иерархия живёт в `/api/staff_unit/statistics/`: департаменты,
 * управления и отделы с путём `ancestors` и числами. Люди берутся из штатки и
 * раскладываются ПО `division.id` — то есть по подразделению, в котором стоит
 * штатная единица, а не по тому, кем человека посчитал разбор должности.
 *
 * Родитель определяется ПО ПУТИ, а не по имени: «Первое управление» есть в
 * каждом департаменте, и одно имя связало бы отделы с чужим управлением.
 */
const buildOrgStructure = (
  units: StaffUnit[],
  stats: StaffUnitStatistics | undefined
): OrgStructure => {
  const normalizedUnits = units.map((unit) => ({
    ...unit,
    employees: unit.employees || [],
  }));

  // Люди по подразделению. Ключ — идентификатор: имена подразделений
  // повторяются («Первый отдел» встречается девять раз).
  const peopleOf = new Map<number, StaffUnitEmployee[]>();
  normalizedUnits.forEach((unit) => {
    const list = peopleOf.get(unit.division.id) ?? [];
    list.push(...unit.employees);
    peopleOf.set(unit.division.id, list);
  });

  const byRank = (a: StaffUnitEmployee, b: StaffUnitEmployee) =>
    a.position.level - b.position.level;

  /** Синтетическая «единица» под разметку: доска знает подразделение и людей. */
  const asUnit = (
    id: number,
    name: string,
    employees: StaffUnitEmployee[],
    index: number
  ): StaffUnit => ({
    id,
    division: { id, name },
    index,
    parent_id: null,
    vacancy: null,
    employees: [...employees].sort(byRank),
  });

  const managements: {
    unit: StaffUnit;
    divisions: { unit: StaffUnit; employees: StaffUnitEmployee[] }[];
  }[] = [];

  if (stats) {
    const pathOf = (ancestors: string[], name: string) =>
      [...ancestors, name].join(" › ");

    stats.departments.forEach((department) => {
      const departmentPath = pathOf(
        department.ancestors,
        department.department_name
      );

      // РУКОВОДСТВО ДЕПАРТАМЕНТА отдельной колонкой: начальник департамента и
      // его заместители стоят в самом департаменте, а не в управлении, и без
      // этой колонки они не попадали бы на доску вовсе (на стенде — шесть
      // человек).
      const departmentOwn = peopleOf.get(department.department_id) ?? [];
      if (departmentOwn.length > 0) {
        managements.push({
          unit: asUnit(
            department.department_id,
            department.department_name,
            departmentOwn,
            -1
          ),
          divisions: [
            {
              unit: asUnit(
                department.department_id,
                "Руководство департамента",
                departmentOwn,
                0
              ),
              employees: [...departmentOwn].sort(byRank),
            },
          ],
        });
      }

      stats.directorates
        .filter(
          (directorate) =>
            pathOf(directorate.ancestors, "").slice(0, -3) === departmentPath
        )
        .forEach((directorate, dirIndex) => {
          const directoratePath = pathOf(
            directorate.ancestors,
            directorate.directorate_name
          );
          const own = peopleOf.get(directorate.directorate_id) ?? [];

          const divisions = stats.divisions
            .filter(
              (division) =>
                pathOf(division.ancestors, "").slice(0, -3) === directoratePath
            )
            .map((division, divIndex) => {
              const people = peopleOf.get(division.division_id) ?? [];
              return {
                unit: asUnit(
                  division.division_id,
                  division.division_name,
                  people,
                  divIndex
                ),
                employees: [...people].sort(byRank),
              };
            });

          // Люди, стоящие в самом управлении (а не в его отделах), — тоже
          // штатка: без этой строки начальник управления и его заместители
          // исчезали бы с доски.
          if (own.length > 0) {
            divisions.unshift({
              unit: asUnit(
                directorate.directorate_id,
                directorate.directorate_name,
                own,
                -1
              ),
              employees: [...own].sort(byRank),
            });
          }

          managements.push({
            unit: asUnit(
              directorate.directorate_id,
              directorate.directorate_name,
              own,
              dirIndex
            ),
            divisions,
          });
        });
    });
  }

  // ЛЮДИ ВНЕ ИЕРАРХИИ. Подразделение, которого нет в статистике (сервер его не
  // относит ни к департаменту, ни к управлению, ни к отделу), — это не повод
  // потерять его людей: молчаливая потеря и есть дефект, который чинит №269.
  // Такие строки собираются в отдельную группу под своим настоящим именем.
  if (stats) {
    const classified = new Set<number>([
      ...stats.departments.map((row) => row.department_id),
      ...stats.directorates.map((row) => row.directorate_id),
      ...stats.divisions.map((row) => row.division_id),
      // Узла области может не быть вовсе (Plane №339): у роли раздела с
      // несколькими грантами одного подразделения, описывающего область, не
      // существует. Раньше это поле было обязательным, и чтение `.id` у null
      // роняло весь дашборд — поймано обходом ролевых учёток, а не типами:
      // тип обещал объект.
      ...(stats.scope_division === null ? [] : [stats.scope_division.id]),
    ]);
    const strays = new Map<number, { name: string; people: StaffUnitEmployee[] }>();
    normalizedUnits.forEach((unit) => {
      if (classified.has(unit.division.id)) return;
      const row = strays.get(unit.division.id) ?? {
        name: unit.division.name,
        people: [],
      };
      row.people.push(...unit.employees);
      strays.set(unit.division.id, row);
    });
    strays.forEach((row, id) => {
      const unit = asUnit(id, row.name, row.people, 999);
      managements.push({
        unit,
        divisions: [{ unit, employees: [...row.people].sort(byRank) }],
      });
    });
  }

  // Голова доски — подразделение, в области которого работает пользователь.
  // Прежде её угадывали по «level <= 3» и подписи должности; теперь её
  // называет сам сервер (`scope_division`).
  //
  // Область БЕЗ единого узла (Plane №339) головы не имеет: показывать вместо
  // неё первое попавшееся подразделение значило бы вернуть ту самую догадку,
  // от которой уходили. Доска при этом остаётся полной — управления и отделы
  // собираются ниже независимо от головы.
  let departmentHead: StaffUnit | null = null;
  const scope = stats?.scope_division ?? null;
  if (scope !== null) {
    departmentHead = asUnit(
      scope.id,
      scope.name,
      peopleOf.get(scope.id) ?? [],
      0
    );
  }

  // Заместители — из людей самого подразделения-области. Разбор подписи здесь
  // ОСТАЁТСЯ, и это не непоследовательность: он отвечает на вопрос «кого
  // назвать заместителем», а не «кого показать». Полнота доски от него больше
  // не зависит.
  const deputies: StaffUnitEmployee[] = (departmentHead?.employees ?? []).filter(
    (emp) => {
      const name = emp.position.name.toUpperCase();
      return name.includes("ЗАМЕСТИТЕЛЬ") && emp.employee !== null;
    }
  );

  return {
    departmentHead,
    deputies: deputies.sort(
      (a, b) => (a.employee?.id || 0) - (b.employee?.id || 0)
    ),
    managements,
  };
};

const abbreviate = (name?: string) => {
  if (!name) return "";
  const parts = name.split(" ");
  return parts.map((part) => part.charAt(0).toUpperCase()).join(".");
};

const formatDate = (dateString?: string) => {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU");
  } catch {
    return dateString;
  }
};

export default function OrgBoard() {
  const [highlightedStatus, setHighlightedStatus] = useState<string | null>(
    null
  );

  // Используем React Query для загрузки данных
  const {
    data: staffUnits = [],
    isLoading: loading,
    error: queryError,
    refetch,
  } = useStaffUnits();

  // Иерархия подразделений: ручка штатки её не несёт вовсе (`parent_id` пуст
  // у всех строк), и без этого запроса доска не знает, какой отдел чьим
  // управлением ведётся.
  const { data: stats } = useStaffUnitStatistics();

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null;

  const fetchData = () => {
    refetch();
  };

  const orgStructure = useMemo(
    () => buildOrgStructure(staffUnits, stats),
    [staffUnits, stats]
  );

  // Вычисляем максимальное количество строк
  const maxRows = useMemo(() => {
    if (orgStructure.managements.length === 0) {
      return 1;
    }
    return Math.max(
      ...orgStructure.managements.flatMap((management) =>
        management.divisions.map((division) => division.employees.length)
      ),
      1
    );
  }, [orgStructure]);

  // Вычисляем общее количество колонок
  const totalCols = useMemo(() => {
    const cols = orgStructure.managements.reduce(
      (sum, mgmt) =>
        sum + (mgmt.divisions.length > 0 ? mgmt.divisions.length : 1),
      0
    );
    return cols > 0 ? cols : 1; // Минимум 1 колонка
  }, [orgStructure]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[350px]">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] text-red-500">
        <p className="mb-4">Ошибка загрузки данных: {error}</p>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Попробовать снова
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Структура организации</h2>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Обновить
        </Button>
      </div>

      {orgStructure.managements.length === 0 && staffUnits.length > 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
          <p className="mb-2">
            Данные загружены, но структура не может быть построена.
          </p>
          <p className="text-sm">
            Проверьте, что в данных есть подразделения с сотрудниками.
          </p>
        </div>
      ) : (
        <div className={`flex justify-center overflow-x-auto ${styles.board}`}>
          <table className={`${styles.tableAuto} mt-5 w-full`}>
            <thead>
              {/* Первый уровень: заголовки департаментов */}
              <tr>
                <th
                  colSpan={totalCols}
                  className="border-2 border-border bg-primary px-4 py-2 !text-lg text-primary-foreground"
                >
                  {/* Шапка называет ПОДРАЗДЕЛЕНИЕ ОБЛАСТИ и его руководителя,
                      а не «начальника департамента» (Plane №269). Область
                      бывает организацией — тогда департаментов под ней
                      несколько, и один «начальник департамента» в шапке был бы
                      неправдой: раньше сюда попадал начальник ПЕРВОГО
                      попавшегося подразделения, а после починки полноты —
                      надпись «не назначен» при четырёх живых начальниках
                      департаментов в колонках ниже. */}
                  <b>
                    {(() => {
                      const scopeName =
                        orgStructure.departmentHead?.division.name ?? "";
                      const headEmp =
                        orgStructure.departmentHead?.employees.find(
                          (e) =>
                            e.position.level <= 3 ||
                            e.position.name.toUpperCase().includes("НАЧАЛЬНИК")
                        )?.employee;
                      if (scopeName === "") return "Структура организации";
                      return headEmp ? (
                        <>
                          {scopeName} · руководитель: {headEmp.last_name}{" "}
                          {abbreviate(headEmp.first_name)}
                        </>
                      ) : (
                        scopeName
                      );
                    })()}
                  </b>
                </th>
              </tr>

              {/* Второй уровень: заместители */}
              <tr>
                {orgStructure.deputies.length > 0 ? (
                  orgStructure.deputies.map((deputy, index) => (
                    <th
                      key={`deputy-${deputy.employee?.id ?? index}-${index}`}
                      colSpan={totalCols / 2}
                      className={`border-2 text-white !text-lg border-zinc-700 bg-zinc-500 px-4 py-2 ${
                        (() => {
                          const deputyEmp = deputy.employee;
                          return (
                            deputyEmp?.current_status?.status_type ===
                            highlightedStatus
                          );
                        })()
                          ? "!bg-red-400"
                          : ""
                      }`}
                    >
                      <b>
                        {(() => {
                          const deputyEmp = deputy.employee;
                          return deputyEmp
                            ? `Заместитель: ${deputyEmp.last_name} ${abbreviate(
                                deputyEmp.first_name
                              )}`
                            : "Заместитель не назначен";
                        })()}
                      </b>
                    </th>
                  ))
                ) : (
                  <th
                    colSpan={totalCols}
                    className="border-2 text-white !text-lg border-zinc-700 bg-zinc-500 px-4 py-2"
                  >
                    <b>Заместитель не назначен</b>
                  </th>
                )}
              </tr>

              {/* Третий уровень: управления */}
              <tr>
                {orgStructure.managements.map((management) => {
                  const divisionsCount =
                    management.divisions.length > 0
                      ? management.divisions.length
                      : 1;
                  const managementHead = management.unit.employees.find(
                    (e) =>
                      e.position.level === 5 ||
                      e.position.name
                        .toUpperCase()
                        .includes("НАЧАЛЬНИК УПРАВЛЕНИЯ")
                  )?.employee;
                  const status = managementHead?.current_status?.status_type;
                  return (
                    <th
                      key={management.unit.id}
                      colSpan={divisionsCount}
                      className={`border-2 border-border bg-muted px-4 py-2 text-foreground ${
                        status === highlightedStatus ? "!bg-red-400 !text-black" : ""
                      }`}
                    >
                      {management.unit.division.name}
                      {managementHead && (
                        <div className="flex flex-col items-center justify-center text-center mt-2">
                          <img
                            src={
                              managementHead.photo_url
                                ? managementHead.photo_url
                                : managementHead.photo
                                ? `${MEDIA_URL}${managementHead.photo}`
                                : "/placeholder.svg"
                            }
                            alt={`${managementHead.last_name} ${managementHead.first_name}`}
                            className="w-16 h-16 rounded-full object-cover object-top mb-2"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "/placeholder.svg";
                            }}
                          />
                          <div className="text-blue-600 mt-2">
                            <b>
                              {managementHead.last_name}{" "}
                              {abbreviate(managementHead.first_name)}
                            </b>
                          </div>
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>

              {/* Четвертый уровень: подразделения */}
              <tr>
                {orgStructure.managements.flatMap((management) => {
                  const divisions = management.divisions || [];

                  return divisions.length > 0 ? (
                    divisions.map((division) => (
                      <th
                        key={division.unit.id}
                        className="border border-border px-4 py-2"
                      >
                        {division.unit.division.name}
                      </th>
                    ))
                  ) : (
                    <th
                      key={management.unit.id}
                      className="border border-border px-4 py-2"
                    >
                      Нет отделов
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {Array.from({ length: maxRows }).map((_, rowIndex) => (
                <tr key={rowIndex}>
                  {orgStructure.managements.flatMap((management) => {
                    const divisions = management.divisions || [];

                    if (divisions.length === 0) {
                      // Для управлений без отделов - берем ВСЕХ сотрудников из массива employees
                      const allEmployees = management.unit.employees.sort(
                        (a, b) => a.position.level - b.position.level
                      );
                      const employeeData = allEmployees[rowIndex];
                      const status =
                        employeeData?.employee?.current_status?.status_type;
                      const isHighlighted = status === highlightedStatus;

                      return (
                        <td
                          key={`${management.unit.id}-${rowIndex}`}
                          className={`border border-border px-4 py-3 bg-card shadow-md rounded-md transition-all duration-300 ${
                            isHighlighted ? "!bg-red-400" : ""
                          }`}
                        >
                          {employeeData ? (
                            <div className="flex flex-col items-center justify-between text-center cursor-pointer">
                              <img
                                src={
                                  employeeData.employee
                                    ? employeeData.employee.photo_url
                                      ? employeeData.employee.photo_url
                                      : employeeData.employee.photo
                                      ? `${MEDIA_URL}${employeeData.employee.photo}`
                                      : "/placeholder.svg"
                                    : "/placeholder.svg"
                                }
                                alt={`${
                                  employeeData.employee?.last_name || ""
                                } ${employeeData.employee?.first_name || ""}`}
                                className="w-16 h-16 rounded-full object-cover object-top mb-2"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    "/placeholder.svg";
                                }}
                              />
                              <span className="ml-3">
                                <b>
                                  {employeeData.employee
                                    ? `${
                                        employeeData.employee.last_name
                                      } ${abbreviate(
                                        employeeData.employee.first_name
                                      )}`
                                    : "ВАКАНТ"}
                                </b>
                                <br />
                                <span className="font-semibold text-blue-600">
                                  {employeeData.position.name ||
                                    "Должность не указана"}
                                </span>
                                <br />
                                {employeeData.employee?.current_status
                                  ?.status_type !== "in_service" && (
                                  <>
                                    {/* Отсутствие статуса называется вслух.
                                        Прежний `|| "in_service"` печатал
                                        «В строю» тому, у кого статуса нет
                                        вовсе, — а ветка сюда как раз и
                                        попадает при `undefined`. */}
                                    <span className="font-semibold text-blue-600">
                                      {getEmployeeStatusLabel(
                                        employeeData.employee?.current_status
                                          ?.status_type,
                                        "Статус не назначен"
                                      )}
                                    </span>
                                    <br />
                                    {employeeData.employee?.current_status
                                      ?.end_date && (
                                      <span className="font-semibold text-blue-600">
                                        до{" "}
                                        {formatDate(
                                          employeeData.employee.current_status
                                            .end_date
                                        )}
                                      </span>
                                    )}
                                  </>
                                )}
                              </span>
                            </div>
                          ) : null}
                        </td>
                      );
                    } else {
                      // Для управлений с отделами - берем сотрудников из массива employees отдела
                      return divisions.map((division) => {
                        // division.employees теперь это массив StaffUnitEmployee[]
                        const employeeData = division.employees[rowIndex];
                        const status =
                          employeeData?.employee?.current_status?.status_type;
                        const isHighlighted = status === highlightedStatus;

                        return (
                          <td
                            key={`${management.unit.id}-${division.unit.id}-${rowIndex}`}
                            className={`border border-border px-4 py-3 bg-card shadow-md rounded-md transition-all duration-300 ${
                              isHighlighted ? "!bg-red-400" : ""
                            }`}
                          >
                            {employeeData ? (
                              <div className="flex flex-col items-center justify-between text-center cursor-pointer">
                                <img
                                  src={
                                    employeeData.employee
                                      ? employeeData.employee.photo_url
                                        ? employeeData.employee.photo_url
                                        : employeeData.employee.photo
                                        ? `${MEDIA_URL}${employeeData.employee.photo}`
                                        : "/placeholder.svg"
                                      : "/placeholder.svg"
                                  }
                                  alt={`${
                                    employeeData.employee?.last_name || ""
                                  } ${employeeData.employee?.first_name || ""}`}
                                  className="w-16 h-16 rounded-full object-cover object-top mb-2"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src =
                                      "/placeholder.svg";
                                  }}
                                />
                                <span className="ml-3">
                                  <b>
                                    {employeeData.employee
                                      ? `${
                                          employeeData.employee.last_name
                                        } ${abbreviate(
                                          employeeData.employee.first_name
                                        )}`
                                      : "ВАКАНТ"}
                                  </b>
                                  <br />
                                  <span className="font-semibold text-blue-600">
                                    {employeeData.position.name ||
                                      "Должность не указана"}
                                  </span>
                                  <br />
                                  {employeeData.employee?.current_status
                                    ?.status_type !== "in_service" && (
                                    <>
                                      {/* Второй такой же блок: отсутствие
                                          статуса называется вслух, а не
                                          подменяется «В строю». */}
                                      <span className="font-semibold text-blue-600">
                                        {getEmployeeStatusLabel(
                                          employeeData.employee?.current_status
                                            ?.status_type,
                                          "Статус не назначен"
                                        )}
                                      </span>
                                      <br />
                                      {employeeData.employee?.current_status
                                        ?.end_date && (
                                        <span className="font-semibold text-blue-600">
                                          до{" "}
                                          {formatDate(
                                            employeeData.employee.current_status
                                              .end_date
                                          )}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>
                              </div>
                            ) : null}
                          </td>
                        );
                      });
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
