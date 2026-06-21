"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, AlertTriangle, Clock, Save, X } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { apiClient } from "@/lib/api";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  SELECTABLE_STATUS_ITEMS,
  getEmployeeStatusLabel,
} from "@/lib/status";

interface EditStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
  employeeName?: string;
  currentStatus?: string;
  onSuccess?: () => void;
  initialStartDate?: Date; // Начальная дата для планирования
}

export function EditStatusDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  currentStatus,
  onSuccess,
  initialStartDate,
}: EditStatusDialogProps) {
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [comment, setComment] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Используем React Query для загрузки данных
  const { data } = useStaffUnitsByDirectorate();
  const staffUnits = data?.staff_units || [];

  // Находим текущий статус сотрудника при открытии диалога
  useEffect(() => {
    if (open && employeeId && staffUnits.length > 0) {
      // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
      const [unitIdStr, employeeIdStr] = employeeId.split("-");
      const unitId = parseInt(unitIdStr, 10);
      const employeeIdNum =
        employeeIdStr && !employeeIdStr.startsWith("vacant")
          ? parseInt(employeeIdStr, 10)
          : null;

      if (!employeeIdNum) return;

      const staffUnit = staffUnits.find((unit) => unit.id === unitId);
      if (!staffUnit) return;

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

      if (emp?.current_status) {
        const status = emp.current_status;
        setStatus(getEmployeeStatusLabel(status.status_type, ""));
        // Если передан initialStartDate (для планирования), используем его
        if (initialStartDate) {
          setStartDate(initialStartDate);
        } else if (status.start_date) {
          setStartDate(new Date(status.start_date));
        }
        if (status.end_date) {
          setEndDate(new Date(status.end_date));
        }
      } else if (initialStartDate) {
        // Если нет текущего статуса, но есть начальная дата для планирования
        setStartDate(initialStartDate);
      }
    }
  }, [open, employeeId, staffUnits, initialStartDate]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      setStatus("");
      setStartDate(undefined);
      setEndDate(undefined);
      setComment("");
      setValidationErrors([]);
    }
  }, [open]);

  const statusTypes = SELECTABLE_STATUS_ITEMS.map((item) => ({
    value: item.label,
    label: item.label,
    color: item.color,
  }));

  const validateForm = () => {
    const errors: string[] = [];

    if (!status) {
      errors.push("Выберите статус");
    }

    if (startDate && endDate && startDate > endDate) {
      errors.push("Дата начала не может быть позже даты окончания");
    }

    if (
      ["Отпуск", "Больничный", "Командировка"].includes(status) &&
      !startDate
    ) {
      errors.push("Для данного статуса обязательно указать дату начала");
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm() || !employeeId) {
      return;
    }

    setIsSubmitting(true);
    setValidationErrors([]);

    try {
      // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
      const [, employeeIdStr] = employeeId.split("-");
      const employeeIdNum =
        employeeIdStr && !employeeIdStr.startsWith("vacant")
          ? parseInt(employeeIdStr, 10)
          : null;

      if (!employeeIdNum) {
        setValidationErrors(["Сотрудник не найден"]);
        setIsSubmitting(false);
        return;
      }

      // Примечание: НЕ проверяем штатную единицу - прикомандированные сотрудники
      // могут не иметь штатную единицу в текущем подразделении, но им тоже можно назначать статус

      // Преобразуем статус в формат API
      const apiStatusType = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
      if (!apiStatusType) {
        setValidationErrors(["Неверный тип статуса"]);
        setIsSubmitting(false);
        return;
      }

      // Форматируем даты в формат YYYY-MM-DD
      const formatDate = (date: Date) => {
        return format(date, "yyyy-MM-dd");
      };

      // Определяем related_division:
      // - Для прикомандированных: используем текущее подразделение директората (куда прикомандирован)
      // - Для обычных сотрудников: используем подразделение директората (их текущее подразделение)
      // Приоритет: data.division.id (подразделение директората) > подразделение штатной единицы
      const relatedDivision = data?.division?.id || (() => {
        // Fallback: пытаемся найти через штатную единицу
        const [unitIdStr] = employeeId.split("-");
        const unitId = parseInt(unitIdStr, 10);
        const staffUnit = staffUnits.find((unit) => unit.id === unitId);
        return staffUnit?.division?.id;
      })();

      // Формируем запрос - используем правильный эндпоинт для создания статуса
      await apiClient.createEmployeeStatus({
        employee: employeeIdNum,
        status_type: apiStatusType,
        start_date: startDate ? formatDate(startDate) : undefined,
        end_date: endDate ? formatDate(endDate) : undefined,
        comment: comment || undefined,
        related_division: relatedDivision,
      });

      // Закрываем диалог
      onOpenChange(false);

      // Вызываем callback для обновления данных
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error updating status:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Произошла ошибка при обновлении статуса";
      setValidationErrors([errorMessage]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedStatusType = statusTypes.find((s) => s.value === status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] w-full">
        <DialogHeader>
          <DialogTitle>{"Запланировать статус сотрудника"}</DialogTitle>
          <DialogDescription>
            {employeeName
              ? `Сотрудник: ${employeeName}${
                  initialStartDate ? " (планирование на будущее)" : ""
                }`
              : initialStartDate
              ? "Запланируйте статус на будущую дату"
              : "Выберите новый статус для сотрудника"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Status Selection */}
          <div className="space-y-2">
            <Label htmlFor="status">Новый статус *</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите статус" />
              </SelectTrigger>
              <SelectContent>
                {statusTypes.map((statusType) => {
                  // Маппинг цветов для применения стилей (RGB значения из Tailwind)
                  const colorMap: Record<string, { bg: string; text: string }> =
                    {
                      "bg-green-100 text-green-800": {
                        bg: "#dcfce7",
                        text: "#166534",
                      },
                      "bg-yellow-100 text-yellow-800": {
                        bg: "#fef9c3",
                        text: "#713f12",
                      },
                      "bg-amber-100 text-amber-800": {
                        bg: "#fef3c7",
                        text: "#92400e",
                      },
                      "bg-red-100 text-red-800": {
                        bg: "#fee2e2",
                        text: "#991b1b",
                      },
                      "bg-purple-100 text-purple-800": {
                        bg: "#f3e8ff",
                        text: "#6b21a8",
                      },
                      "bg-indigo-100 text-indigo-800": {
                        bg: "#e0e7ff",
                        text: "#3730a3",
                      },
                      "bg-pink-100 text-pink-800": {
                        bg: "#fce7f3",
                        text: "#9d174d",
                      },
                      "bg-orange-100 text-orange-800": {
                        bg: "#ffedd5",
                        text: "#9a3412",
                      },
                      "bg-blue-100 text-blue-800": {
                        bg: "#dbeafe",
                        text: "#1e40af",
                      },
                      "bg-cyan-100 text-cyan-800": {
                        bg: "#cffafe",
                        text: "#164e63",
                      },
                      "bg-teal-100 text-teal-800": {
                        bg: "#ccfbf1",
                        text: "#115e59",
                      },
                      "bg-slate-100 text-slate-800": {
                        bg: "#f1f5f9",
                        text: "#1e293b",
                      },
                    };

                  const colors = colorMap[statusType.color] || {
                    bg: "#f3f4f6",
                    text: "#1f2937",
                  };

                  return (
                    <SelectItem
                      key={statusType.value}
                      value={statusType.value}
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                        // Переопределяем стили для hover и focus
                        ["--status-bg" as any]: colors.bg,
                        ["--status-text" as any]: colors.text,
                      }}
                      className="[&[data-highlighted]]:!bg-[var(--status-bg)] [&[data-highlighted]]:!text-[var(--status-text)] [&:focus]:!bg-[var(--status-bg)] [&:focus]:!text-[var(--status-text)] [&:hover]:!bg-[var(--status-bg)] [&:hover]:!text-[var(--status-text)]"
                    >
                      <div className="flex items-center w-full">
                        <span className="font-medium">{statusType.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Дата начала</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate
                      ? format(startDate, "dd MMMM yyyy", { locale: ru })
                      : "Выберите дату"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Дата окончания</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate
                      ? format(endDate, "dd MMMM yyyy", { locale: ru })
                      : "Выберите дату"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="comment">Комментарий</Label>
            <Textarea
              id="comment"
              placeholder="Дополнительная информация о изменении статуса..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? (
                <Clock className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {isSubmitting ? "Обновление..." : "Сохранить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
