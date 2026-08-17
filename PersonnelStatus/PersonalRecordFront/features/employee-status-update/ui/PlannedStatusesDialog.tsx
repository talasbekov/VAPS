"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Calendar,
  Clock,
  AlertTriangle,
  Edit,
  Save,
  X,
  CalendarIcon,
} from "lucide-react";
import {
  EMPLOYEE_STATUS_ITEMS,
  SELECTABLE_STATUS_ITEMS,
  getEmployeeStatusColor,
  getEmployeeStatusLabel,
} from "@/lib/status";
import { apiClient } from "@/lib/api";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type EmployeeStatusState = "planned" | "active" | "completed" | "cancelled";

interface EmployeeStatusDto {
  id: number;
  status_type:
    | "in_service"
    | "vacation"
    | "leave_by_report"
    | "sick_leave"
    | "business_trip"
    | "training"
    | "competition"
    | "conference"
    | "other_absence"
    | "on_duty"
    | "after_duty"
    | "seconded_from"
    | "seconded_to";
  status_type_display: string;
  state: EmployeeStatusState;
  state_display: string;
  start_date: string | null;
  end_date: string | null;
  effective_end_date?: string | null;
  comment: string;
}

interface PlannedStatusesResponse {
  current: EmployeeStatusDto | null;
  planned: EmployeeStatusDto[];
}

interface PlannedStatusesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID штатной единицы (из таблицы) */
  employeeId: string | null;
  employeeName?: string;
}

