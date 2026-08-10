"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, User } from "lucide-react";
import { StaffUnit, StaffUnitEmployee } from "@/lib/api";
import { useStaffUnits } from "@/hooks/use-staff-units";
import "./org-board.styles.css";

const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL || "";

const statusColors = {
  in_service: "bg-green-500",
  vacation: "bg-yellow-500",
  leave_by_report: "bg-yellow-400",
  sick_leave: "bg-red-500",
  business_trip: "bg-blue-500",
  training: "bg-purple-500",
  competition: "bg-pink-500",
  other_absence: "bg-gray-500",
  on_duty: "bg-indigo-500",
  after_duty: "bg-cyan-500",
  seconded_from: "bg-orange-500",
  seconded_to: "bg-teal-500",
};

import { EMPLOYEE_STATUS_LABELS } from "@/lib/status";

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

const buildOrgStructure = (units: StaffUnit[]): OrgStructure => {
  if (units.length === 0) {
    return {
      departmentHead: null,
      deputies: [],
      managements: [],
    };
  }

  // Нормализуем данные: убеждаемся, что parent_id существует
  const normalizedUnits = units.map((unit) => ({
    ...unit,
    parent_id: unit.parent_id ?? null,
  }));

  const unitMap = buildTree(normalizedUnits);

  // Находим корневой элемент (начальник департамента)
  let departmentHead: StaffUnit | null = null;

  // Сначала ищем элементы с начальником департамента по должности
  const deptHeadUnit = normalizedUnits.find((unit) =>
    unit.employees.some(
      (emp) =>
        emp.position.level <= 3 ||
        emp.position.name.toUpperCase().includes("НАЧАЛЬНИК ДЕПАРТАМЕНТА")
    )
  );

  if (deptHeadUnit) {
    departmentHead = unitMap.get(deptHeadUnit.id) || null;
  }

  // Если не нашли по должности, ищем элементы с parent_id = null
  if (!departmentHead) {
    const rootUnits = normalizedUnits.filter((u) => u.parent_id === null);
    if (rootUnits.length > 0) {
      departmentHead = unitMap.get(rootUnits[0].id) || null;
    } else {
      const allParentIds = new Set(
        normalizedUnits
          .map((u) => u.parent_id)
          .filter((id) => id !== null && id !== undefined)
      );

      const potentialHeads = normalizedUnits.filter(
        (u) => !allParentIds.has(u.id)
      );

      if (potentialHeads.length > 0) {
        departmentHead =
          unitMap.get(
            potentialHeads.reduce((min, unit) =>
              unit.id < min.id ? unit : min
            ).id
          ) || null;
      }
    }
  }

  // Если все еще не нашли, берем элемент с минимальным ID
  if (!departmentHead) {
    const minIdUnit = normalizedUnits.reduce((min, unit) =>
      unit.id < min.id ? unit : min
    );
    departmentHead = unitMap.get(minIdUnit.id) || null;
  }

  // Находим заместителей
  const deputies: StaffUnitEmployee[] = [];
  if (departmentHead) {
    // Ищем заместителей среди сотрудников самого департамента
    departmentHead.employees.forEach((emp) => {
      const level = emp.position.level;
      const positionName = emp.position.name.toUpperCase();

      const isDepartmentDeputy =
        level === 4 ||
        (positionName.includes("ЗАМЕСТИТЕЛЬ") &&
          (positionName.includes("ДЕПАРТАМЕНТА") ||
            positionName.includes("ДЕПАРТАМЕНТ")));

      if (isDepartmentDeputy) {
        deputies.push(emp);
      }
    });
  } else {
    // Ищем заместителей по должности, если нет департамента
    normalizedUnits.forEach((unit) => {
      const hasDeputy = unit.employees.some((emp) => {
        const level = emp.position.level;
        const positionName = emp.position.name.toUpperCase();
        return (
          level === 4 ||
          (positionName.includes("ЗАМЕСТИТЕЛЬ") &&
            (positionName.includes("ДЕПАРТАМЕНТА") ||
              positionName.includes("ДЕПАРТАМЕНТ")))
        );
      });
      if (hasDeputy) {
        const deputyEmp = unit.employees.find((emp) => {
          const level = emp.position.level;
          const positionName = emp.position.name.toUpperCase();
          return (
            level === 4 ||
            (positionName.includes("ЗАМЕСТИТЕЛЬ") &&
              (positionName.includes("ДЕПАРТАМЕНТА") ||
                positionName.includes("ДЕПАРТАМЕНТ")))
          );
        });

        if (
          deputyEmp &&
          !deputies.find(
            (d) => d.employee?.id && d.employee.id === deputyEmp.employee?.id
          )
        ) {
          deputies.push(deputyEmp);
        }
      }
    });
  }

  // Находим управления
  const managements: {
    unit: StaffUnit;
    divisions: { unit: StaffUnit; employees: StaffUnitEmployee[] }[];
  }[] = [];

  const managementParentIds = new Set<number>();
  if (departmentHead) {
    managementParentIds.add(departmentHead.id);
  }

  if (managementParentIds.size === 0) {
    // Если нет департамента и заместителей, ищем управления по должности
    normalizedUnits.forEach((unit) => {
      const hasManagementHead = unit.employees.some((emp) => {
        const level = emp.position.level;
        const positionName = emp.position.name.toUpperCase();
        return level === 5 || positionName.includes("НАЧАЛЬНИК УПРАВЛЕНИЯ");
      });
      if (hasManagementHead) {
        managementParentIds.add(unit.parent_id || unit.id);
      }
    });
  }

  normalizedUnits.forEach((unit) => {
    // Проверяем массив employees на наличие начальника управления
    const hasManagementHead = unit.employees.some((emp) => {
      const level = emp.position.level;
      const positionName = emp.position.name.toUpperCase();
      return level === 5 || positionName.includes("НАЧАЛЬНИК УПРАВЛЕНИЯ");
    });

    if (
      hasManagementHead &&
      (managementParentIds.has(unit.parent_id || -1) || unit.parent_id === 2)
    ) {
      const managementUnit = unitMap.get(unit.id);
      if (managementUnit) {
        const divisions: { unit: StaffUnit; employees: StaffUnitEmployee[] }[] =
          [];

        normalizedUnits.forEach((divUnit) => {
          // Проверяем, является ли это подразделение отделом (дочерним элементом управления)
          // Отдел определяется по parent_id
          if (divUnit.parent_id === unit.id) {
            // Проверяем, есть ли начальник отдела
            const hasDivisionHead = divUnit.employees.some((emp) => {
              const level = emp.position.level;
              const positionName = emp.position.name.toUpperCase();
              return level === 7 || positionName.includes("НАЧАЛЬНИК ОТДЕЛА");
            });

            // Показываем отдел, если есть начальник отдела ИЛИ если это подразделение с сотрудниками
            // ИЛИ если это просто подразделение (даже без сотрудников, для отображения структуры)
            if (
              hasDivisionHead ||
              divUnit.employees.length > 0 ||
              divUnit.division.level === 3
            ) {
              const divisionUnit = unitMap.get(divUnit.id);
              if (divisionUnit) {
                // Берем ВСЕХ сотрудников из массива employees самого подразделения
                // Сортируем по уровню позиции (начальники первыми)
                const employees = divisionUnit.employees.sort((a, b) => {
                  // Сортируем по уровню позиции (меньший level = выше должность)
                  if (a.position.level !== b.position.level) {
                    return a.position.level - b.position.level;
                  }
                  return 0;
                });

                divisions.push({
                  unit: divisionUnit,
                  employees,
                });
              }
            }
          }
        });

        if (divisions.length === 0) {
          // Если нет отделов, показываем ВСЕХ сотрудников управления
          const directEmployees = managementUnit.employees.sort((a, b) => {
            if (a.position.level !== b.position.level) {
              return a.position.level - b.position.level;
            }
            return 0;
          });

          if (directEmployees.length > 0) {
            divisions.push({
              unit: managementUnit,
              employees: directEmployees,
            });
          }
        }

        managements.push({
          unit: managementUnit,
          divisions: divisions.sort((a, b) => {
            const aName = a.unit.division.name;
            const bName = b.unit.division.name;
            return aName.localeCompare(bName, "ru");
          }),
        });
      }
    }
  });

  managements.sort((a, b) => (a.unit.index || 0) - (b.unit.index || 0));

  // Если нет управлений, но есть подразделения с сотрудниками, показываем их
  if (managements.length === 0) {
    normalizedUnits.forEach((unit) => {
      if (unit.employees.length > 0) {
        const hasManagementHead = unit.employees.some((emp) => {
          const level = emp.position.level;
          const positionName = emp.position.name.toUpperCase();
          return (
            level === 5 ||
            level === 7 ||
            positionName.includes("НАЧАЛЬНИК УПРАВЛЕНИЯ") ||
            positionName.includes("НАЧАЛЬНИК ОТДЕЛА")
          );
        });

        if (hasManagementHead) {
          const managementUnit = unitMap.get(unit.id);
          if (managementUnit) {
            const employees = managementUnit.employees.sort(
              (a, b) => a.position.level - b.position.level
            );
            managements.push({
              unit: managementUnit,
              divisions: [
                {
                  unit: managementUnit,
                  employees,
                },
              ],
            });
          }
        }
      }
    });
  }

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

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null;

  const fetchData = () => {
    refetch();
  };

  const orgStructure = useMemo(
    () => buildOrgStructure(staffUnits),
    [staffUnits]
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
        <div className="flex flex-col items-center justify-center min-h-[200px] text-gray-500">
          <p className="mb-2">
            Данные загружены, но структура не может быть построена.
          </p>
          <p className="text-sm">
            Проверьте, что в данных есть подразделения с сотрудниками.
          </p>
        </div>
      ) : (
        <div className="flex justify-center overflow-x-auto">
          <table className="table-auto mt-5 w-full">
            <thead>
              {/* Первый уровень: заголовки департаментов */}
              <tr>
                <th
                  colSpan={totalCols}
                  className="border-2 text-white !text-lg border-black bg-zinc-700 px-4 py-2"
                >
                  <b>
                    {(() => {
                      const headEmp =
                        orgStructure.departmentHead?.employees.find(
                          (e) =>
                            e.position.level <= 3 ||
                            e.position.name.toUpperCase().includes("НАЧАЛЬНИК")
                        )?.employee;
                      return headEmp ? (
                        <>
                          Начальник департамента: {headEmp.last_name}{" "}
                          {abbreviate(headEmp.first_name)}
                        </>
                      ) : (
                        "Начальник департамента не назначен"
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
                      className={`border-2 border-black bg-zinc-300 px-4 py-2 ${
                        status === highlightedStatus ? "!bg-red-400" : ""
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
                        className="border border-gray-800 px-4 py-2"
                      >
                        {division.unit.division.name}
                      </th>
                    ))
                  ) : (
                    <th
                      key={management.unit.id}
                      className="border border-gray-800 px-4 py-2"
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
                          className={`border border-gray-800 px-4 py-3 bg-white shadow-md rounded-md transition-all duration-300 ${
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
                                    <span className="font-semibold text-blue-600">
                                      {
                                        EMPLOYEE_STATUS_LABELS[
                                          employeeData.employee?.current_status
                                            ?.status_type || "in_service"
                                        ]
                                      }
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
                            className={`border border-gray-800 px-4 py-3 bg-white shadow-md rounded-md transition-all duration-300 ${
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
                                      <span className="font-semibold text-blue-600">
                                        {
                                          EMPLOYEE_STATUS_LABELS[
                                            employeeData.employee
                                              ?.current_status?.status_type ||
                                              "in_service"
                                          ]
                                        }
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
