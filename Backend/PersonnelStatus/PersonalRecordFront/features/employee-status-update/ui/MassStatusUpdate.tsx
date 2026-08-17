"use client";

import type React from "react";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CalendarIcon,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Save,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { apiClient } from "@/lib/api";
import { removeDutyAssignment } from "@/entities/duty-assignment";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_LABELS,
  SELECTABLE_STATUS_ITEMS,
} from "@/lib/status";

interface MassStatusUpdateProps {
  selectedEmployees: string[];
  onSuccess?: () => void;
}

export function MassStatusUpdate({
  selectedEmployees,
  onSuccess,
}: MassStatusUpdateProps) {
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [comment, setComment] = useState("");
  const [notifyManagers, setNotifyManagers] = useState<CheckedState>(true);
  const [scheduleUpdate, setScheduleUpdate] = useState<CheckedState>(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Используем React Query для загрузки данных
  const { data } = useStaffUnitsByDirectorate();
  const staffUnits = data?.staff_units || [];

  const statusTypes = SELECTABLE_STATUS_ITEMS.map((item) => ({
    value: item.label,
    label: item.label,
    color: item.color,
  }));

  /** «В строю» — бессрочный статус по умолчанию, дат не требует. */
  const isInService = status === EMPLOYEE_STATUS_LABELS.in_service;

  const validateForm = () => {
    const errors: string[] = [];

    if (!status) {
      errors.push("Выберите статус");
    }

    if (selectedEmployees.length === 0) {
      errors.push("Выберите сотрудников для обновления");
    }

    if (startDate && endDate && startDate > endDate) {
      errors.push("Дата начала не может быть позже даты окончания");
    }

    // Правило то же, что в одиночной модалке: «В строю» бессрочен и дат не
    // требует, у остальных период обязателен целиком. Прежний список был
    // перечислением трёх статусов из тринадцати — для «Учёбы» или «На
    // дежурстве» форма пропускала пустые даты, а статус без даты начала
    // невозможен, и обновление отклонялось уже на сервере.
    if (status && !isInService) {
      if (!startDate) errors.push("Укажите дату начала");
      if (!endDate) errors.push("Укажите дату окончания");
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setValidationErrors([]);

    try {
      // Парсим ID из выбранных сотрудников - формат: unitId-employeeId или unitId-vacant-index
      const employeesWithIds: { employeeId: number; staffUnitId: number }[] =
        [];

      selectedEmployees.forEach((selectedId) => {
        const [unitIdStr, employeeIdStr] = selectedId.split("-");
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

        if (emp) {
          employeesWithIds.push({
            employeeId: emp.id,
            staffUnitId: unitId,
          });
        }
      });

      if (employeesWithIds.length === 0) {
        setValidationErrors(["Не найдены сотрудники для обновления"]);
        setIsSubmitting(false);
        return;
      }

      // Преобразуем статус в формат API
      const apiStatusType = EMPLOYEE_STATUS_CODE_BY_LABEL[status];
      if (!apiStatusType) {
        setValidationErrors(["Неверный тип статуса"]);
        setIsSubmitting(false);
        return;
      }

      // Формат YYYY-MM-DD по МЕСТНОЙ дате. toISOString() отдаёт UTC и в
      // минусовых зонах уводит дату на сутки назад — вечерняя правка легла бы
      // вчерашним числом.
      const formatDate = (date: Date) => format(date, "yyyy-MM-dd");

      // У «В строю» дат в форме нет, но start_date на бэкенде обязателен:
      // бессрочный статус начинается сегодня и не кончается.
      const startDateValue = isInService
        ? formatDate(new Date())
        : formatDate(startDate!);

      // Формируем массив статусов для отправки
      const employeeStatuses = employeesWithIds.map(({ employeeId }) => ({
        employee: employeeId,
        status_type: apiStatusType,
        start_date: startDateValue,
        end_date: isInService || !endDate ? undefined : formatDate(endDate),
        comment: comment || undefined,
      }));

      // Отправляем запрос на обновление
      const response = await apiClient.updateStaffUnitsByDirectorate({
        employee_statuses: employeeStatuses,
      });

      // Ручка отвечает 200 и на частичный, и на ПОЛНЫЙ отказ: причины лежат
      // в теле (success/errors). Раньше ответ не читался вовсе — форма
      // рапортовала об успехе там, где не обновился никто, и снимала наряды
      // на основании этого рапорта.
      const applied = Number(response?.updated?.statuses ?? 0);
      // Сервер кладёт причины парами {поле: текст}. Показываем текст: JSON со
      // скобками и кавычками читателю ничего не объясняет.
      const failures: string[] = Array.isArray(response?.errors)
        ? response.errors.map((item: unknown) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
              const values = Object.values(item as Record<string, unknown>);
              if (values.length > 0) return values.map(String).join(" ");
            }
            return JSON.stringify(item);
          })
        : [];

      if (applied === 0) {
        setValidationErrors(
          failures.length > 0
            ? failures
            : ["Не удалось обновить ни одного сотрудника."]
        );
        return;
      }

      // Наряды снимаются ТОЛЬКО когда статус действительно записан: массовая
      // форма не спрашивает объект и пост, поэтому даже массовое «На
      // дежурстве» не может подтвердить прежний наряд — он говорил про другой
      // период и другое место. Но снимать наряд под несостоявшееся обновление
      // значит развести данные: человек остаётся на дежурстве, а из «Дежурных
      // сил» объекта пропадает.
      selectedEmployees.forEach((selectedId) =>
        removeDutyAssignment(selectedId)
      );

      // Reset form
      setStatus("");
      setStartDate(undefined);
      setEndDate(undefined);
      setComment("");
      setValidationErrors(failures);

      // Вызываем callback для обновления данных
      if (onSuccess) {
        onSuccess();
      }

      // Show success message (в реальном приложении лучше использовать toast)
      alert(
        failures.length > 0
          ? `Статус обновлён для ${applied} из ${employeesWithIds.length} сотрудников; часть не обновлена.`
          : `Статус успешно обновлен для ${applied} сотрудников`
      );
    } catch (error) {
      console.error("Error updating statuses:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Произошла ошибка при обновлении статусов";
      setValidationErrors([errorMessage]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedStatusType = statusTypes.find((s) => s.value === status);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Form */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Users className="h-5 w-5 mr-2" />
              Массовое обновление статусов
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      const colorMap: Record<
                        string,
                        { bg: string; text: string }
                      > = {
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
                            ["--status-bg" as any]: colors.bg,
                            ["--status-text" as any]: colors.text,
                          }}
                          className="[&[data-highlighted]]:!bg-[var(--status-bg)] [&[data-highlighted]]:!text-[var(--status-text)] [&:focus]:!bg-[var(--status-bg)] [&:focus]:!text-[var(--status-text)] [&:hover]:!bg-[var(--status-bg)] [&:hover]:!text-[var(--status-text)]"
                        >
                          <div className="flex items-center w-full">
                            <span className="font-medium">
                              {statusType.label}
                            </span>
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
                        className="w-full justify-start text-left font-normal bg-transparent"
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
                        className="w-full justify-start text-left font-normal bg-transparent"
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

              {/* Options */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="notify"
                    checked={notifyManagers}
                    onCheckedChange={setNotifyManagers}
                  />
                  <Label htmlFor="notify" className="text-sm">
                    Уведомить руководителей подразделений
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="schedule"
                    checked={scheduleUpdate}
                    onCheckedChange={setScheduleUpdate}
                  />
                  <Label htmlFor="schedule" className="text-sm">
                    Запланировать автоматическое обновление
                  </Label>
                </div>
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
                <Button type="button" variant="outline">
                  <X className="h-4 w-4 mr-2" />
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || selectedEmployees.length === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSubmitting ? (
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {isSubmitting ? "Обновление..." : "Применить изменения"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Preview */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Предварительный просмотр</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Выбранный статус:</Label>
              <div className="mt-1">
                {selectedStatusType ? (
                  <Badge className={selectedStatusType.color}>
                    {selectedStatusType.label}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Не выбран</span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Период действия:</Label>
              <div className="mt-1 text-sm">
                {startDate && endDate ? (
                  `${format(startDate, "dd.MM.yyyy")} - ${format(
                    endDate,
                    "dd.MM.yyyy"
                  )}`
                ) : startDate ? (
                  `С ${format(startDate, "dd.MM.yyyy")}`
                ) : (
                  <span className="text-muted-foreground">Не указан</span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">
                Количество сотрудников:
              </Label>
              <div className="mt-1">
                <Badge variant="outline">
                  {selectedEmployees.length} человек
                </Badge>
              </div>
            </div>

            {comment && (
              <div>
                <Label className="text-sm font-medium">Комментарий:</Label>
                <div className="mt-1 text-sm text-muted-foreground bg-muted p-2 rounded">
                  {comment}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-green-600" />
              Проверка готовности
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Статус выбран</span>
              {status ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <X className="h-4 w-4 text-red-600" />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Сотрудники выбраны</span>
              {selectedEmployees.length > 0 ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <X className="h-4 w-4 text-red-600" />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Даты корректны</span>
              {!startDate || !endDate || startDate <= endDate ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <X className="h-4 w-4 text-red-600" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
