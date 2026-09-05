"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { apiClient } from "@/lib/api";
import { Pager } from "@/components/pager";
import { DivisionPicker } from "@/components/division-picker";
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
import { useAuth } from "@/lib/auth";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { modulePermissionsOf } from "@/entities/portal-access";
import { DirectorateAccessNotice } from "@/components/directorate-access-notice";
import {
  directorateDenial,
  useStaffUnitsByDirectorate,
} from "@/hooks/use-staff-units-by-directorate";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import {
  EMPLOYEE_STATUS_ITEMS,
  EMPLOYEE_STATUS_LABELS,
  getEmployeeStatusColor,
} from "@/lib/status";
import { useStatusNaming, type StatusNaming } from "@/entities/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { useQueryClient } from "@tanstack/react-query";

import { formatIsoDate } from "@/shared/lib/date";
import { Progress } from "@/components/ui/progress";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useForcesGathering } from "@/hooks/use-forces-gathering";
import { ForcesSplitPanel } from "@/features/forces-split/ui/ForcesSplitPanel";
import { DepartmentRequestsTable } from "@/features/department-requests";
import { ForceCollectionsTable } from "@/features/force-collections";
import {
  FORCES_ALLOCATE,
  FORCES_COMMAND,
  useChainAccess,
} from "@/features/forces-split/ui/chain-access";
import { objectLabel } from "@/entities/security-event";
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
/** Окно, в котором живёт сбор сил: от завершения рекогносцировки до
 * согласования расстановки. Зеркалит `_ALLOCATION_STAGES` бэкенда — лента не
 * должна показывать мероприятие, действия в котором сервер отобьёт. */
const COLLECTION_STAGES = "DEMAND,FORCES,PLACEMENT" as const;

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

/**
 * Размер страницы реестра. Пятьдесят строк — экран с запасом на прокрутку и
 * 27 КБ ответа против 2,7 МБ на пяти тысячах сотрудников (замер 27.08.2026).
 * Потолок на сервере — 200 (`DIRECTORATE_MAX_PAGE_SIZE`).
 */
const PAGE_SIZE = 50;

/**
 * Строки ответа штатки → строки реестра. Вынесено из компонента (Plane №228):
 * теперь их две — страница для списка и весь состав для вкладок сбора сил, —
 * и разбор обязан быть один на обе.
 */
