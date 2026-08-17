"use client";

import { useState, useMemo } from "react";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
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
} from "lucide-react";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";
import { PlannedStatusesDialog } from "@/features/employee-status-update/ui/PlannedStatusesDialog";
import { SecondEmployeeDialog } from "@/features/employee-status-update/ui/SecondEmployeeDialog";
import { EmployeeProfile } from "@/entities/employee/ui/EmployeeProfile";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Employee as EmployeeType } from "@/entities/employee/model/types";
import { LoadFailure } from "@/components/load-failure";

interface Employee {
  id: string;
  number: number;
  name: string;
  department: string;
  position: string;
  status: string;
  lastUpdate: string;
  nextUpdate: string;
  phone: string;
  email: string;
  priority: "normal" | "high" | "critical";
}

interface StatusTableProps {
  selectedEmployees: string[];
  onSelectionChange: (selected: string[]) => void;
  loading?: boolean;
  onRefresh?: () => void;
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
  const [sortBy, setSortBy] = useState<keyof Employee>("number");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
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

  // Используем React Query для загрузки данных
  const {
    data,
    isLoading: queryLoading,
    isError: queryFailed,
    isFetching: queryFetching,
    refetch,
  } = useStaffUnitsByDirectorate();

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
          const statusText = getFormattedEmployeeStatus(emp);

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
            name: emp ? `${emp.last_name} ${emp.first_name}` : "ВАКАНТ",
            department: unit.division?.name || "Не указан",
            position: empData.position?.name || "Должность не указана",
            status: statusText,
            lastUpdate: status?.start_date
              ? (() => {
                  const date = new Date(status.start_date);
                  return isNaN(date.getTime())
                    ? "Не обновлено"
                    : date.toLocaleString("ru-RU");
                })()
              : "Не обновлено",
            nextUpdate: status?.end_date
              ? (() => {
                  const date = new Date(status.end_date);
                  return isNaN(date.getTime())
                    ? "Не указано"
                    : date.toLocaleString("ru-RU");
                })()
              : "Не указано",
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
        const statusText = getFormattedEmployeeStatus(employee);

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
          lastUpdate: status?.start_date
            ? (() => {
                const date = new Date(status.start_date);
                return isNaN(date.getTime())
                  ? "Не обновлено"
                  : date.toLocaleString("ru-RU");
              })()
            : "Не обновлено",
          nextUpdate: status?.end_date
            ? (() => {
                const date = new Date(status.end_date);
                return isNaN(date.getTime())
                  ? "Не указано"
                  : date.toLocaleString("ru-RU");
              })()
            : "Не указано",
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
          name: "ВАКАНТ",
          department: unit.division?.name || "Не указан",
          position: (unit as any).position?.name || "Должность не указана",
          status: "Не обновлено",
          lastUpdate: "Не обновлено",
          nextUpdate: "Не указано",
          phone: "",
          email: "",
          priority: "critical",
        });
      }
    });

    return result;
  }, [data]);

  // Собираем уникальные отделы для фильтра
  const departments = useMemo<string[]>(() => {
    if (!data || !data.staff_units || !Array.isArray(data.staff_units))
      return [];
    return Array.from(
      new Set(
        data.staff_units
          .map((unit) => unit.division?.name || "")
          .filter(Boolean)
      )
    );
  }, [data]);

  // Функция для обновления данных
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      refetch();
    }
  };

  // Функция для открытия диалога редактирования
  const handleEditStatus = (employee: Employee) => {
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
    if (employee.name === "ВАКАНТ") return;

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

    const status = emp.current_status;

    const employeeProfile: EmployeeType = {
      id: employee.id,
      number: employee.number,
      name: employee.name,
      position: employee.position,
      department: employee.department,
      departmentId: staffUnit.division.id.toString(),
      status: employee.status,
      phone: "",
      email: "",
      hireDate: status?.start_date || new Date().toISOString().split("T")[0],
      birthDate: "",
      address: "",
      manager: "",
      photo: emp.photo,
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
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
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

  const filteredEmployees = useMemo(() => {
    return employees
      .filter((employee) => {
        const matchesSearch =
          searchQuery === "" ||
          employee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          employee.department
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          employee.position.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesDepartment =
          departmentFilter === "all" ||
          employee.department === departmentFilter;

        const matchesStatus =
          statusFilter === "all" || employee.status === statusFilter;

        return matchesSearch && matchesDepartment && matchesStatus;
      })
      .sort((a, b) => {
        const aValue = a[sortBy];
        const bValue = b[sortBy];

        if (sortOrder === "asc") {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        } else {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
      });
  }, [
    employees,
    searchQuery,
    departmentFilter,
    statusFilter,
    sortBy,
    sortOrder,
  ]);

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

  const isOverdue = (nextUpdate: string) => {
    if (nextUpdate === "Не указано") return false;
    const date = new Date(nextUpdate);
    return !isNaN(date.getTime()) && date < new Date();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Сотрудники организации</CardTitle>
          <div className="text-sm text-muted-foreground">
            Выбрано: {selectedEmployees.length} из {filteredEmployees.length}
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

          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-full sm:w-64">
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

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48">
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
                  className={`${getPriorityColor(employee.priority)} ${
                    isOverdue(employee.nextUpdate) ? "bg-red-50" : ""
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
                  <TableCell>
                    <div>
                      <div className="font-medium">{employee.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {employee.phone}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {employee.department}
                  </TableCell>
                  <TableCell className="text-sm">{employee.position}</TableCell>
                  {/* Статус — точка входа в модалку «Статусы сотрудника».
                      Кнопка, а не onClick на ячейке: строка кликабельна и с
                      клавиатуры, и роль элемента не приходится угадывать. */}
                  <TableCell>
                    {employee.name === "ВАКАНТ" ? (
                      getStatusBadge(employee.status)
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEditStatus(employee)}
                        title="Открыть статусы сотрудника"
                        className="rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:opacity-80"
                      >
                        {getStatusBadge(employee.status)}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {employee.lastUpdate === "Не обновлено"
                      ? employee.lastUpdate
                      : (() => {
                          try {
                            const date = new Date(employee.lastUpdate);
                            return isNaN(date.getTime())
                              ? "Не обновлено"
                              : date.toLocaleString("ru-RU");
                          } catch {
                            return "Не обновлено";
                          }
                        })()}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div
                      className={
                        isOverdue(employee.nextUpdate)
                          ? "text-red-600 font-medium"
                          : ""
                      }
                    >
                      {employee.nextUpdate === "Не указано"
                        ? employee.nextUpdate
                        : (() => {
                            try {
                              const date = new Date(employee.nextUpdate);
                              return isNaN(date.getTime())
                                ? "Не указано"
                                : date.toLocaleString("ru-RU");
                            } catch {
                              return "Не указано";
                            }
                          })()}
                      {isOverdue(employee.nextUpdate) &&
                        employee.nextUpdate !== "Не указано" && (
                          <AlertCircle className="h-4 w-4 inline ml-1" />
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
                        <DropdownMenuItem
                          onClick={() => handleEditStatus(employee)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Запланировать статус
                        </DropdownMenuItem>
                        {employee.name !== "ВАКАНТ" && (
                          <DropdownMenuItem
                            onClick={() => handleScheduleStatus(employee)}
                          >
                            <Calendar className="mr-2 h-4 w-4" />
                            Запланированные статусы
                          </DropdownMenuItem>
                        )}
                        {employee.name !== "ВАКАНТ" && (
                          <DropdownMenuItem
                            onClick={() => handleSecondEmployee(employee)}
                          >
                            <ArrowRightLeft className="mr-2 h-4 w-4" />
                            Откомандировать сотрудника
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {employee.name !== "ВАКАНТ" && (
                          <DropdownMenuItem
                            onClick={() => handleViewProfile(employee)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Просмотр профиля
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

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
          {selectedEmployeeForProfile && (
            <EmployeeProfile
              employee={selectedEmployeeForProfile}
              onClose={() => setProfileDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
