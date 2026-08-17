"use client";

import type React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useStaffUnitsByDirectorate } from "@/hooks/use-staff-units-by-directorate";
import { useRanks } from "@/hooks/use-ranks";
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
  EMPLOYEE_STATUS_ITEMS,
  EMPLOYEE_STATUS_LABELS,
  getEmployeeStatusLabel,
  getEmployeeStatusPaint,
} from "@/lib/status";
import {
  removeDutyAssignment,
  upsertDutyAssignment,
} from "@/entities/duty-assignment";
import { useDutyAssignment } from "@/hooks/use-duty-assignments";
import {
  DutyAssignmentFields,
  EMPTY_DUTY_DRAFT,
  validateDutyDraft,
  type DutyDraft,
} from "./DutyAssignmentFields";

/** «В строю» — бессрочный статус по умолчанию, дат у него нет. */
const IN_SERVICE_LABEL = EMPLOYEE_STATUS_LABELS.in_service;
/** «На дежурстве» — единственный статус, который дополняется нарядом. */
const ON_DUTY_LABEL = EMPLOYEE_STATUS_LABELS.on_duty;

interface EditStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
  employeeName?: string;
  currentStatus?: string;
  onSuccess?: () => void;
  initialStartDate?: Date; // Начальная дата для планирования
  /** Снимок кадровых данных для наряда: карточка объекта показывает,
   * кем человек заступал, и в кадровый API за этим не ходит. */
  employeePosition?: string;
  employeeDepartment?: string;
}