function toEmployees(units: any[] | undefined, naming: StatusNaming): Employee[] {
  if (!units) return [];
  const result: Employee[] = [];
  let globalIndex = 1;

  units.forEach((unit) => {
    // Реальный API может возвращать unit.employee (один объект) или
    // unit.employees (массив) — оба формата разбираются здесь.
    const employee = (unit as any).employee;
    const employeesArray = (unit as any).employees;

    if (Array.isArray(employeesArray) && employeesArray.length > 0) {
      employeesArray.forEach((empData: any) => {
        const emp = empData.employee;
        if (!emp) return;
        result.push({
          ...personnelFields(emp, naming),
          staffUnitId: unit.id.toString(),
          number: globalIndex++,
          position: empData.position?.name || "Должность не указана",
          department: unit.division.name,
          departmentId: unit.division.id.toString(),
        });
      });
    } else if (employee) {
      result.push({
        ...personnelFields(employee, naming),
        staffUnitId: unit.id.toString(),
        number: globalIndex++,
        position: (unit as any).position?.name || "Должность не указана",
        department: unit.division.name,
        departmentId: unit.division.id.toString(),
      });
    }
  });

  return result;
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
  // ПЕРВАЯ ВКЛАДКА — РАСХОД (Plane №273, решение заказчика: «первая вкладка
  // это Ежедневный расход Организации»). Значение по умолчанию меняется
  // ВМЕСТЕ с порядком: оставить умолчанием «forces» значило бы, что первая
  // вкладка открывается второй, и человек каждый раз попадает не туда.
  const view = searchParams.get("view") === "forces" ? "forces" : "daily";
  // Номер страницы — тоже в адресе: ссылка на «страницу 7 отбора» должна
  // открываться такой же (Plane №228).
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);

  const setFilter = useCallback(
    (key: string, value: string, fallback: string) => {
      const next = new URLSearchParams(searchParams);
      // Умолчание в адрес не пишем — ссылка на нетронутый список чистая.
      if (value === fallback) next.delete(key);
      else next.set(key, value);
      // Смена отбора возвращает на первую страницу: остаться на седьмой при
      // новом поиске значит показать пустоту там, где результаты есть.
      if (key !== "page") next.delete("page");
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
  // Вкладка стала управляемой: по ней решается, грузить ли ВЕСЬ состав
  // подразделения (вкладки сбора сил) или хватит страницы (Plane №228).
  const [activeTab, setActiveTab] = useState("table");
  const queryClient = useQueryClient();
  // `user` остаётся ради подразделения человека (подпись и отбор «своё»);
  // ПРАВА теперь спрашиваются у раздела (Plane №352, Ш-1).
  const { user } = useAuth();
  // Каталог типов статусов для фильтра — с сервера (Plane №354).
  const { types: catalogStatusTypes } = useEmployeeStatusTypes(false);
  const { hasPermission: hasOpsPermission, isLoading: opsPermissionsLoading } =
    useOpsPermissions();
  const allowedCodes = modulePermissionsOf("/employees");
  const allowed = allowedCodes.some((code) => hasOpsPermission(code));

  // ── Страница вместо всего состава (Plane №228) ──────────────────────
  //
  // Экран просит у сервера СТРАНИЦУ и передаёт ему отбор. Прежде он тянул весь
  // состав подразделения и фильтровал его в браузере: на 440 сотрудниках это
  // 248 КБ, на пяти тысячах — 2,7 МБ и 5000 строк DOM на каждое открытие.
  //
  // Отбор ушёл на сервер целиком, а не наполовину: клиентский поиск по
  // загруженной странице искал бы ТОЛЬКО среди пятидесяти строк и молчал бы о
  // том, что остальные пять тысяч он не смотрел.
  const statistics = useStaffUnitStatistics();
  // Значение фильтра — идентификатор подразделения (см. `departments`).
  const departmentId =
    departmentFilter === "all" ? undefined : Number(departmentFilter) || undefined;

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isRefetching: refreshing,
  } = useStaffUnitsPage({
    page,
    pageSize: PAGE_SIZE,
    search: searchQuery || undefined,
    divisionId: departmentId,
    // Статус отбирается сервером по коду ДЕЙСТВУЮЩЕГО статуса.
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  // Вкладки «Участие в ОМ» и «В строю» пересекают состав с данными сбора сил,
  // и им нужен ВЕСЬ состав подразделения, а не страница. Поэтому полный ответ
  // грузится ЛЕНИВО — только когда такую вкладку открыли: на пяти тысячах
  // человек это 2,7 МБ, и платить их при каждом открытии реестра незачем.
  const opsTabOpen = activeTab === "assigned" || activeTab === "in-service";
  const fullDirectorate = useStaffUnitsByDirectorate(opsTabOpen);
  // Подписи статусов — из справочника (Plane №366): тип, заведённый заказчиком
  // в админке, обязан подписываться сам, без правки клиента.
  const naming = useStatusNaming();

  // Строки ТЕКУЩЕЙ СТРАНИЦЫ. Нумерация строк продолжает страницу, а не
  // начинается с единицы заново: «№ 51» на второй странице — это тот же
  // порядок, что и в выгрузке.
  const employees = useMemo<Employee[]>(() => {
    const offset = (page - 1) * PAGE_SIZE;
    return toEmployees(data?.staff_units, naming).map((employee) => ({
      ...employee,
      number: employee.number + offset,
    }));
  }, [data, page, naming]);

  // Весь состав — только для вкладок сбора сил и только когда их открыли.
  const allEmployees = useMemo<Employee[]>(
    () => toEmployees(fullDirectorate.data?.staff_units, naming),
    [fullDirectorate.data, naming]
  );

  // Отделы для фильтра — из статистики подразделения, а НЕ из показанной
  // страницы: на странице пятьдесят строк, и список фильтра сузился бы до тех
  // отделов, что в них попали (Plane №228).
  //
  // 🔴 ЗНАЧЕНИЕ — ИДЕНТИФИКАТОР, а не название. Имена подразделений уникальны
  // только внутри родителя: на реальной структуре «Первый отдел» есть в каждом
  // управлении, и отбор по имени означал бы «покажи любой из тридцати шести».
  // Заодно это снимало дубли ключей в списке (React ругался на них вслух).
  // Подпись несёт путь — тот же приём, что в разрезе штата (Plane №214).
  const departments = useMemo<{ id: number; label: string }[]>(() => {
    const stats = statistics.data;
    if (!stats) return [];
    const rows = [
      ...stats.departments.map((row) => ({
        id: row.department_id,
        name: row.department_name,
        ancestors: row.ancestors ?? [],
      })),
      ...stats.directorates.map((row) => ({
        id: row.directorate_id,
        name: row.directorate_name,
        ancestors: row.ancestors ?? [],
      })),
      ...stats.divisions.map((row) => ({
        id: row.division_id,
        name: row.division_name,
        ancestors: row.ancestors ?? [],
      })),
    ];
    return rows.map((row) => ({
      id: row.id,
      label:
        row.ancestors.length > 0
          ? `${row.ancestors.join(" › ")} › ${row.name}`
          : row.name,
    }));
  }, [statistics.data]);

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
    // `total` — сколько строк ОТВЕЧАЕТ ОТБОРУ на сервере, а не сколько их
    // на странице: под подписью «Показано N из M» размер страницы вместо
    // общего числа означал бы «показано 50 из 50» на пяти тысячах человек
    // (Plane №228). Остальные три числа считаются по странице и названы
    // соответственно — они про то, что видно.
    return {
      total: data?.matched_count ?? employees.length,
      active,
      onLeave,
      onTrip,
    };
  }, [employees, data?.matched_count]);

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
  // Право департамента (Plane №272, Ш-3). Клиент гейтит по КОДУ права —
  // область («мой ли это департамент») проверяет сервер, и второй ответ на
  // тот же вопрос разошёлся бы с ним при первой правке дерева подразделений.
  const chainAccess = useChainAccess();
  // Входящие штаба 2-го департамента: запрос личного состава, направленный
  // ЗАВЕРШЕНИЕМ рекогносцировки (Plane «Реестр ОМ-23»).
  //
  // Спрашивается ОКНО СБОРА, а не одна стадия (Plane №110). «Потребность» и
  // «Запрос сил» проходит сервер сам, и мероприятие приходит на «Расстановку»
  // сразу с рекогносцировки — отбор по `stage=DEMAND` оставил бы ленту штаба
  // пустой навсегда, то есть погасил бы всю цепочку сбора сил. Три стадии —
  // ровно то окно, в котором сервер разрешает править раскладку
  // (`_ALLOCATION_STAGES`): лента не должна показывать мероприятие, действия
  // в котором сервер отобьёт.
  const inboundEvents = useSecurityEvents({
    search: "",
    stage: COLLECTION_STAGES,
    from: "",
    to: "",
    owner: "",
    page: 1,
    pageSize: 50,
  });
  const inboundRows = useMemo(
    () =>
      (inboundEvents.data?.results ?? []).filter(
        // Черновик старшего наряда штабу не показываем: запрос считается
        // направленным только с момента, который ставит завершение этапа.
        (event) => event.reconForceRequestedAt !== null
      ),
    [inboundEvents.data]
  );
  const inboundTotal = useMemo(
    () => inboundRows.reduce((sum, event) => sum + event.reconForceRequest, 0),
    [inboundRows]
  );

  const forcesDemand = useMemo(() => {
    let requested = 0;
    let allocated = 0;
    for (const event of inboundRows) {
      const totals = eventForceTotals(event);
      requested += totals.requested;
      allocated += totals.allocated;
    }
    return { requested, allocated };
  }, [inboundRows]);

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

  // Кто ведёт сбор сил по всей области (`forces.command` — деление
  // потребности, `forces.allocate` — оповещение управлений), тот видит состав
  // целиком; кто только выделяет людей (`forces.select`) — своё подразделение.
  // Прежние `employees/read` и `employees/read-department` были ровно этим же
  // делением, но в зашитом наборе портальной роли.
  const canSeeAll =
    hasOpsPermission("forces.command") || hasOpsPermission("forces.allocate");

  // Своё подразделение видит и тот, кто выделяет людей на ОМ
  // (`forces.select`), и тот, у кого есть просто право на личный состав
  // (`personnel.view`) — второй пришёл с решением заказчика 02.09.2026
  // (Plane №375): «свои управления видны всем, строго на ознакомление».
  // Правка от этого не открывается: кнопки живут на своих правах.
  const canSeeOwnDepartment =
    hasOpsPermission("forces.select") || hasOpsPermission("personnel.view");

  /** Право ПРАВИТЬ кадровую запись — то же, которым закрыты правка и удаление
   *  в карточке сотрудника (`entities/employee`). Без него экран остаётся
   *  читаемым, но заводить людей с него нельзя. */
  const canEditPersonnel = hasOpsPermission("orgstructure.manage");

  // ПРАВА — единственный отбор, оставшийся на клиенте (Plane №228). Поиск,
  // отдел и статус теперь считает сервер: клиентский поиск по загруженной
  // странице искал бы среди пятидесяти строк и молчал бы о том, что остальные
  // пять тысяч не смотрел.
  const visible = useCallback(
    (employee: Employee) =>
      canSeeAll ||
      (canSeeOwnDepartment && user?.departmentId === employee.departmentId),
    [canSeeAll, canSeeOwnDepartment, user?.departmentId]
  );

  const filteredEmployees = useMemo(
    () => employees.filter(visible),
    [employees, visible]
  );

  // Вкладки сбора сил живут на ВСЁМ составе: пересечение страницы с составом
  // на мероприятии показало бы «участвуют трое» там, где их триста.
  const allVisibleEmployees = useMemo(
    () => allEmployees.filter(visible),
    [allEmployees, visible]
  );

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
      allVisibleEmployees
        .filter((employee) => assignedIds.has(employee.id))
        .map(withOpsStatus),
    [allVisibleEmployees, assignedIds, withOpsStatus]
  );
  const inServiceEmployees = useMemo(
    () =>
      allVisibleEmployees
        .filter((employee) => inServiceIds.has(employee.id))
        .map(withOpsStatus),
    [allVisibleEmployees, inServiceIds, withOpsStatus]
  );


  // Выгружается ВЕСЬ ОТБОР, а не показанная страница (Plane №228). Экран
  // теперь листает по пятьдесят строк, и файл «сотрудники.csv» с полусотней
  // человек из пяти тысяч был бы обманом: кнопка обещает выгрузку отбора.
  //
  // Поэтому здесь ОТДЕЛЬНЫЙ запрос — тот же отбор, но без страниц: ручка без
  // `page` отдаёт всё, что отвечает условиям. Он делается по нажатию, а не при
  // открытии экрана, и в этом вся разница: 2,7 МБ за файл, который человек
  // попросил, против 2,7 МБ за каждое открытие реестра.
  //
  // ИИН уходит в файл ХВОСТОМ: полных двенадцати цифр во фронте нет.
  const [exporting, setExporting] = useState(false);
  const exportCsv = useCallback(async () => {
    setExporting(true);
    let selection: Employee[] = [];
    try {
      const whole = await apiClient.getStaffUnitsByDirectorate({
        search: searchQuery || undefined,
        divisionId: departmentId,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      selection = toEmployees(whole.staff_units, naming).filter(visible);
    } catch {
      // Сеть отказала — выгружаем хотя бы показанное, но молчать об этом
      // нельзя: файл, тихо ставший короче, читается как «столько и есть».
      selection = filteredEmployees;
      window.alert(
        "Не удалось получить весь отбор — в файл ушла только показанная страница."
      );
    } finally {
      setExporting(false);
    }
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
    const rows = selection.map((employee) =>
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
  }, [filteredEmployees, searchQuery, departmentId, statusFilter, visible]);

  // Список, карточки, фильтр отделов и счётчики растут из ОДНОГО запроса
  // directorate. Закрыта ручка — закрывается вся страница: иначе на экране
  // остались бы нули и пустые фильтры без объяснения причины.
  // Причина отказа передаётся заглушке: 403 «нет права» и 400 «учётка не
  // привязана к подразделению» чинятся разными людьми (Plane №329).
  // 🔴 ГЕЙТ СТОИТ ПЕРВЫМ СРЕДИ ВОЗВРАТОВ, и это не стиль. Первая версия
  // правки №352 (Ш-1) уехала ВНУТРЬ ветки `if (denial)` — синтаксис верный,
  // `tsc` молчит, а на деле проверка прав выполнялась только тогда, когда
  // сервер и так отказал. В обычном случае экран открывался кому угодно:
  // fail-open, найден фоновым ревью коммита, а не гейтом, потому что целевые
  // пробы ходили по экранам раздела и портальные не трогали.
  if (!opsPermissionsLoading && !allowed) {
    return <OpsAccessDenied what="сбора сил на ОМ" />;
  }

  // Список, карточки, фильтр отделов и счётчики растут из ОДНОГО запроса
  // directorate. Закрыта ручка — закрывается вся страница.
  const denial = directorateDenial(queryError);
  if (denial) {
    return (
      <DashboardLayout>
        <DirectorateAccessNotice denial={denial} reason={error} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          eyebrow="Ежедневный расход"
          title="Сбор сил на ОМ"
          description="Ежедневный расход департамента и сбор сил на мероприятия"
          // 🔴 МЕТКА «В РАЗРАБОТКЕ» — ТОЛЬКО У СБОРА СИЛ (Plane №598). По
          // этому адресу живут ДВА модуля, и выбирает `?view=`; все открытые
          // карточки записи `/employees` — про сбор сил (№425, №426, №444), а
          // у ежедневного расхода их нет вовсе. Реестр видит только
          // `pathname`, поэтому различить модули может лишь сам экран.
          inDevelopment={view === "forces"}
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
              {/* Заведение сотрудника — ПРАВО, а не вид экрана (Plane №375).
                  Кнопка показывалась всякому, кто открыл вкладку сбора сил, и
                  после того как экран открылся читателям, она предлагала бы
                  им действие, на которое сервер отвечает отказом. */}
              {view === "forces" && canEditPersonnel && (
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
          {/* ПОРЯДОК И НАЗВАНИЯ — ТРЕБОВАНИЕ ЗАКАЗЧИКА (Plane №273): «первая
              вкладка это Ежедневный расход Организации. Вторая вкладка Сбор
              сил на ОМ». Названы полностью, а не сокращённо: «Расход» и
              «Сбор сил» на одном экране не говорят, ЧЕЙ расход и ЧТО
              собирают. */}
          <button
            type="button"
            aria-current={view === "daily" ? "page" : undefined}
            className={
              view === "daily"
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-semibold shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
            onClick={() => setFilter("view", "daily", "daily")}
          >
            Ежедневный расход организации
          </button>
          <button
            type="button"
            aria-current={view === "forces" ? "page" : undefined}
            className={
              view === "forces"
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-semibold shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
            onClick={() => setFilter("view", "forces", "daily")}
          >
            Сбор сил на ОМ
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

        {/* Сбор сил: ОДНА лента вместо двух (Plane №110).
            До задачи их разводили СТАДИИ — «Потребность» ждала распределения,
            «Запрос сил» вела план против факта. Стадии проходит сервер, обе
            ленты стали описывать одно и то же множество, и любой признак,
            которым их пробовали развести, заставлял карточку ПРЫГАТЬ из блока
            в блок посреди работы: человек сохранял раскладку — и терял из-под
            курсора панель, которой её ведёт. Один блок, одна карточка на ОМ,
            план и факт в её шапке. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Запрос сил по мероприятиям
              </span>
              {inboundTotal > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  всего запрошено {inboundTotal} чел.
                  {forcesDemand.requested > 0 && (
                    <>
                      {" · "}выделено {forcesDemand.allocated} из{" "}
                      {forcesDemand.requested}
                      {forcesDemand.allocated < forcesDemand.requested && (
                        <> · недобор {forcesDemand.requested - forcesDemand.allocated}</>
                      )}
                    </>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inboundEvents.isPending && (
              <p className="text-xs text-muted-foreground">Загрузка запросов…</p>
            )}
            {inboundEvents.isError && (
              <p className="text-xs text-muted-foreground">
                Реестр мероприятий сейчас недоступен.
              </p>
            )}
            {inboundEvents.data && inboundRows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Новых запросов с рекогносцировки нет — старшие нарядов ещё не
                завершили осмотр либо их запросы уже разложены.
              </p>
            )}
            {inboundRows.map((event) => (
              <div key={event.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/security-ops/events/${event.id}`}
                    className="truncate text-sm font-semibold text-primary-ink"
                  >
                    {event.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {event.code} · {formatIsoDate(event.businessDate)} ·{" "}
                    {objectLabel(event)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {event.reconForceRequest} чел.
                  </p>
                  {/* Кто просит — старший наряда; его подпись стоит рядом с
                      числом: запрос это оценка ЧЕЛОВЕКА, а не выход расчёта. */}
                  <p className="text-xs text-muted-foreground">
                    запросил {event.chiefName.trim() === "" ? event.ownerName : event.chiefName}
                  </p>
                </div>
                </div>
                {/* План против факта по ЭТОМУ мероприятию — перенесено из
                    снятой второй ленты: недобор виден и суммой, и построчно. */}
                {(() => {
                  const totals = eventForceTotals(event);
                  const gap = totals.requested - totals.allocated;
                  if (totals.requested === 0) return null;
                  return (
                    <div className="mt-2">
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {totals.allocated} из {totals.requested} · {totals.percent}%
                        {gap > 0 && (
                          <span className="ml-2 font-semibold text-amber-700">
                            недобор {gap}
                          </span>
                        )}
                      </p>
                      <Progress value={totals.percent} className="mt-1 h-2" />
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
                    </div>
                  );
                })()}
                {/* Раскладка живёт ЗДЕСЬ, а не на своём экране: разложить
                    пришедшее число — продолжение той же строки, в которой оно
                    показано (Plane №73, шаг «СС-1»). */}
                <ForcesSplitPanel event={event} />
              </div>
            ))}
            {/* Оговорка переехала из снятого второго блока: она про ЭТИ же
                заявки, и потерять её вместе с блоком значило бы убрать
                предупреждение, а не дубль. */}
            <p className="text-[11px] text-muted-foreground">
              Довыделение отдельной строкой раздел пока не хранит: заявка
              департаменту одна, и увеличение выделения переписывает её же —
              истории «кто закрыл чужой недобор» из этих данных не построить.
            </p>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="max-w-full overflow-x-auto">
              {/* ЗАЯВКИ ДЕПАРТАМЕНТУ (Plane №272, Ш-3) — ВКЛАДКА, а не блок
                  над экраном. Первая версия висела над всем содержимым: у
                  эталона заказчика это вкладка, и, что важнее, блок сверху
                  делал СВОЮ таблицу первой на странице — шесть проб кадрового
                  реестра, ищущих колонку по ПЕРВОЙ таблице, разом позеленели
                  бы на чужих заголовках. Полный смоук это и поймал.
                  Вкладка первая: ответственный за расход департамента
                  приходит сюда за заявками, а не за реестром. */}
              {/* ДВА РАЗРЕЗА ОДНОЙ ЦЕПОЧКИ, и оба могут быть у одного
                  человека. «Сборы» — вид ШТАБА («сколько я раздал и сколько
                  мне вернули», Plane №271), «Заявки» — вид ДЕПАРТАМЕНТА («что
                  просят у меня», Plane №272). Показывать взаимоисключающе
                  нельзя: у администратора есть оба права, и выбор за него
                  сделал бы экран. */}
              {chainAccess.can(FORCES_COMMAND) && (
                <TabsTrigger value="collections">Сборы</TabsTrigger>
              )}
              {chainAccess.can(FORCES_ALLOCATE) && (
                <TabsTrigger value="requests">Заявки</TabsTrigger>
              )}
              <TabsTrigger value="table">Список сотрудников</TabsTrigger>
              {/* Две вкладки сбора — ТОТ ЖЕ список, суженный по статусу. Свою
                  разметку они не заводят: разойдясь с реестром колонками, они
                  показывали бы тех же людей по-другому. */}
              {/* Числа на вкладках берутся из РАЗРЕЗА СБОРА, а не из списка
                  людей: состав подразделения теперь грузится лениво (только
                  когда вкладку открыли), и счётчик из него показывал бы ноль
                  до первого нажатия — то есть врал бы (Plane №228). */}
              <TabsTrigger value="assigned">
                Участие в ОМ ({gathering.assigned.length})
              </TabsTrigger>
              <TabsTrigger value="in-service">
                В строю ({gathering.inService.length})
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
              {/* Выгрузка — ТОГО ОТБОРА, что показан в реестре. На вкладке
                  «Заявки» она выгрузила бы список людей, которого человек в
                  этот момент не видит. */}
              {activeTab !== "requests" &&
                activeTab !== "collections" &&
                canSeeAll && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportCsv}
                    disabled={filteredEmployees.length === 0 || exporting}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {exporting ? "Собираем файл…" : "Экспорт CSV"}
                  </Button>
                )}
            </div>
          </div>

          {/* Отбор и оговорка про рейтинг — ПРО СПИСОК ЛЮДЕЙ. На вкладке
              «Заявки» их не показываем: поиск по ФИО там ничего не ищет, а
              оговорка отвечает на вопрос, которого не задавали. Пустой
              элемент управления, который ничего не делает, — не нейтральная
              деталь: человек пробует им пользоваться. */}
          {activeTab !== "requests" && activeTab !== "collections" && (
          <>
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

            {/* Выпадающий список на 581 значение листался только колесом
                (Plane №232) — теперь выбор с поиском по названию И пути. */}
            <DivisionPicker
              value={departmentFilter}
              options={departments}
              onChange={(value) => setFilter("department", value, "all")}
            />

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
          </>
          )}

          <TabsContent value="collections" className="space-y-6">
            <ForceCollectionsTable enabled={chainAccess.can(FORCES_COMMAND)} />
          </TabsContent>

          <TabsContent value="requests" className="space-y-6">
            <DepartmentRequestsTable enabled={chainAccess.can(FORCES_ALLOCATE)} />
          </TabsContent>

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
              <>
                <EmployeeTable
                  employees={filteredEmployees}
                  onSelectEmployee={setSelectedEmployee}
                  onResetFilters={filtersApplied ? resetFilters : undefined}
                />
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  matched={data?.matched_count ?? filteredEmployees.length}
                  hasNext={data?.has_next ?? false}
                  busy={refreshing}
                  onChange={(next) =>
                    setFilter("page", next === 1 ? "1" : String(next), "1")
                  }
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="assigned" className="space-y-6">
            {fullDirectorate.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Загрузка состава подразделения…
              </p>
            )}
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
            {fullDirectorate.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Загрузка состава подразделения…
              </p>
            )}
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
                                  /* Цвет ПО КОДУ, а не обратным поиском по
                                     русской подписи (Plane №366): подписи
                                     перестали быть замкнутым списком, и поиск
                                     отдавал `undefined` на каждом типе из
                                     справочника — бейдж «Участие в ОМ» красился
                                     серым, как неизвестный. */
                                  naming.colorOf(employee.statusCode)
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
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  matched={data?.matched_count ?? filteredEmployees.length}
                  hasNext={data?.has_next ?? false}
                  busy={refreshing}
                  onChange={(next) =>
                    setFilter("page", next === 1 ? "1" : String(next), "1")
                  }
                />
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