export function PlannedStatusesDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
}: PlannedStatusesDialogProps) {
  const queryClient = useQueryClient();
  const { data } = useStaffUnitsByDirectorate();
  const staffUnits = data?.staff_units || [];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<PlannedStatusesResponse | null>(
    null
  );
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    status_type: string;
    start_date: Date | undefined;
    end_date: Date | undefined;
    comment: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const employeeIdNum = useMemo(() => {
    if (!employeeId) return null;
    // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
    const [unitIdStr, employeeIdStr] = employeeId.split("-");
    const unitId = parseInt(unitIdStr, 10);
    const employeeIdNum =
      employeeIdStr && !employeeIdStr.startsWith("vacant")
        ? parseInt(employeeIdStr, 10)
        : null;

    if (!employeeIdNum) return null;

    const staffUnit = staffUnits.find((unit) => unit.id === unitId);
    if (!staffUnit) return null;

    // Проверяем оба формата: новый (unit.employee) и старый (unit.employees)
    const unitEmployee = (staffUnit as any).employee;
    const employeesArray = (staffUnit as any).employees;

    let emp: any = null;

    if (unitEmployee && unitEmployee.id === employeeIdNum) {
      // Новый формат: один employee
      emp = unitEmployee;
    } else if (Array.isArray(employeesArray)) {
      // Старый формат: массив employees
      const empData = employeesArray.find(
        (e: any) => e.employee?.id === employeeIdNum
      );
      emp = empData?.employee;
    }

    if (!emp) return null;
    return emp.id;
  }, [employeeId, staffUnits]);

  useEffect(() => {
    if (!open) return;

    if (!employeeIdNum) {
      setError("Сотрудник не найден или вакантная должность");
      setStatuses(null);
      return;
    }

    const fetchStatuses = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiClient.getEmployeePlannedStatuses(
          employeeIdNum
        );
        setStatuses(response);
        setEditingStatusId(null); // Сброс редактирования при обновлении
      } catch (e) {
        const message =
          e instanceof Error
            ? e.message
            : "Не удалось загрузить данные о статусах";
        setError(message);
        setStatuses(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStatuses();
  }, [open, employeeIdNum]);

  const handleEditClick = (status: EmployeeStatusDto) => {
    setEditingStatusId(status.id);
    setEditForm({
      status_type: status.status_type,
      start_date: status.start_date ? new Date(status.start_date) : undefined,
      end_date: status.end_date ? new Date(status.end_date) : undefined,
      comment: status.comment || "",
    });
  };

  const handleCancelEdit = () => {
    setEditingStatusId(null);
    setEditForm(null);
  };

  const handleSaveEdit = async (statusId: number) => {
    if (!editForm || !employeeIdNum) return;

    try {
      setIsSaving(true);

      // Форматируем даты в YYYY-MM-DD
      const formatDateForApi = (date?: Date) => {
        return date ? format(date, "yyyy-MM-dd") : undefined;
      };

      await apiClient.updateEmployeeStatusById(statusId, {
        employee: employeeIdNum,
        status_type: editForm.status_type,
        start_date: formatDateForApi(editForm.start_date),
        end_date: formatDateForApi(editForm.end_date),
        comment: editForm.comment,
      });

      // Обновляем список в диалоге
      const response = await apiClient.getEmployeePlannedStatuses(
        employeeIdNum
      );
      setStatuses(response);
      setEditingStatusId(null);
      setEditForm(null);

      // Инвалидируем кэш для обновления таблицы сотрудников
      queryClient.invalidateQueries({
        queryKey: ["staff-units-by-directorate"],
      });
    } catch (e) {
      console.error("Failed to update status:", e);
      setError("Не удалось обновить статус");
    } finally {
      setIsSaving(false);
    }
  };

  const getStateBadgeColor = (state: EmployeeStatusState) => {
    switch (state) {
      case "planned":
        return "bg-blue-100 text-blue-800";
      case "active":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDate = (date: string | null | undefined) => {
    if (!date) return "Не указано";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "Не указано";
    return d.toLocaleDateString("ru-RU");
  };

  const getStatusBadge = (statusType: EmployeeStatusDto["status_type"]) => {
    const item = EMPLOYEE_STATUS_ITEMS.find((s) => s.code === statusType);
    const colorClass = item?.color ?? getEmployeeStatusColor(statusType);
    const label = getEmployeeStatusLabel(statusType);
    return <Badge className={colorClass}>{label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] w-full max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Запланированные статусы сотрудника</DialogTitle>
          <DialogDescription>
            {employeeName
              ? `Сотрудник: ${employeeName}`
              : "Информация о текущем и запланированных статусах"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Clock className="h-5 w-5 mr-2 animate-spin" />
            Загрузка данных о статусах...
          </div>
        )}

        {!loading && error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && statuses && (
          <div className="max-h-[60vh] pr-4 overflow-y-auto space-y-6">
            {/* Текущий статус */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-600" />
                Текущий статус
              </h3>
              {statuses.current ? (
                <div className="rounded-lg border bg-muted p-4 flex flex-col gap-2 relative group">
                  {editingStatusId === statuses.current.id && editForm ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Статус</Label>
                          <Select
                            value={editForm.status_type}
                            onValueChange={(value) =>
                              setEditForm({ ...editForm, status_type: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Выберите статус" />
                            </SelectTrigger>
                            <SelectContent>
                              {SELECTABLE_STATUS_ITEMS.map((item) => (
                                <SelectItem key={item.code} value={item.code}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Даты</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal"
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {editForm.start_date
                                    ? format(editForm.start_date, "dd.MM.yyyy")
                                    : "Начало"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0"
                                align="start"
                              >
                                <CalendarComponent
                                  mode="single"
                                  selected={editForm.start_date}
                                  onSelect={(date) =>
                                    setEditForm({
                                      ...editForm,
                                      start_date: date,
                                    })
                                  }
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal"
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {editForm.end_date
                                    ? format(editForm.end_date, "dd.MM.yyyy")
                                    : "Конец"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0"
                                align="start"
                              >
                                <CalendarComponent
                                  mode="single"
                                  selected={editForm.end_date}
                                  onSelect={(date) =>
                                    setEditForm({ ...editForm, end_date: date })
                                  }
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Комментарий</Label>
                        <Textarea
                          value={editForm.comment}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              comment: e.target.value,
                            })
                          }
                          rows={2}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                        >
                          <X className="h-4 w-4 mr-2" />
                          Отмена
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(statuses.current!.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Clock className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4 mr-2" />
                          )}
                          Сохранить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(statuses.current.status_type)}
                          <Badge
                            className={getStateBadgeColor(
                              statuses.current.state
                            )}
                          >
                            {statuses.current.state_display}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          // focus-visible рядом с group-hover: кнопка, видимая
                          // только по наведению, недостижима с клавиатуры —
                          // фокус на ней оставался невидимым.
                          className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => handleEditClick(statuses.current!)}
                          aria-label="Изменить текущий статус"
                        >
                          <Edit className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-foreground">
                        <div>
                          <div className="font-medium">Дата начала</div>
                          <div>{formatDate(statuses.current.start_date)}</div>
                        </div>
                        <div>
                          <div className="font-medium">Дата окончания</div>
                          <div>{formatDate(statuses.current.end_date)}</div>
                        </div>
                        <div>
                          <div className="font-medium">
                            Фактическое окончание
                          </div>
                          <div>
                            {formatDate(statuses.current.effective_end_date)}
                          </div>
                        </div>
                      </div>
                      {statuses.current.comment && (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Комментарий: </span>
                          {statuses.current.comment}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Текущий активный статус отсутствует.
                </div>
              )}
            </div>

            {/* Запланированные статусы */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                Запланированные статусы
              </h3>
              {statuses.planned.length > 0 ? (
                <div className="space-y-3">
                  {statuses.planned.map((status) => (
                    <div
                      key={status.id}
                      className="rounded-lg border p-4 flex flex-col gap-2 bg-card relative group"
                    >
                      {editingStatusId === status.id && editForm ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Статус</Label>
                              <Select
                                value={editForm.status_type}
                                onValueChange={(value) =>
                                  setEditForm({
                                    ...editForm,
                                    status_type: value,
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Выберите статус" />
                                </SelectTrigger>
                                <SelectContent>
                                  {SELECTABLE_STATUS_ITEMS.map((item) => (
                                    <SelectItem
                                      key={item.code}
                                      value={item.code}
                                    >
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Даты</Label>
                              <div className="grid grid-cols-2 gap-2">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className="w-full justify-start text-left font-normal"
                                    >
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {editForm.start_date
                                        ? format(
                                            editForm.start_date,
                                            "dd.MM.yyyy"
                                          )
                                        : "Начало"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="w-auto p-0"
                                    align="start"
                                  >
                                    <CalendarComponent
                                      mode="single"
                                      selected={editForm.start_date}
                                      onSelect={(date) =>
                                        setEditForm({
                                          ...editForm,
                                          start_date: date,
                                        })
                                      }
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className="w-full justify-start text-left font-normal"
                                    >
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {editForm.end_date
                                        ? format(
                                            editForm.end_date,
                                            "dd.MM.yyyy"
                                          )
                                        : "Конец"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="w-auto p-0"
                                    align="start"
                                  >
                                    <CalendarComponent
                                      mode="single"
                                      selected={editForm.end_date}
                                      onSelect={(date) =>
                                        setEditForm({
                                          ...editForm,
                                          end_date: date,
                                        })
                                      }
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Комментарий</Label>
                            <Textarea
                              value={editForm.comment}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  comment: e.target.value,
                                })
                              }
                              rows={2}
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelEdit}
                              disabled={isSaving}
                            >
                              <X className="h-4 w-4 mr-2" />
                              Отмена
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveEdit(status.id)}
                              disabled={isSaving}
                            >
                              {isSaving ? (
                                <Clock className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 mr-2" />
                              )}
                              Сохранить
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {getStatusBadge(status.status_type)}
                              <Badge
                                className={getStateBadgeColor(status.state)}
                              >
                                {status.state_display}
                              </Badge>
                            </div>
                            {status.state === "planned" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                onClick={() => handleEditClick(status)}
                                aria-label={`Изменить запланированный статус: ${status.state_display}`}
                              >
                                <Edit className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-foreground">
                            <div>
                              <div className="font-medium">Дата начала</div>
                              <div>{formatDate(status.start_date)}</div>
                            </div>
                            <div>
                              <div className="font-medium">Дата окончания</div>
                              <div>{formatDate(status.end_date)}</div>
                            </div>
                            <div>
                              <div className="font-medium">
                                Эффективная дата окончания
                              </div>
                              <div>{formatDate(status.effective_end_date)}</div>
                            </div>
                          </div>
                          {status.comment && (
                            <div className="text-sm text-muted-foreground">
                              <span className="font-medium">Комментарий: </span>
                              {status.comment}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Для сотрудника нет запланированных статусов.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
