"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { EmployeeTable } from "@/entities/employee/ui/EmployeeTable";
import { EmployeeProfile } from "@/entities/employee/ui/EmployeeProfile";
import { AddEmployeeDialog } from "@/features/add-employee";
import { DailyExpenseBoard } from "@/features/daily-expense";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  UserPlus,
  Search,
  Download,
  RefreshCw,
  Building2,
  Calendar,
} from "lucide-react";
import { useAuth, PermissionGate } from "@/lib/auth";
import { DirectorateAccessNotice } from "@/components/directorate-access-notice";
import {
  isDirectorateForbidden,
  useStaffUnitsByDirectorate,
} from "@/hooks/use-staff-units-by-directorate";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
  EMPLOYEE_STATUS_LABELS,
  getEmployeeStatusColor,
} from "@/lib/status";
import { useQueryClient } from "@tanstack/react-query";

import { formatIsoDate } from "@/shared/lib/date";
import { Progress } from "@/components/ui/progress";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useForcesGathering } from "@/hooks/use-forces-gathering";
import type { SecurityEvent } from "@/entities/security-event";
import { personnelFields } from "@/entities/employee/model/from-api";
import type { Employee } from "@/entities/employee/model/types";

/**
 * «Сбор сил на ОМ» — прежний экран личного состава, ДОПОЛНЕННЫЙ разрезом
 * сбора: кого отдали на мероприятия и кто остался.
 *
 * Экран не переписывался: реестр, фильтры, карточки, профиль и заведение
 * сотрудника остались на месте. Дописаны три вещи — счётчики из расхода
 * вместо прежних четырёх плиток, блок заявок на силы и две вкладки с тем же
 * списком, отобранным по статусу.
 */
const FORCE_REQUEST_LABEL: Record<string, string> = {
  NOT_SENT: "Не отправлен",
  SENT: "Отправлен",
  PARTIALLY_ALLOCATED: "Выделено частично",
  ALLOCATED: "Выделено полностью",
};

const FORCE_REQUEST_CLASS: Record<string, string> = {
  NOT_SENT: "bg-gray-100 text-gray-800",
  SENT: "bg-blue-100 text-blue-800",
  PARTIALLY_ALLOCATED: "bg-amber-100 text-amber-800",
  ALLOCATED: "bg-green-100 text-green-800",
};

/** Сводка одного сбора: сколько запрошено расчётом и сколько уже выделено.
 * Знаменатель — сумма запросов, она же `forceNeed`: сервер пишет оба числа из
 * ОДНИХ строк утверждённого расчёта, разойтись они не могут. */
function eventForceTotals(event: SecurityEvent): {
  requested: number;
  allocated: number;
  percent: number;
} {
  let requested = 0;
  let allocated = 0;
  for (const request of event.forceRequests) {
    requested += request.requestedCount;
    allocated += request.allocatedCount;
  }
  const percent =
    requested === 0 ? 0 : Math.round((allocated / requested) * 100);
  return { requested, allocated, percent };
}

/**
 * Подпись под вкладками сбора: сколько строк ПОКАЗАНО против того, сколько их
 * в разрезе.
 *
 * Числа законно расходятся, и молчать об этом нельзя. Плитки считает РАСХОД —
 * он идёт по всем подразделениям; реестр ниже грузится по вашему управлению и
 * сужается правами, поиском и фильтром. Без этой строки человек видел бы
 * «осталось 10» рядом со списком из семи и не знал бы, кому верить.
 */
function ScopeNotice({ shown, total }: { shown: number; total: number }) {
  if (total === 0) return null;
  if (shown === total) {
    return (
      <p className="text-xs text-muted-foreground">
        Статус в строке — из расхода раздела на сегодня, а не из кадровой
        карточки: по нему и отобраны эти люди.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Показано {shown} из {total}: плитки считает расход по всем
      подразделениям, а список ниже ограничен доступными вам и текущим отбором.
      Статус в строке — из расхода раздела на сегодня, а не из кадровой карточки.
    </p>
  );
}

export default function EmployeesPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <EmployeesScreen />
    </Suspense>
  );
}

