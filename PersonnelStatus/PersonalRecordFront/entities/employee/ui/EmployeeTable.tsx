"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
} from "lucide-react";
import { useAuth, PermissionGate } from "@/lib/auth";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  getEmployeeStatusColor,
} from "@/lib/status";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";
import { useQueryClient } from "@tanstack/react-query";
import { formatIsoDate } from "@/shared/lib/date";
import type { Employee } from "../model/types";

interface EmployeeTableProps {
  employees: Employee[];
  onSelectEmployee: (employee: Employee) => void;
}

export function EmployeeTable({
  employees,
  onSelectEmployee,
}: EmployeeTableProps) {
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [statusDialogFor, setStatusDialogFor] = useState<Employee | null>(null);
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEmployees(employees.map((emp) => emp.id));
    } else {
      setSelectedEmployees([]);
    }
  };

  const handleSelectEmployee = (employeeId: string, checked: boolean) => {
    if (checked) {
      setSelectedEmployees([...selectedEmployees, employeeId]);
    } else {
      setSelectedEmployees(selectedEmployees.filter((id) => id !== employeeId));
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === "Не обновлено") {
      return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }

    const code = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
    const colorClass = getEmployeeStatusColor(code);

    return <Badge className={colorClass}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Список сотрудников</CardTitle>
          {selectedEmployees.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">
                Выбрано: {selectedEmployees.length}
              </span>
              <PermissionGate resource="employees" action="update">
                <Button variant="outline" size="sm">
                  Массовые действия
                </Button>
              </PermissionGate>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      selectedEmployees.length === employees.length &&
                      employees.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-16">№</TableHead>
                <TableHead>ФИО</TableHead>
                <TableHead>Должность</TableHead>
                <TableHead>Отдел</TableHead>
                <TableHead>Статус</TableHead>
                {/* Колонка «Контакты» удалена: телефон и почта приходили
                    захардкоженной пустой строкой — 97 px иконок поверх поля,
                    которое ручка штатки не отдаёт вовсе. */}
                <TableHead>Статус с</TableHead>

                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow
                  key={employee.id}
                  // Чередование фона: «Отдел» повторяет одно значение по
                  // шесть строк подряд, и на однородной заливке взгляд
                  // соскакивает на соседнюю строку.
                  className="cursor-pointer odd:bg-muted/40 hover:bg-muted"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                  <TableCell onClick={() => onSelectEmployee(employee)}>
                    <div>
                      <div className="font-medium">{employee.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {employee.manager}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{employee.position}</TableCell>
                  <TableCell className="text-sm">
                    {employee.department}
                  </TableCell>
                  {/* Клик по статусу открывает «Статусы сотрудника».
                      Без штатной единицы ключ модалки не собрать — такая
                      строка остаётся некликабельной, а не ведёт в ошибку. */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {employee.staffUnitId ? (
                      <button
                        type="button"
                        onClick={() => setStatusDialogFor(employee)}
                        title="Открыть статусы сотрудника"
                        className="rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:opacity-80"
                      >
                        {getStatusBadge(employee.status)}
                      </button>
                    ) : (
                      getStatusBadge(employee.status)
                    )}
                  </TableCell>
                  {/* Подпись «Дата найма» врала: сюда клали начало ТЕКУЩЕГО
                      статуса, а без него — сегодняшнее число, отчего у всех
                      строк стояла одна и та же дата. Иконка календаря убрана:
                      повторённая в каждой строке, она ничего не различает. */}
                  <TableCell className="text-sm tabular-nums">
                    {formatIsoDate(employee.statusSince)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          aria-label={`Действия: ${employee.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Действия</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => onSelectEmployee(employee)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Просмотр профиля
                        </DropdownMenuItem>
                        <PermissionGate resource="employees" action="update">
                          <DropdownMenuItem>
                            <Edit className="mr-2 h-4 w-4" />
                            Редактировать
                          </DropdownMenuItem>
                        </PermissionGate>
                        <DropdownMenuSeparator />
                        <PermissionGate resource="employees" action="delete">
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Удалить
                          </DropdownMenuItem>
                        </PermissionGate>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {employees.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Сотрудники не найдены</p>
          </div>
        )}
      </CardContent>

      <EditStatusDialog
        open={statusDialogFor !== null}
        onOpenChange={(open) => {
          if (!open) setStatusDialogFor(null);
        }}
        employeeId={
          statusDialogFor
            ? `${statusDialogFor.staffUnitId}-${statusDialogFor.id}`
            : null
        }
        employeeName={statusDialogFor?.name}
        currentStatus={statusDialogFor?.status}
        employeePosition={statusDialogFor?.position}
        employeeDepartment={statusDialogFor?.department}
        onSuccess={() => {
          setStatusDialogFor(null);
          void queryClient.invalidateQueries({
            queryKey: ["staff-units-by-directorate"],
          });
        }}
      />
    </Card>
  );
}