export function EditStatusDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  currentStatus,
  onSuccess,
  initialStartDate,
  employeePosition,
  employeeDepartment,
}: EditStatusDialogProps) {
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [comment, setComment] = useState("");
  const [duty, setDuty] = useState<DutyDraft>(EMPTY_DUTY_DRAFT);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Используем React Query для загрузки данных
  const { data } = useStaffUnitsByDirectorate();
  const staffUnits = data?.staff_units || [];

  const { data: ranks } = useRanks();
  const existingDuty = useDutyAssignment(employeeId);

  const isInService = status === IN_SERVICE_LABEL;
  const isOnDuty = status === ON_DUTY_LABEL;

  // Находим текущий статус сотрудника при открытии диалога.
  // Подстановка с сервера — ОДИН раз на открытие: дальше форму ведёт
  // пользователь. Данные штатки в зависимостях нужны потому, что диалог
  // открывается раньше их загрузки, но повторный прогон засева на фоновом
  // рефетче (invalidateQueries после чужого действия, кнопка «Обновить»)
  // затирал бы уже введённые статус и даты.
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && employeeId && staffUnits.length > 0) {
      if (seededForRef.current === employeeId) return;

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

      // Штатка с этим сотрудником пришла — форма засеяна, второй раз
      // сервер её не перезапишет.
      seededForRef.current = employeeId;

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

  // Действующий наряд подставляется в форму при открытии: модалка правит
  // статус, а не заводит его заново — потерять при повторном входе объект и
  // пост значило бы показать пустую форму там, где наряд есть.
  useEffect(() => {
    if (!open) return;
    setDuty(
      existingDuty
        ? {
            dutyKind: existingDuty.dutyKind,
            objectId: existingDuty.objectId,
            objectName: existingDuty.objectName,
            postId: existingDuty.postId ?? "",
            postName: existingDuty.postName ?? "",
            groupId: existingDuty.groupId ?? "",
            groupName: existingDuty.groupName ?? "",
          }
        : EMPTY_DUTY_DRAFT
    );
    // existingDuty намеренно вне зависимостей: подстановка нужна на открытии,
    // дальше форму ведёт пользователь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
      setStatus("");
      setStartDate(undefined);
      setEndDate(undefined);
      setComment("");
      setDuty(EMPTY_DUTY_DRAFT);
      setValidationErrors([]);
    }
  }, [open]);

  // Перечень статусов берётся целиком — включая прикомандирование: модалка
  // показывает статусы сотрудника, а не подмножество, удобное форме.
  const statusTypes = EMPLOYEE_STATUS_ITEMS.map((item) => ({
    value: item.label,
    label: item.label,
    color: item.color,
  }));

  /** Кадровый снимок для наряда: звание из справочника, должность и
   * подразделение — от вызывающей таблицы, с запасным поиском по штатке. */
  const employeeSnapshot = useMemo(() => {
    const emp = findEmployeeInStaffUnits(staffUnits, employeeId);
    const rankName =
      ranks?.find((rank) => rank.id === emp?.employee?.rank)?.name ?? "";
    return {
      rankName,
      positionName: employeePosition || emp?.positionName || "",
      departmentName: employeeDepartment || emp?.divisionName || "",
    };
  }, [staffUnits, employeeId, ranks, employeePosition, employeeDepartment]);

  const validateForm = () => {
    const errors: string[] = [];

    if (!status) {
      errors.push("Выберите статус");
    }

    // «В строю» бессрочен — дат у него нет. У любого другого статуса период
    // обязателен целиком: статус без конца не отличим от забытого.
    if (status && !isInService) {
      if (!startDate) errors.push("Укажите дату начала");
      if (!endDate) errors.push("Укажите дату окончания");
    }

    if (startDate && endDate && startDate > endDate) {
      errors.push("Дата начала не может быть позже даты окончания");
    }

    if (isOnDuty) {
      errors.push(...validateDutyDraft(duty));
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
      // У «В строю» дат в форме нет, но start_date на бэкенде обязателен:
      // бессрочный статус начинается сегодня и не кончается.
      const startDateValue = isInService
        ? formatDate(new Date())
        : formatDate(startDate!);

      await apiClient.createEmployeeStatus({
        employee: employeeIdNum,
        status_type: apiStatusType,
        start_date: startDateValue,
        end_date: isInService || !endDate ? undefined : formatDate(endDate),
        comment: comment || undefined,
        related_division: relatedDivision,
      });

      // Наряд — расшифровка статуса, поэтому пишется тем же действием.
      // ЛЮБОЙ статус, кроме «На дежурстве», наряд снимает: иначе сотрудник
      // остался бы в «Дежурных силах» объекта после ухода в отпуск.
      if (isOnDuty) {
        upsertDutyAssignment({
          employeeKey: employeeId,
          employeeName: employeeName || "",
          rankName: employeeSnapshot.rankName,
          positionName: employeeSnapshot.positionName,
          departmentName: employeeSnapshot.departmentName,
          dutyKind: duty.dutyKind as "POST" | "GROUP",
          objectId: duty.objectId,
          objectName: duty.objectName,
          postId: duty.dutyKind === "POST" ? duty.postId : null,
          postName: duty.dutyKind === "POST" ? duty.postName : null,
          groupId: duty.dutyKind === "GROUP" ? duty.groupId : null,
          groupName: duty.dutyKind === "GROUP" ? duty.groupName : null,
          startDate: startDateValue,
          endDate: formatDate(endDate!),
          assignedAt: new Date().toISOString(),
        });
      } else {
        removeDutyAssignment(employeeId);
      }

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
          <DialogTitle>Статусы сотрудника</DialogTitle>
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
                  // Цвет пункта — из общей палитры по КОДУ статуса. Здесь лежала копия
                  // таблицы «класс Tailwind → hex» на 28 литералов (вторая такая же —
                  // в соседнем диалоге): inline-стиль Radix-пункта классами не
                  // задать, но и знать про классы ему незачем.
                  const colors = getEmployeeStatusPaint(statusType.value).hex;

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

          {/* Наряд: только у «На дежурстве» */}
          {isOnDuty && (
            <DutyAssignmentFields value={duty} onChange={setDuty} />
          )}

          {/* Период. У «В строю» дат нет — он бессрочный и стоит по умолчанию. */}
          {isInService ? (
            <p className="text-sm text-muted-foreground">
              «{IN_SERVICE_LABEL}» — бессрочный статус, даты не указываются.
            </p>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Дата начала *</Label>
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
              <Label>Дата окончания *</Label>
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
          )}

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

/**
 * Поиск сотрудника в штатке по ключу строки таблицы (`unitId-employeeId`).
 * Форматов ответа два (unit.employee и unit.employees[]) — модалка уже
 * разбирает оба выше, здесь та же логика для кадрового снимка наряда.
 */
function findEmployeeInStaffUnits(
  staffUnits: any[],
  employeeKey: string | null
): { employee: any; positionName: string; divisionName: string } | null {
  if (!employeeKey) return null;
  const [unitIdStr, employeeIdStr] = employeeKey.split("-");
  const unitId = parseInt(unitIdStr, 10);
  const employeeId =
    employeeIdStr && !employeeIdStr.startsWith("vacant")
      ? parseInt(employeeIdStr, 10)
      : null;
  if (!employeeId) return null;

  const unit = staffUnits.find((item) => item.id === unitId);
  if (!unit) return null;

  if (unit.employee && unit.employee.id === employeeId) {
    return {
      employee: unit.employee,
      positionName: unit.position?.name || "",
      divisionName: unit.division?.name || "",
    };
  }
  if (Array.isArray(unit.employees)) {
    const entry = unit.employees.find(
      (item: any) => item.employee?.id === employeeId
    );
    if (entry) {
      return {
        employee: entry.employee,
        positionName: entry.position?.name || "",
        divisionName: unit.division?.name || "",
      };
    }
  }
  return null;
}