function EmployeesScreen() {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );
  // Отбор живёт в АДРЕСЕ: раньше он держался в useState и пропадал при
  // перезагрузке, а ссылкой на отфильтрованный список нельзя было поделиться.
  // Так уже сделаны девять экранов раздела ОМ — здесь тот же приём.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") ?? "";
  const departmentFilter = searchParams.get("department") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";
  // Верхний вид экрана: «Сбор сил» (прежнее содержимое, умолчание) или
  // «Ежедневный расход» (Task 2). Тот же приём URL-состояния, что у
  // search/department/status — умолчание в адрес не пишется.
  const view = searchParams.get("view") === "daily" ? "daily" : "forces";

  const setFilter = useCallback(
    (key: string, value: string, fallback: string) => {
      const next = new URLSearchParams(searchParams);
      // Умолчание в адрес не пишем — ссылка на нетронутый список чистая.
      if (value === fallback) next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  // Поиск фиксируется с задержкой: значение уходит в адрес по окончании ввода.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(
    searchQuery,
    (value) => setFilter("search", value, "")
  );
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isRefetching: refreshing,
  } = useStaffUnitsByDirectorate();

  // Преобразуем данные из API в формат Employee
  const employees = useMemo<Employee[]>(() => {
    if (!data || !data.staff_units) return [];

    const result: Employee[] = [];
    let globalIndex = 1;

    data.staff_units.forEach((unit) => {
      // Реальный API может возвращать unit.employee (один объект) или unit.employees (массив)
      // Проверяем оба варианта для обратной совместимости
      const employee = (unit as any).employee;
      const employeesArray = (unit as any).employees;

      // Если есть массив employees (новый формат)
      if (Array.isArray(employeesArray) && employeesArray.length > 0) {
        employeesArray.forEach((empData: any) => {
          const emp = empData.employee;
          if (!emp) return;

          result.push({
            ...personnelFields(emp),
            staffUnitId: unit.id.toString(),
            number: globalIndex++,
            position: empData.position?.name || "Должность не указана",
            department: unit.division.name,
            departmentId: unit.division.id.toString(),
          });
        });
      }
      // Если есть одиночный employee (старый формат)
      else if (employee) {
        result.push({
          ...personnelFields(employee),
          staffUnitId: unit.id.toString(),
          number: globalIndex++,
          position: (unit as any).position?.name || "Должность не указана",
          department: unit.division.name,
          departmentId: unit.division.id.toString(),
        });
      }
    });

    return result;
  }, [data]);

  // Собираем уникальные отделы для фильтра
  const departments = useMemo<string[]>(() => {
    if (!data) return [];
    return Array.from(
      new Set(data.staff_units.map((unit) => unit.division.name))
    );
  }, [data]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка при загрузке данных"
    : null;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
    refetch();
  };

  // Сводка считалась тремя отдельными `filter` на каждый рендер, то есть на
  // каждое нажатие клавиши в поиске. Считаем один раз и одним проходом — от
  // ввода в поле сводка не зависит вовсе.
  const stats = useMemo(() => {
    const leaveLabels: string[] = [
      EMPLOYEE_STATUS_LABELS.vacation,
      EMPLOYEE_STATUS_LABELS.sick_leave,
      EMPLOYEE_STATUS_LABELS.leave_by_report,
    ];
    let active = 0;
    let onLeave = 0;
    let onTrip = 0;
    for (const employee of employees) {
      if (employee.status === EMPLOYEE_STATUS_LABELS.in_service) active += 1;
      else if (leaveLabels.includes(employee.status)) onLeave += 1;
      else if (employee.status === EMPLOYEE_STATUS_LABELS.business_trip)
        onTrip += 1;
    }
    return { total: employees.length, active, onLeave, onTrip };
  }, [employees]);

  // Пустой список от ОТБОРА и пустой список от отсутствия данных — разные
  // вещи, и выход из них разный. Прототип на первом даёт «Сбросить фильтры»,
  // здесь же обе ветки печатали одно «Сотрудники не найдены» и оставляли
  // человека наедине с фильтром, который он мог поставить три экрана назад.
  const filtersApplied =
    searchQuery !== "" || departmentFilter !== "all" || statusFilter !== "all";

  const resetFilters = useCallback(() => {
    setSearchDraft("");
    router.replace(pathname, { scroll: false });
  }, [router, pathname, setSearchDraft]);

  // Разрез сбора сил. Живёт РЯДОМ с реестром, а не вместо него: список
  // сотрудников и его отбор — прежние, добавлен только вопрос «кого отдали».
  const gathering = useForcesGathering();
  const forcesEvents = useSecurityEvents({
    search: "",
    stage: "FORCES",
    from: "",
    to: "",
    owner: "",
    page: 1,
    pageSize: 50,
  });
  const forcesRows = useMemo(
    () => forcesEvents.data?.results ?? [],
    [forcesEvents.data]
  );
  const forcesDemand = useMemo(() => {
    let requested = 0;
    let allocated = 0;
    for (const event of forcesRows) {
      const totals = eventForceTotals(event);
      requested += totals.requested;
      allocated += totals.allocated;
    }
    return { requested, allocated };
  }, [forcesRows]);

  // Кто на мероприятии и кто в строю — по идентификаторам разреза сбора:
  // легаси-запись сотрудника кода «Участие в ОМ» не знает вовсе (у типа нет
  // legacy_code), и отбирать по её подписи статуса было бы нечем.
  const assignedIds = useMemo(
    () => new Set(gathering.assigned.map((person) => String(person.employeeId))),
    [gathering.assigned]
  );
  const inServiceIds = useMemo(
    () => new Set(gathering.inService.map((person) => String(person.employeeId))),
    [gathering.inService]
  );

  const canSeeAll = hasPermission("employees", "read");

  const canSeeOwnDepartment = hasPermission("employees", "read-department");

  // Отбор — в useMemo, как в соседнем status-table.tsx: раньше полный обход
  // списка (плюс `toLowerCase` на каждое поле каждой строки) выполнялся заново
  // при любом рендере страницы.
  const filteredEmployees = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return employees.filter((employee) => {
      const visible =
        canSeeAll ||
        (canSeeOwnDepartment && user?.departmentId === employee.departmentId);
      if (!visible) return false;

      const matchesSearch =
        needle === "" ||
        employee.name.toLowerCase().includes(needle) ||
        employee.position.toLowerCase().includes(needle) ||
        employee.department.toLowerCase().includes(needle);

      const matchesDepartment =
        departmentFilter === "all" || employee.department === departmentFilter;

      const matchesStatus =
        statusFilter === "all" || employee.status === statusFilter;

      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [
    employees,
    searchQuery,
    departmentFilter,
    statusFilter,
    canSeeAll,
    canSeeOwnDepartment,
    user?.departmentId,
  ]);

  // Те же строки, что и в списке ниже, только суженные разрезом сбора: поиск,
  // фильтр по отделу и права продолжают действовать и на этих вкладках —
  // иначе они спорили бы с соседней вкладкой при том же отборе.
  // 🔴 Статус в строке ПОДМЕНЯЕТСЯ подписью раздела, и это не косметика.
  // Кадровая карточка несёт СВОЙ статус (легаси-система), а отбор на этих
  // вкладках идёт по статусам раздела ОМ — источники расходятся: человек без
  // действующего статуса раздела попадает в «В строю», а его легаси-карточка
  // при этом печатает «Отпуск». Строка спорила бы с вкладкой, в которой
  // стоит. Показываем то, по чему отбирали.
  const opsStatusLabel = useMemo(() => {
    const byId = new Map<string, string>();
    for (const person of gathering.persons) {
      byId.set(
        String(person.employeeId),
        person.statusLabel ?? EMPLOYEE_STATUS_LABELS.in_service
      );
    }
    return byId;
  }, [gathering.persons]);

  const withOpsStatus = useCallback(
    (employee: Employee): Employee => ({
      ...employee,
      status: opsStatusLabel.get(employee.id) ?? employee.status,
    }),
    [opsStatusLabel]
  );

  const assignedEmployees = useMemo(
    () =>
      filteredEmployees
        .filter((employee) => assignedIds.has(employee.id))
        .map(withOpsStatus),
    [filteredEmployees, assignedIds, withOpsStatus]
  );
  const inServiceEmployees = useMemo(
    () =>
      filteredEmployees
        .filter((employee) => inServiceIds.has(employee.id))
        .map(withOpsStatus),
    [filteredEmployees, inServiceIds, withOpsStatus]
  );


  // Выгружается ТО, ЧТО ПОКАЗАНО: те же строки и в том же порядке, что на
  // экране, с учётом отбора и прав. Файл собирается из уже загруженных
  // данных — отдельной ручки выгрузки на бэке нет, и «Экспорт» до этого был
  // кнопкой вовсе без обработчика.
  //
  // ИИН уходит в файл ХВОСТОМ: полных двенадцати цифр во фронте нет.
  const exportCsv = useCallback(() => {
    const head = [
      "№",
      "ФИО",
      "Звание",
      "ИИН",
      "Должность",
      "Отдел",
      "Статус",
      "Статус с",
      "Дата найма",
      "Табельный номер",
    ];
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filteredEmployees.map((employee) =>
      [
        String(employee.number),
        employee.name,
        employee.rank,
        employee.iinMasked,
        employee.position,
        employee.department,
        employee.status,
        formatIsoDate(employee.statusSince, ""),
        formatIsoDate(employee.hireDate, ""),
        employee.personnelNumber,
      ]
        .map(cell)
        .join(";")
    );
    // BOM — иначе Excel читает кириллицу как мусор.
    const csv = `﻿${[head.map(cell).join(";"), ...rows].join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "сотрудники.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredEmployees]);

  // Список, карточки, фильтр отделов и счётчики растут из ОДНОГО запроса
  // directorate. Закрыта ручка — закрывается вся страница: иначе на экране
  // остались бы нули и пустые фильтры без объяснения причины.
  if (isDirectorateForbidden(queryError)) {
    return (
      <DashboardLayout>
        <DirectorateAccessNotice reason={queryError.message} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Сбор сил на ОМ"
          description="Ежедневный расход департамента и сбор сил на мероприятия"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {/* Счётчик и заведение сотрудника относятся к реестру «Сбор
                  сил» — на вкладке «Ежедневный расход» ни фильтруемого
                  списка, ни диалога заведения нет, и обе кнопки повисали бы
                  над чужим экраном. */}
              {view === "forces" && (
                <>
                  {/* Здесь стояло «Всего сотрудников: {filteredEmployees.length}» —
                      под подписью «всего» печаталось число ПОСЛЕ отбора, и любой
                      фильтр менял «общую численность». Форма прототипа: сколько
                      показано и из скольких. */}
                  <Badge variant="outline" className="text-sm">
                    Показано {filteredEmployees.length} из {stats.total}
                  </Badge>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
                />
                Обновить
              </Button>
              {view === "forces" && (
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setIsAddDialogOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Добавить сотрудника
                </Button>
              )}
            </div>
          }
        />

        {/* Верхний вид экрана: «Сбор сил» — прежнее содержимое (плитки,
            заявки, вкладки реестра) без изменений; «Ежедневный расход» —
            задача Task 2, до неё карточка-заглушка. */}
        <nav
          className="flex w-fit gap-1 rounded-lg bg-muted p-1"
          aria-label="Разделы модуля"
        >
          <button
            type="button"
            aria-current={view === "forces" ? "page" : undefined}
            className={
              view === "forces"
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-semibold shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
            onClick={() => setFilter("view", "forces", "forces")}
          >
            Сбор сил
          </button>
          <button
            type="button"
            aria-current={view === "daily" ? "page" : undefined}
            className={
              view === "daily"
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-semibold shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
            onClick={() => setFilter("view", "daily", "forces")}
          >
            Ежедневный расход
          </button>
        </nav>

        {view === "daily" && <DailyExpenseBoard />}

        {view === "forces" && (
        <>
        {/* Счёт сбора сил. Плитки взяты у РАСХОДА — владельца этих чисел;
            прежние («Всего сотрудников», «В отпуске/больничном», «В
            командировке») считались по загруженному списку и с расходом
            расходились бы. Считается на экране ровно одно, и только потому,
            что расход этого не даёт: справочник кладёт «Участие в ОМ» в свою
            колонку «В строю», то есть отданные и оставшиеся в расходе
            неразличимы. */}
        <div
          role="group"
          aria-label="Личный состав на сбор"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          <StatCard
            label="По штату"
            value={gathering.staffTotal}
            caption="Штатных единиц по расходу"
          />
          <StatCard
            label="По списку"
            value={gathering.listTotal}
            caption="Занятых слотов — без вакансий"
          />
          <StatCard
            label="В строю"
            value={gathering.inServiceColumn}
            tone="success"
            caption="Колонка расхода: и оставшиеся, и отданные"
          />
          <StatCard
            label="Участие в ОМ"
            value={gathering.assigned.length}
            tone="warning"
            caption="Поимённо по статусу — расход их не считает"
          />
          <StatCard
            label="Осталось в строю"
            value={Math.max(0, gathering.inServiceColumn - gathering.assigned.length)}
            tone="info"
            caption="«В строю» минус отданные: иначе счёт двойной"
          />
        </div>

        {/* Заявки на силы: план против факта. Отвечает на вопрос «чем
            добирать» — недобор виден и по мероприятию, и по департаменту. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Запрос сил по мероприятиям
              </span>
              {forcesDemand.requested > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  выделено {forcesDemand.allocated} из {forcesDemand.requested}
                  {forcesDemand.allocated < forcesDemand.requested && (
                    <> · недобор {forcesDemand.requested - forcesDemand.allocated}</>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {forcesEvents.isPending && (
              <p className="text-xs text-muted-foreground">Загрузка сборов…</p>
            )}
            {forcesEvents.isError && (
              <p className="text-xs text-muted-foreground">
                Реестр мероприятий сейчас недоступен.
              </p>
            )}
            {forcesEvents.data && forcesRows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Мероприятий на стадии «Запрос сил» нет — собирать не под что.
              </p>
            )}
            {forcesRows.map((event) => {
              const totals = eventForceTotals(event);
              const gap = totals.requested - totals.allocated;
              return (
                <div key={event.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatIsoDate(event.businessDate)} · {event.objectName}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {totals.allocated} из {totals.requested} · {totals.percent}%
                      {gap > 0 && (
                        <span className="ml-2 font-semibold text-amber-700">
                          недобор {gap}
                        </span>
                      )}
                    </p>
                  </div>
                  <Progress value={totals.percent} className="h-2" />
                  {event.forceRequests.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {event.forceRequests.map((request) => {
                        const short =
                          request.requestedCount - request.allocatedCount;
                        return (
                          <li
                            key={request.id}
                            className="flex flex-wrap items-baseline gap-2 border-b py-1 text-xs last:border-0"
                          >
                            <span className="flex-1 truncate">{request.group}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {request.allocatedCount} из {request.requestedCount}
                            </span>
                            {/* Недодача названа у КАЖДОЙ строки, а не только
                                суммой: сумма говорит «сколько», строка — «с кого». */}
                            {short > 0 && (
                              <span className="tabular-nums font-semibold text-amber-700">
                                не отдано {short}
                              </span>
                            )}
                            <Badge
                              variant="secondary"
                              className={
                                FORCE_REQUEST_CLASS[request.status] ??
                                "bg-gray-100 text-gray-800"
                              }
                            >
                              {FORCE_REQUEST_LABEL[request.status] ?? request.status}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">
              Довыделение отдельной строкой раздел пока не хранит: заявка
              департаменту одна, и увеличение выделения переписывает её же —
              истории «кто закрыл чужой недобор» из этих данных не построить.
            </p>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Tabs defaultValue="table" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="table">Список сотрудников</TabsTrigger>
              {/* Две вкладки сбора — ТОТ ЖЕ список, суженный по статусу. Свою
                  разметку они не заводят: разойдясь с реестром колонками, они
                  показывали бы тех же людей по-другому. */}
              <TabsTrigger value="assigned">
                Участие в ОМ ({assignedEmployees.length})
              </TabsTrigger>
              <TabsTrigger value="in-service">
                В строю ({inServiceEmployees.length})
              </TabsTrigger>
              <TabsTrigger value="cards">Карточки</TabsTrigger>
              {selectedEmployee && (
                <TabsTrigger value="profile">Профиль сотрудника</TabsTrigger>
              )}
            </TabsList>

            {/* Кнопка «Импорт» убрана: обработчика у неё не было вовсе, а
                загрузка сотрудников в системе есть только management-командой
                — ручки, к которой её можно подключить, не существует.
                «Экспорт» обработчика тоже не имел; теперь он выгружает то, что
                показано на экране, — прямо из уже загруженного отбора. */}
            <div className="flex flex-wrap items-center gap-2">
              <PermissionGate resource="employees" action="read">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  disabled={filteredEmployees.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Экспорт CSV
                </Button>
              </PermissionGate>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по ФИО, должности, отделу..."
                aria-label="Поиск по сотрудникам"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select
              value={departmentFilter}
              onValueChange={(value) => setFilter("department", value, "all")}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Фильтр по отделу">
                <SelectValue placeholder="Все отделы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все отделы</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(value) => setFilter("status", value, "all")}
            >
              <SelectTrigger className="w-full sm:w-48" aria-label="Фильтр по статусу">
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {EMPLOYEE_STATUS_ITEMS.map((item) => (
                  <SelectItem key={item.code} value={item.label}>
                    {item.label}
                  </SelectItem>
                ))}
                <SelectItem value="Не обновлено">Не обновлено</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Четвёртого отбора прототипа — по рейтингу сотрудника — здесь нет,
              и это не пропуск. Оперативный рейтинг живой (`/api/ops/…`), но
              его домен ДЕ-ИДЕНТИФИЦИРОВАН намеренно: участник хранится
              синтетическим кодом и «безопасной подписью» без идентификатора,
              связи с кадровой записью в нём нет. Ключа для соединения с этой
              таблицей не существует — колонка, сортировка по ней и чипы
              «есть благодарности / есть замечания» были бы выдумкой. */}
          <p className="text-xs text-muted-foreground">
            Рейтинг сотрудника в этом списке не показывается: оперативный
            рейтинг ведётся обезличенно и не связан с кадровой карточкой.
          </p>

          <TabsContent value="table" className="space-y-6">
            {loading && (
              <div className="text-center py-8 text-muted-foreground">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
                <p className="mt-2">Загрузка данных...</p>
              </div>
            )}
            {error && (
              <div className="text-center py-8 text-red-500">
                <p>Ошибка: {error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  className="mt-4"
                >
                  Попробовать снова
                </Button>
              </div>
            )}
            {!loading && !error && (
              <EmployeeTable
                employees={filteredEmployees}
                onSelectEmployee={setSelectedEmployee}
                onResetFilters={filtersApplied ? resetFilters : undefined}
              />
            )}
          </TabsContent>

          <TabsContent value="assigned" className="space-y-6">
            {gathering.isPending && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Загрузка разреза сбора…
              </p>
            )}
            {gathering.isError && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Расход и статусы раздела не ответили — разрез сбора показать нечем.
              </p>
            )}
            {!gathering.isPending && !gathering.isError && (
              <>
                {gathering.assigned.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Со статусом «Участие в ОМ» сегодня никого нет: на мероприятия
                    ещё никого не выставили.
                  </p>
                )}
                <ScopeNotice
                  shown={assignedEmployees.length}
                  total={gathering.assigned.length}
                />
                <EmployeeTable
                  employees={assignedEmployees}
                  onSelectEmployee={setSelectedEmployee}
                  onResetFilters={filtersApplied ? resetFilters : undefined}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="in-service" className="space-y-6">
            {gathering.isPending && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Загрузка разреза сбора…
              </p>
            )}
            {gathering.isError && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Расход и статусы раздела не ответили — разрез сбора показать нечем.
              </p>
            )}
            {!gathering.isPending && !gathering.isError && (
              <>
                <ScopeNotice
                  shown={inServiceEmployees.length}
                  total={gathering.inService.length}
                />
                <EmployeeTable
                  employees={inServiceEmployees}
                  onSelectEmployee={setSelectedEmployee}
                  onResetFilters={filtersApplied ? resetFilters : undefined}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="cards" className="space-y-6">
            {loading && (
              <div className="text-center py-8 text-muted-foreground">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
                <p className="mt-2">Загрузка данных...</p>
              </div>
            )}
            {error && (
              <div className="text-center py-8 text-red-500">
                <p>Ошибка: {error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  className="mt-4"
                >
                  Попробовать снова
                </Button>
              </div>
            )}
            {!loading && !error && (
              <>
                {filteredEmployees.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>
                      {filtersApplied
                        ? "Ничего не найдено"
                        : "Сотрудники не найдены"}
                    </p>
                    {filtersApplied && (
                      <>
                        <p className="text-sm mt-1">
                          Измените запрос или сбросьте фильтры.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={resetFilters}
                        >
                          Сбросить фильтры
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredEmployees.map((employee) => (
                      <Card
                        key={employee.id}
                        className="cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => setSelectedEmployee(employee)}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-semibold">
                                {employee.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-lg truncate">
                                {employee.name}
                              </CardTitle>
                              {/* Карточка прототипа: «звание · должность». */}
                              <p className="text-sm text-muted-foreground truncate">
                                {employee.rank === ""
                                  ? employee.position
                                  : `${employee.rank} · ${employee.position}`}
                              </p>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            <div className="flex items-center text-sm">
                              <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="truncate">
                                {employee.department}
                              </span>
                            </div>
                            {/* Телефон и почта приходили захардкоженной пустой
                                строкой: две иконки поверх ничего. Ручка штатки
                                контактов не отдаёт — вместо них период
                                статуса, который отдаёт. */}
                            <div className="flex items-center text-sm">
                              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="tabular-nums">
                                {employee.statusSince === ""
                                  ? "статус не назначен"
                                  : `с ${formatIsoDate(employee.statusSince)}`}
                                {employee.statusUntil === ""
                                  ? ""
                                  : ` по ${formatIsoDate(employee.statusUntil)}`}
                              </span>
                            </div>
                            {/* Подвал карточки прототипа — дата найма. */}
                            <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                              <span>Дата найма</span>
                              <b className="tabular-nums font-medium text-foreground">
                                {formatIsoDate(employee.hireDate)}
                              </b>
                            </div>
                            <div className="flex items-center justify-between mt-3">
                              <Badge
                                className={
                                  employee.status === "Не обновлено"
                                    ? "bg-gray-100 text-gray-800"
                                    : getEmployeeStatusColor(
                                        EMPLOYEE_STATUS_CODE_BY_LABEL[
                                          employee.status
                                        ]
                                      )
                                }
                              >
                                {employee.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                №{employee.number}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {selectedEmployee && (
            <TabsContent value="profile" className="space-y-6">
              <EmployeeProfile
                employee={selectedEmployee}
                onClose={() => setSelectedEmployee(null)}
              />
            </TabsContent>
          )}
        </Tabs>
        </>
        )}

        <AddEmployeeDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
        />
      </div>
    </DashboardLayout>
  );
}
