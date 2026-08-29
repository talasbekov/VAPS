"use client";

import { useState, useMemo, useEffect} from "react";
import Link from "next/link";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import { Pager } from "@/components/pager";
import { DivisionPicker } from "@/components/division-picker";
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
  UNKNOWN_STATUS_PAINT,
  getEmployeeStatusColor,
  getEmployeeStatusLabel,
  getFormattedEmployeeStatus,
} from "@/lib/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  MoreHorizontal,
  Edit,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Eye,
  ArrowRightLeft,
  UserX,
} from "lucide-react";
import { formatIsoDate, parseIsoDate } from "@/shared/lib/date";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";
import { PlannedStatusesDialog } from "@/features/employee-status-update/ui/PlannedStatusesDialog";
import { SecondEmployeeDialog } from "@/features/employee-status-update/ui/SecondEmployeeDialog";
import { EmployeeProfile } from "@/entities/employee/ui/EmployeeProfile";
import { useEventParticipations } from "@/hooks/use-event-participations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { personnelFields } from "@/entities/employee/model/from-api";
import type { Employee as EmployeeType } from "@/entities/employee/model/types";
import { LoadFailure } from "@/components/load-failure";

interface Employee {
  id: string;
  number: number;
  name: string;
  department: string;
  position: string;
  status: string;
  /** Сырой код ТЕКУЩЕГО статуса — РОВНО `current_status.status_type`, а не
   *  подпись. `local_status` прикомандированных сюда НЕ попадает: его
   *  учитывает только ТЕКСТ (`getFormattedEmployeeStatus` печатает оба
   *  статуса строкой), а код остаётся кодом текущего — см. `describeStatus`
   *  ниже. Прежняя редакция комментария называла оба источника и обещала
   *  того, чего код не делает (находка ревью ветки 22.08). Нужен, чтобы
   *  отличить «Участие в ОМ» (код `EVENT_ASSIGNMENT` из справочника
   *  operations, этой ручке в принципе не родной) от обычных статусов, не
   *  гадая по тексту подписи. */
  statusCode: string | null;
  /** ISO «ГГГГ-ММ-ДД» или пустая строка. Форматируется ТОЛЬКО на выводе:
   *  раньше в поле лежал уже готовый текст, и `isOverdue` пытался разобрать
   *  его обратно через `new Date("14.08.2026, 00:00:00")` — это NaN, поэтому
   *  подсветка просрочки не срабатывала ни разу. */
  startDate: string;
  endDate: string;
  phone: string;
  email: string;
  priority: "normal" | "high" | "critical";
}

/**
 * Текст статуса + его сырой код. «Участие в ОМ» (`EVENT_ASSIGNMENT`) — код
 * справочника operations («Сбор сил на ОМ»), эта ручка его не знает вовсе:
 * `getFormattedEmployeeStatus` прочитал бы его как «Не обновлено» — то есть
 * спутал бы «статус ЕСТЬ, просто из другого каталога» с «статуса нет
 * вовсе». В реальном ответе `staff-units/directorate/` такого кода не бывает
 * (модель `EmployeeStatus.StatusType` его не содержит) — веточка нужна
 * только затем, чтобы не соврать, если он всё же придёт.
 */
function describeStatus(
  // `any`: вызывающие берут `emp`/`employee` из ответа API тем же способом
  // (`(unit as any).employee`) — своя строгая форма здесь разошлась бы с
  // `EmployeeStatusType`, который код `EVENT_ASSIGNMENT` в принципе не
  // содержит (см. комментарий выше).
  emp: any
): { text: string; code: string | null } {
  const code = emp?.current_status?.status_type ?? null;
  if (code !== null && EVENT_PARTICIPATION_STATUS_CODES.has(code)) {
    return { text: "Участие в ОМ", code };
  }
  return { text: getFormattedEmployeeStatus(emp), code };
}

interface StatusTableProps {
  selectedEmployees: string[];
  onSelectionChange: (selected: string[]) => void;
  loading?: boolean;
  onRefresh?: () => void;
}

/** Размер страницы таблицы статусов — как у реестра (Plane №231). */
const STATUS_PAGE_SIZE = 50;

