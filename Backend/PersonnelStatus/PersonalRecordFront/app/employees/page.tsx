"use client";

import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { EmployeeTable } from "@/entities/employee/ui/EmployeeTable";
import { EmployeeProfile } from "@/entities/employee/ui/EmployeeProfile";
import { AddEmployeeDialog } from "@/features/add-employee";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Upload,
  RefreshCw,
  Building2,
  Calendar,
  Phone,
  Mail,
} from "lucide-react";
import { useAuth, PermissionGate } from "@/lib/auth";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
  EMPLOYEE_STATUS_LABELS,
  getEmployeeStatusLabel,
  getEmployeeStatusColor,
  getFormattedEmployeeStatus,
} from "@/lib/status";
import { useQueryClient } from "@tanstack/react-query";

import type { Employee } from "@/entities/employee/model/types";

export default function EmployeesPage() {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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

          // Используем форматированный статус с учетом local_status для прикомандированных
          const statusText = getFormattedEmployeeStatus(emp);
          const currentStatus = emp.current_status;

          result.push({
            id: emp.id.toString(),
            staffUnitId: unit.id.toString(),
            number: globalIndex++,
            name: `${emp.last_name} ${emp.first_name}`,
            position: empData.position?.name || "Должность не указана",
            department: unit.division.name,
            departmentId: unit.division.id.toString(),
            status: statusText,
            phone: "",
            email: "",
            hireDate:
              currentStatus?.start_date ||
              new Date().toISOString().split("T")[0],
            birthDate: "",
            address: "",
            manager: "",
          });
        });
      }
      // Если есть одиночный employee (старый формат)
      else if (employee) {
        // Используем форматированный статус с учетом local_status для прикомандированных
        const statusText = getFormattedEmployeeStatus(employee);
        const currentStatus = employee.current_status;

        result.push({
          id: employee.id.toString(),
          staffUnitId: unit.id.toString(),
          number: globalIndex++,
          name: `${employee.last_name} ${employee.first_name}`,
          position: (unit as any).position?.name || "Должность не указана",
          department: unit.division.name,
          departmentId: unit.division.id.toString(),
          status: statusText,
          phone: "",
          email: "",
          hireDate:
            currentStatus?.start_date || new Date().toISOString().split("T")[0],
          birthDate: "",
          address: "",
          manager: "",
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Управление персоналом
            </h1>
            <p className="text-muted-foreground mt-1">
              Управление сотрудниками организации
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Badge variant="outline" className="text-sm">
              Всего сотрудников: {filteredEmployees.length}
            </Badge>
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
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setIsAddDialogOpen(true)}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Добавить сотрудника
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Всего сотрудников
              </CardTitle>
              <Users className="h-6 w-6 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Активных записей</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">В строю</CardTitle>
              <Building2 className="h-6 w-6 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats.active}
              </div>
              <p className="text-xs text-muted-foreground">Работают</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                В отпуске/больничном
              </CardTitle>
              <Calendar className="h-6 w-6 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {stats.onLeave}
              </div>
              <p className="text-xs text-muted-foreground">
                Временно отсутствуют
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                В командировке
              </CardTitle>
              <Phone className="h-6 w-6 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {stats.onTrip}
              </div>
              <p className="text-xs text-muted-foreground">Служебные поездки</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="table" className="space-y-6">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="table">Список сотрудников</TabsTrigger>
              <TabsTrigger value="cards">Карточки</TabsTrigger>
              {selectedEmployee && (
                <TabsTrigger value="profile">Профиль сотрудника</TabsTrigger>
              )}
            </TabsList>

            <div className="flex items-center space-x-2">
              <PermissionGate resource="employees" action="read">
                <Button variant="outline" size="sm">
                  <Upload className="h-4 w-4 mr-2" />
                  Импорт
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Экспорт
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select
              value={departmentFilter}
              onValueChange={setDepartmentFilter}
            >
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
                {EMPLOYEE_STATUS_ITEMS.map((item) => (
                  <SelectItem key={item.code} value={item.label}>
                    {item.label}
                  </SelectItem>
                ))}
                <SelectItem value="Не обновлено">Не обновлено</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
              />
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
                    <p>Сотрудники не найдены</p>
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
                              <p className="text-sm text-muted-foreground truncate">
                                {employee.position}
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
                            <div className="flex items-center text-sm">
                              <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span>{employee.phone}</span>
                            </div>
                            <div className="flex items-center text-sm">
                              <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="truncate">{employee.email}</span>
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

        <AddEmployeeDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
        />
      </div>
    </DashboardLayout>
  );
}