/** Подпись незанятой штатной единицы. Одно место на весь файл: строка
 *  сравнивалась с литералом в пяти местах, и одно из них (пункт меню
 *  «Запланировать статус») сравнение просто потеряло — окно открывалось у
 *  вакансии и упиралось в «Сотрудник не найден» (Plane №257). */
const VACANCY_NAME = "ВАКАНТ";

/** Строка без сотрудника: должность в штате есть, занять её некому. */
function isVacancyRow(employee: Employee): boolean {
  return employee.name === VACANCY_NAME;
}

export function StatusTable({
  selectedEmployees,
  onSelectionChange,
  loading: externalLoading = false,
  onRefresh,
}: StatusTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // `statusCode` не сортируемое поле (нет управления, задающего его как
  // ключ сортировки, и код — не то же самое, что видимый текст статуса):
  // Сортировка отсюда УБРАНА (Plane №231): менять её было нечем — ни одна
  // кнопка не звала `setSortBy`, — а с постраничной загрузкой клиентская
  // сортировка переставляла бы только показанные пятьдесят строк, выдавая это
  // за порядок всего подразделения. Порядок задаёт сервер (дерево, номер
  // слота), таблица его сохраняет.
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEmployeeForEdit, setSelectedEmployeeForEdit] =
    useState<Employee | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] =
    useState<Employee | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedEmployeeForProfile, setSelectedEmployeeForProfile] =
    useState<EmployeeType | null>(null);
  const [secondDialogOpen, setSecondDialogOpen] = useState(false);
  const [selectedEmployeeForSecond, setSelectedEmployeeForSecond] =
    useState<Employee | null>(null);

  // ── Страница вместо всего состава (Plane №231) ──────────────────────
  //
  // Таблица звала весь состав подразделения и фильтровала его в браузере: на
  // пяти тысячах сотрудников экран открывался 14,2 секунды и держал 5124
  // строки в DOM, а три пробы форм падали по таймауту клика. Отбор ушёл на
  // сервер целиком — клиентский поиск по загруженной странице искал бы среди
  // пятидесяти строк и молчал бы о том, что остальные не смотрел.
  const [page, setPage] = useState(1);
  const statistics = useStaffUnitStatistics();
  // Мероприятия участия — ОДИН запрос на всю таблицу (Plane №281). Строка
  // таблицы адресует сотрудника ключом `${staffUnitId}-${employeeId}`, а
  // участия приходят по числовому id — отсюда разбор ключа в `eventsOf`.
  const participations = useEventParticipations();
  const departmentId =
    departmentFilter === "all" ? undefined : Number(departmentFilter) || undefined;

  const {
    data,
    isLoading: queryLoading,
    isError: queryFailed,
    isFetching: queryFetching,
    refetch,
  } = useStaffUnitsPage({
    page,
    pageSize: STATUS_PAGE_SIZE,
    search: searchQuery || undefined,
    divisionId: departmentId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  // Смена отбора возвращает на первую страницу: остаться на седьмой при новом
  // поиске значит показать пустоту там, где результаты есть.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, departmentFilter, statusFilter]);

  const internalLoading = queryLoading || externalLoading;

  // Преобразуем данные из API в формат Employee
  const employees = useMemo<Employee[]>(() => {
    if (!data || !data.staff_units || !Array.isArray(data.staff_units))
      return [];

    const result: Employee[] = [];
    let globalIndex = 1;

    data.staff_units.forEach((unit) => {
      // Реальный API возвращает unit.employee (один объект), а не unit.employees (массив)
      // Проверяем оба варианта для обратной совместимости
      const employee = (unit as any).employee;
      const employeesArray = (unit as any).employees;

      // Если есть массив employees (старый формат)
      if (Array.isArray(employeesArray) && employeesArray.length > 0) {
        employeesArray.forEach((empData: any) => {
          const emp = empData.employee;
          const status = emp?.current_status;

          // Используем форматированный статус с учетом local_status для прикомандированных
          const { text: statusText, code: statusCode } = describeStatus(emp);

          let priority: "normal" | "high" | "critical" = "normal";
          if (!status) {
            priority = "critical";
          } else if (
            status.end_date &&
            new Date(status.end_date) < new Date()
          ) {
            priority = "high";
          }

          result.push({
            id: emp
              ? `${unit.id}-${emp.id}`
              : `${unit.id}-vacant-${globalIndex}`,
            number: globalIndex++,
            name: emp ? `${emp.last_name} ${emp.first_name}` : VACANCY_NAME,
            department: unit.division?.name || "Не указан",
            position: empData.position?.name || "Должность не указана",
            status: statusText,
            statusCode,
            startDate: status?.start_date ?? "",
            endDate: status?.end_date ?? "",
            phone: "",
            email: "",
            priority,
          });
        });
      }
      // Если есть один employee (новый формат API)
      else if (employee) {
        const status = employee.current_status;

        // Используем форматированный статус с учетом local_status для прикомандированных
        const { text: statusText, code: statusCode } = describeStatus(employee);

        let priority: "normal" | "high" | "critical" = "normal";
        if (!status) {
          priority = "critical";
        } else if (status.end_date && new Date(status.end_date) < new Date()) {
          priority = "high";
        }

        result.push({
          id: `${unit.id}-${employee.id}`,
          number: globalIndex++,
          name: `${employee.last_name} ${employee.first_name}`,
          department: unit.division?.name || "Не указан",
          position: (unit as any).position?.name || "Должность не указана",
          status: statusText,
          statusCode,
          startDate: status?.start_date ?? "",
          endDate: status?.end_date ?? "",
          phone: "",
          email: "",
          priority,
        });
      }
      // Если нет сотрудника - вакансия
      else {
        result.push({
          id: `${unit.id}-vacant`,
          number: globalIndex++,
          name: VACANCY_NAME,
          department: unit.division?.name || "Не указан",
          position: (unit as any).position?.name || "Должность не указана",
          status: "Не обновлено",
          statusCode: null,
          startDate: "",
          endDate: "",
          phone: "",
          email: "",
          priority: "critical",
        });
      }
    });

    return result;
  }, [data]);

  // Отделы для фильтра — из статистики подразделения, а не из показанной
  // страницы: на странице пятьдесят строк, и список сузился бы до тех отделов,
  // что в них попали. Значение — идентификатор: имена уникальны только внутри
  // родителя, подпись несёт путь (тот же приём, что в реестре, Plane №231).
  const departments = useMemo<{ id: number; label: string }[]>(() => {
    const stats = statistics.data;
    if (!stats) return [];
    const rows = [
      ...stats.departments.map((row) => ({
        id: row.department_id, name: row.department_name, ancestors: row.ancestors ?? [],
      })),
      ...stats.directorates.map((row) => ({
        id: row.directorate_id, name: row.directorate_name, ancestors: row.ancestors ?? [],
      })),
      ...stats.divisions.map((row) => ({
        id: row.division_id, name: row.division_name, ancestors: row.ancestors ?? [],
      })),
    ];
    return rows.map((row) => ({
      id: row.id,
      label: row.ancestors.length > 0 ? `${row.ancestors.join(" › ")} › ${row.name}` : row.name,
    }));
  }, [statistics.data]);

  // Функция для обновления данных
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      refetch();
    }
  };

  /** Числовой id сотрудника. Понимает ОБА вида ключа, и это не перестраховка:
   *  строка таблицы адресует сотрудника составным `${staffUnitId}-${employeeId}`,
   *  а карточка профиля — просто `${employeeId}` (её собирает `personnelFields`).
   *  Разбор «взять кусок после дефиса» на втором виде молча давал пусто, и блок
   *  мероприятий в карточке не показывался ни разу.
   *  null — вакансия либо не разобралось. */
  const employeeIdOf = (employee: { id: string }) => {
    const parts = employee.id.split("-");
    const raw = parts.length > 1 ? parts[1] : parts[0];
    if (!raw || raw.startsWith("vacant")) return null;
    const employeeId = Number(raw);
    return Number.isNaN(employeeId) ? null : employeeId;
  };

  /** Мероприятия, на которые привлечён сотрудник строки. Пусто — их нет либо
   *  данные ещё едут (`participations.loading` различает эти два случая). */
  const eventsOf = (employee: { id: string }) => {
    const employeeId = employeeIdOf(employee);
    if (employeeId === null) return [];
    return participations.byEmployee.get(employeeId) ?? [];
  };

  // Функция для открытия диалога редактирования
  const handleEditStatus = (employee: Employee) => {
    // Вторая застава после меню (Plane №257): у вакансии сотрудника нет, и
    // форма заведения статуса ей не адресована — открывать окно, которое
    // заведомо упрётся в «Сотрудник не найден», хуже, чем не открыть.
    if (isVacancyRow(employee)) return;
    setSelectedEmployeeForEdit(employee);
    setEditDialogOpen(true);
  };

  // Функция для открытия диалога планирования
  const handleScheduleStatus = (employee: Employee) => {
    setSelectedEmployeeForSchedule(employee);
    setScheduleDialogOpen(true);
  };

  // Функция для открытия диалога откомандирования
  const handleSecondEmployee = (employee: Employee) => {
    setSelectedEmployeeForSecond(employee);
    setSecondDialogOpen(true);
  };

  // Функция для открытия профиля сотрудника
  const handleViewProfile = (employee: Employee) => {
    if (!data || !data.staff_units || !Array.isArray(data.staff_units)) return;

    // Проверяем, что это не вакантная должность
    if (isVacancyRow(employee)) return;

    // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
    const [unitIdStr, employeeIdStr] = employee.id.split("-");
    const unitId = parseInt(unitIdStr, 10);
    const employeeId =
      employeeIdStr && !employeeIdStr.startsWith("vacant")
        ? parseInt(employeeIdStr, 10)
        : null;

    if (!employeeId) return;

    const staffUnit = data.staff_units.find((unit) => unit.id === unitId);
    if (!staffUnit) return;

    // Проверяем оба формата: новый (unit.employee) и старый (unit.employees)
    const unitEmployee = (staffUnit as any).employee;
    const employeesArray = (staffUnit as any).employees;

    let emp: any = null;

    if (unitEmployee && unitEmployee.id === employeeId) {
      // Новый формат: один employee
      emp = unitEmployee;
    } else if (Array.isArray(employeesArray)) {
      // Старый формат: массив employees
      const empData = employeesArray.find(
        (e: any) => e.employee?.id === employeeId
      );
      emp = empData?.employee;
    }

    if (!emp) return;

    // Кадровые поля разбирает общий `personnelFields` — тот же, что у
    // `/employees`. Своя копия здесь подставляла пустые строки в звание, ИИН
    // и дату найма, и карточка с этого экрана выглядела беднее той же
    // карточки с соседнего.
    const employeeProfile: EmployeeType = {
      ...personnelFields(emp),
      number: employee.number,
      position: employee.position,
      department: employee.department,
      departmentId: staffUnit.division.id.toString(),
    };

    setSelectedEmployeeForProfile(employeeProfile);
    setProfileDialogOpen(true);
  };

  // Функция для обработки успешного обновления
  const handleEditSuccess = () => {
    handleRefresh();
    if (onRefresh) {
      onRefresh();
    }
  };

  const loading = externalLoading || internalLoading;

  const statusTypes = EMPLOYEE_STATUS_ITEMS.map((item) => {
    let icon = Calendar;
    switch (item.code) {
      case "in_service":
        icon = CheckCircle;
        break;
      case "on_duty":
      case "after_duty":
        icon = Clock;
        break;
      case "sick_leave":
      case "other_absence":
        icon = AlertCircle;
        break;
      default:
        icon = Calendar;
    }

    return {
      value: item.label,
      color: item.color,
      icon,
    };
  });

  const getStatusBadge = (status: string) => {
    if (status === "Не обновлено") {
      // Не отдельный литерал: тот же серый, что и у любого нераспознанного
      // кода (`UNKNOWN_STATUS_PAINT`) — один источник, а не вторая копия.
      return <Badge className={UNKNOWN_STATUS_PAINT.badge}>{status}</Badge>;
    }

    const statusType = statusTypes.find((s) => s.value === status);
    const code = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
    const colorClass = statusType?.color ?? getEmployeeStatusColor(code);

    if (!statusType) {
      return <Badge className={colorClass}>{status}</Badge>;
    }

    const Icon = statusType.icon;
    return (
      <Badge className={colorClass}>
        <Icon className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "border-l-4 border-red-500";
      case "high":
        return "border-l-4 border-yellow-500";
      default:
        return "border-l-4 border-transparent";
    }
  };

  // ОТБОР СЧИТАЕТ СЕРВЕР (Plane №231). Здесь остаётся только порядок строк —
  // он же порядок ответа, и сортировка по номеру ничего не переставляет, а
  // делает это явным.
  const filteredEmployees = useMemo(
    () => [...employees].sort((a, b) => a.number - b.number),
    [employees]
  );

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(filteredEmployees.map((emp) => emp.id));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectEmployee = (employeeId: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedEmployees, employeeId]);
    } else {
      onSelectionChange(selectedEmployees.filter((id) => id !== employeeId));
    }
  };

  /** Срок статуса вышел. Считается по ISO-дате: разбирать обратно то, что
   *  сами же отформатировали, значит зависеть от локали вывода. */
  const isOverdue = (endDate: string) => {
    const date = parseIsoDate(endDate);
    if (date === null) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Сотрудники организации</CardTitle>
          <div className="text-sm text-muted-foreground">
            {/* «из» — по ОТБОРУ, а не по странице: выбор живёт поверх
                страниц, и «из 50» на пяти тысячах сотрудников означало бы не
                то, что человек видит (Plane №231). */}
            Выбрано: {selectedEmployees.length} из{" "}
            {data?.matched_count ?? filteredEmployees.length}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по ФИО, отделу, должности..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Тот же выбор с поиском, что в реестре (Plane №232). */}
          <DivisionPicker
            value={departmentFilter}
            options={departments}
            onChange={setDepartmentFilter}
          />

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Фильтр по статусу">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {statusTypes.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      selectedEmployees.length === filteredEmployees.length &&
                      filteredEmployees.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-16">№</TableHead>
                <TableHead>ФИО</TableHead>
                <TableHead>Отдел</TableHead>
                <TableHead>Должность</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Последнее обновление</TableHead>
                <TableHead>Следующее обновление</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.map((employee) => (
                <TableRow
                  key={employee.id}
                  // Адрес строки для проб и для отладки: ФИО на стенде
                  // повторяются (однофамильцев с одинаковым именем по
                  // несколько), и проба, ищущая строку текстом, проверяла бы
                  // ЧУЖОГО человека. Тот же приём, что в таблице сбора сил.
                  data-employee-id={employeeIdOf(employee) ?? undefined}
                  // Подсветка просрочки ОСТАЁТСЯ: она несёт смысл, а не
                  // декорацию. Уходит только зебра.
                  className={`${getPriorityColor(employee.priority)} hover:bg-muted ${
                    isOverdue(employee.endDate) ? "bg-red-50" : ""
                  }`}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedEmployees.includes(employee.id)}
                      onCheckedChange={(checked) =>
                        handleSelectEmployee(employee.id, checked as boolean)
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {employee.number}
                  </TableCell>
                  {/* Подстрока телефона снята: ручка штатки телефон не
                      отдаёт вовсе (`employee.phone` — всегда пустая строка),
                      и пустая строка держала лишнюю строку высоты в КАЖДОЙ
                      строке таблицы без единого символа текста. */}
                  <TableCell>
                    <div className="font-medium">{employee.name}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {employee.department}
                  </TableCell>
                  <TableCell className="text-sm">{employee.position}</TableCell>
                  {/* Статус — точка входа в СПИСОК статусов сотрудника
                      (текущий + запланированные), а не в форму заведения
                      нового: щелчок по уже проставленному статусу — это
                      вопрос «что у человека сейчас и что впереди», и форма
                      на этот вопрос не отвечает. Завести новый статус
                      по-прежнему можно пунктом меню «Запланировать статус».
                      Кнопка, а не onClick на ячейке: строка кликабельна и с
                      клавиатуры, и роль элемента не приходится угадывать. */}
                  {/* whitespace-normal перебивает умолчание примитива
                      (nowrap): у соседних ячеек это верно (одна строка,
                      известной ширины), а подпись под ссылкой — фраза на
                      два-три слова короче своей ширины, и nowrap растянул бы
                      её в одну строку через всю таблицу вместо переноса. */}
                  <TableCell className="whitespace-normal">
                    {isVacancyRow(employee) ? (
                      getStatusBadge(employee.status)
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          onClick={() => handleScheduleStatus(employee)}
                          title="Открыть статусы сотрудника"
                          className="rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:opacity-80"
                        >
                          {getStatusBadge(employee.status)}
                        </button>
                        {/* НА КАКОЕ ОМ ПРИВЛЕЧЁН (Plane №281). Здесь стояла
                            ссылка на ОБЩИЙ разрез «Сбор сил»: статус говорил
                            «участвует», а на каком мероприятии — не говорил, и
                            чтобы это выяснить, надо было идти в другой раздел и
                            искать себя в списках. Связь есть с Ш-3
                            (`ops_status_participations`), теперь она едет с
                            сервера вместе с участием (код и название ОМ) и
                            становится ссылкой на КАРТОЧКУ мероприятия.

                            🔴 УСЛОВИЕ — НАЛИЧИЕ УЧАСТИЙ, а не код статуса
                            строки. Код здесь кадровый (`EmployeeStatus`), а
                            `EVENT_ASSIGNMENT` живёт в каталоге раздела ОМ, и
                            в реальном ответе штатки его НЕ БЫВАЕТ — блок,
                            висевший на этом условии, не показывался на стенде
                            ни разу (проверено живой пробой: у 21 строки с
                            участиями кадровый код другой). Участия же
                            приходят по сотруднику и от каталога не зависят.

                            Прежний общий адрес остался запасным: он
                            показывается тем, у кого кадровый код всё-таки
                            говорит об участии, а мероприятий не нашлось —
                            статус проставлен без привязки (так заводили до
                            Ш-3) либо данные ещё едут. */}
                        {eventsOf(employee).length > 0 ? (
                          <div className="flex max-w-[220px] flex-col items-start gap-0.5">
                            {eventsOf(employee).map((participation) => (
                              <Link
                                key={participation.event_id}
                                href={`/security-ops/events/${participation.event_id}`}
                                className="text-primary-ink whitespace-nowrap text-xs font-medium hover:underline"
                                title={participation.event_title}
                              >
                                → {participation.event_code ||
                                  `ОМ #${participation.event_id}`}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          employee.statusCode !== null &&
                          EVENT_PARTICIPATION_STATUS_CODES.has(
                            employee.statusCode
                          ) && (
                            <div className="flex max-w-[220px] flex-col items-start gap-0.5">
                              <Link
                                href="/employees?view=forces"
                                className="text-primary-ink text-xs font-medium hover:underline"
                              >
                                → Сбор сил
                              </Link>
                              <p className="text-muted-foreground text-[11px] leading-tight">
                                {participations.loading
                                  ? "Мероприятия загружаются"
                                  : "Мероприятие у статуса не указано"}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatIsoDate(employee.startDate, "Не обновлено")}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div
                      className={
                        isOverdue(employee.endDate)
                          ? "text-destructive-ink font-medium"
                          : ""
                      }
                    >
                      {formatIsoDate(employee.endDate, "Не указано")}
                      {isOverdue(employee.endDate) && (
                        <AlertCircle className="h-4 w-4 inline ml-1" aria-hidden="true" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          // Имя с фамилией: в таблице таких кнопок столько же,
                          // сколько строк, и «Действия» без адресата не
                          // отличает одну от другой.
                          aria-label={`Действия: ${employee.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Действия</DropdownMenuLabel>
                        {/* У ВАКАНСИИ действий нет НИ ОДНОГО: все четыре
                            адресованы человеку, которого на должности нет
                            (Plane №257). Раньше три пункта прятались, а
                            четвёртый — «Запланировать статус» — оставался и
                            обещал операцию, которой нет: окно открывалось,
                            форма заполнялась, сохранение падало в «Сотрудник
                            не найден».

                            Меню при этом НЕ прячется и не гасится целиком:
                            пустое место в столбце действий читается как
                            «кнопку забыли нарисовать», а погашенный триггер
                            не отвечает на вопрос «почему». Вместо этого одна
                            нерабочая строка объясняет причину — то же
                            правило, что у пустого состояния списка: не белое
                            пятно, а фраза. */}
                        {isVacancyRow(employee) ? (
                          <DropdownMenuItem disabled>
                            <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                            Должность вакантна — действий нет
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleEditStatus(employee)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Запланировать статус
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleScheduleStatus(employee)}
                            >
                              <Calendar className="mr-2 h-4 w-4" />
                              Запланированные статусы
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleSecondEmployee(employee)}
                            >
                              <ArrowRightLeft className="mr-2 h-4 w-4" />
                              Откомандировать сотрудника
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleViewProfile(employee)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Просмотр профиля
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Pager
          page={page}
          pageSize={STATUS_PAGE_SIZE}
          matched={data?.matched_count ?? filteredEmployees.length}
          hasNext={data?.has_next ?? false}
          busy={queryFetching}
          onChange={setPage}
        />

        {loading && (
          <div className="text-center py-8 text-muted-foreground">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
            <p className="mt-2">Загрузка данных...</p>
          </div>
        )}

        {/* Отказ запроса и «никто не подошёл под фильтр» — разные факты:
            раньше оба давали «Сотрудники не найдены» на главном экране. */}
        {!loading && queryFailed && (
          <LoadFailure
            what="список сотрудников"
            onRetry={() => void refetch()}
            isRetrying={queryFetching}
            className="items-center text-center"
          />
        )}

        {!loading && !queryFailed && filteredEmployees.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Сотрудники не найдены</p>
          </div>
        )}
      </CardContent>

      {/* Диалог редактирования статуса */}
      <EditStatusDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        employeeId={selectedEmployeeForEdit?.id || null}
        employeeName={selectedEmployeeForEdit?.name}
        currentStatus={selectedEmployeeForEdit?.status}
        employeePosition={selectedEmployeeForEdit?.position}
        employeeDepartment={selectedEmployeeForEdit?.department}
        onSuccess={handleEditSuccess}
      />

      {/* Диалог просмотра запланированных статусов */}
      <PlannedStatusesDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        employeeId={selectedEmployeeForSchedule?.id || null}
        employeeName={selectedEmployeeForSchedule?.name}
        // Список закрываем ДО открытия формы: два Radix-диалога разом дерутся
        // за фокус-ловушку. Сотрудник берётся из состояния списка — он же
        // адресат формы, и спрашивать его заново не у чего.
        onSchedule={() => {
          const employee = selectedEmployeeForSchedule;
          if (!employee) return;
          setScheduleDialogOpen(false);
          handleEditStatus(employee);
        }}
      />

      {/* Диалог откомандирования сотрудника */}
      <SecondEmployeeDialog
        open={secondDialogOpen}
        onOpenChange={setSecondDialogOpen}
        employeeId={selectedEmployeeForSecond?.id || null}
        employeeName={selectedEmployeeForSecond?.name}
        onSuccess={handleEditSuccess}
      />

      {/* Диалог просмотра профиля */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {/* Заголовок обязателен: без него Radix ругается в консоли, а
              скринридер объявляет диалог без имени. Визуально он не нужен —
              карточка профиля печатает имя сама. */}
          <DialogHeader className="sr-only">
            <DialogTitle>
              Профиль сотрудника
              {selectedEmployeeForProfile
                ? `: ${selectedEmployeeForProfile.name}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          {selectedEmployeeForProfile && (
            <EmployeeProfile
              employee={selectedEmployeeForProfile}
              onClose={() => setProfileDialogOpen(false)}
              events={eventsOf(selectedEmployeeForProfile)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
