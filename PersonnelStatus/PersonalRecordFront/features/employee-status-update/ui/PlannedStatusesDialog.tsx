"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { employeeIdOfKey } from "../model/row-key";
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
  Plus,
} from "lucide-react";
import {
  EMPLOYEE_STATUS_ITEMS,
  getEmployeeStatusColor,
  getEmployeeStatusLabel,
} from "@/lib/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
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
  /**
   * Завести новый статус. Форму открывает ВЫЗЫВАЮЩИЙ, а не этот диалог:
   * оба окна принадлежат таблице, и вложенный Radix-диалог поверх открытого
   * забирает фокус-ловушку себе — закрыв верхний, пользователь остаётся в
   * нижнем без фокуса. Кнопки нет вовсе, если обработчик не передан.
   */
  onSchedule?: () => void;
}

export function PlannedStatusesDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  onSchedule,
}: PlannedStatusesDialogProps) {
  const queryClient = useQueryClient();
  // Каталог типов — с сервера, а не копией в коде (Plane №354): заказчик
  // заводит тип в админке, и список обязан узнать о нём без выкатки клиента.
  const {
    types: statusTypes,
    isLoading: statusTypesLoading,
    error: statusTypesError,
  } = useEmployeeStatusTypes();
  // Штатная единица ОДНОГО сотрудника, и только когда диалог открыт
  // (Plane №234). Прежде здесь звался весь состав подразделения — 2,7 МБ ради
  // одной строки на пяти тысячах человек, и грузился он при открытии ЭКРАНА, а
  // не диалога.
  const wantedEmployeeId = employeeIdOfKey(employeeId);
  const { data } = useStaffUnitsPage(
    { employeeIds: wantedEmployeeId === null ? [] : [wantedEmployeeId], pageSize: 1 },
    open && wantedEmployeeId !== null
  );
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

  // Действие над ДЕЙСТВУЮЩИМ статусом. Правки у него нет вовсе: сервер
  // отказывает любому PATCH активного статуса, и карандаш над ним обещал то,
  // чего система не допускает (Plane №255). Допустимых операций две —
  // продление и досрочное завершение, и обе живут здесь.
  const [currentAction, setCurrentAction] = useState<
    "extend" | "terminate" | null
  >(null);
  const [extendDate, setExtendDate] = useState<Date | undefined>(undefined);
  const [terminateDate, setTerminateDate] = useState<Date | undefined>(
    undefined
  );
  const [terminateReason, setTerminateReason] = useState("");
  /** Отказ сервера по действию: печатается рядом с формой, а не в шапке. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** Пустая причина — ошибка ПОЛЯ, а не сводки: сервер её тоже требует. */
  const [reasonError, setReasonError] = useState<string | null>(null);
  /** Пустая дата — тоже ошибка поля: иначе кнопка молча ничего не делает. */
  const [dateError, setDateError] = useState<string | null>(null);

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
    setActionError(null);
    setCurrentAction(null);
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
    setActionError(null);
  };

  /** Перечитать статусы и освежить таблицу под диалогом. */
  const reloadStatuses = async () => {
    if (!employeeIdNum) return;
    setStatuses(await apiClient.getEmployeePlannedStatuses(employeeIdNum));
    // Обе семьи ключей: сводка шапки и страницы таблицы — разные запросы.
    queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
    queryClient.invalidateQueries({ queryKey: ["staff-units-page"] });
  };

  const openCurrentAction = (action: "extend" | "terminate") => {
    setCurrentAction(action);
    setEditingStatusId(null);
    setEditForm(null);
    setActionError(null);
    setReasonError(null);
    setDateError(null);
    setTerminateReason("");
    // Продление начинается от текущей даты окончания, завершение — от
    // сегодняшнего дня: это те значения, которые в подавляющем большинстве
    // случаев и нужны, а пустое поле заставляло бы искать их глазами.
    setExtendDate(
      statuses?.current?.end_date
        ? new Date(statuses.current.end_date)
        : undefined
    );
    setTerminateDate(new Date());
  };

  const closeCurrentAction = () => {
    setCurrentAction(null);
    setActionError(null);
    setReasonError(null);
    setDateError(null);
  };

  const handleExtend = async () => {
    if (!statuses?.current) return;
    // Молчаливый выход по пустой дате — тот же дефект, что чинит эта задача:
    // кнопка нажимается и не делает ничего. Календарь снимает выбор повторным
    // кликом по той же дате, так что пустое поле здесь достижимо.
    if (!extendDate) {
      setDateError("Укажите новую дату окончания.");
      return;
    }
    try {
      setIsSaving(true);
      setActionError(null);
      await apiClient.extendEmployeeStatus(
        statuses.current.id,
        format(extendDate, "yyyy-MM-dd")
      );
      await reloadStatuses();
      setCurrentAction(null);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Не удалось продлить статус"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTerminate = async () => {
    if (!statuses?.current) return;
    if (!terminateDate) {
      setDateError("Укажите дату завершения.");
      return;
    }
    if (terminateReason.trim() === "") {
      setReasonError("Укажите причину досрочного завершения.");
      return;
    }
    try {
      setIsSaving(true);
      setActionError(null);
      setReasonError(null);
      setDateError(null);
      await apiClient.terminateEmployeeStatus(
        statuses.current.id,
        format(terminateDate, "yyyy-MM-dd"),
        terminateReason.trim()
      );
      await reloadStatuses();
      setCurrentAction(null);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Не удалось завершить статус"
      );
    } finally {
      setIsSaving(false);
    }
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
      // Причина отказа приезжает с сервера текстом («Нельзя изменить статус,
      // дата начала которого уже наступила») — своё «не удалось» её прятало, и
      // окно выглядело сломанным вместо того, чтобы объяснить отказ.
      //
      // И печатается она РЯДОМ С ФОРМОЙ, а не в `error` шапки: `error` прячет
      // всё содержимое диалога, и неудачное сохранение уносило с экрана сам
      // список статусов вместе с формой, из которой пришло.
      setActionError(
        e instanceof Error ? e.message : "Не удалось обновить статус"
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Что вообще можно сделать с действующим статусом — решает модель, а не
  // экран. Продление сравнивает новую дату с текущей: у бессрочного статуса
  // («В строю») даты окончания нет, и сравнивать не с чем — сервер на таком
  // сравнении падает, поэтому кнопки у него быть не должно. Досрочное
  // завершение заводит взамен «В строю»; завершать сам «В строю» нечем —
  // человек остался бы вовсе без статуса.
  const canExtendCurrent =
    statuses?.current?.state === "active" &&
    statuses.current.end_date !== null;
  const canTerminateCurrent =
    statuses?.current?.state === "active" &&
    statuses.current.status_type !== "in_service";

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
                <div className="rounded-lg border bg-muted p-4 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(statuses.current.status_type)}
                    <Badge
                      className={getStateBadgeColor(statuses.current.state)}
                    >
                      {statuses.current.state_display}
                    </Badge>
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
                      <div className="font-medium">Фактическое окончание</div>
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

                  {/* Действия над ДЕЙСТВУЮЩИМ статусом.
                      Правки здесь нет и не будет: сервер отказывает любому
                      PATCH активного статуса, и карандаш обещал то, чего
                      система не допускает — окно не давало сохранить НИКОГДА
                      (Plane №255). Кнопки видимы всегда, а не по наведению:
                      это единственный способ тронуть текущий статус, и
                      прятать его под hover значило бы прятать всю операцию. */}
                  {statuses.current.state === "active" &&
                    (currentAction === null ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {canExtendCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCurrentAction("extend")}
                          >
                            <CalendarIcon
                              className="h-4 w-4 mr-2"
                              aria-hidden="true"
                            />
                            Продлить
                          </Button>
                        )}
                        {canTerminateCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCurrentAction("terminate")}
                          >
                            <X className="h-4 w-4 mr-2" aria-hidden="true" />
                            Завершить досрочно
                          </Button>
                        )}
                        {!canExtendCurrent && !canTerminateCurrent && (
                          <p className="text-xs text-muted-foreground">
                            Бессрочный статус: он снимается сам, когда
                            сотруднику заводят новый — кнопкой «Запланировать»
                            ниже.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-md border bg-background p-3">
                        <h4 className="text-sm font-semibold">
                          {currentAction === "extend"
                            ? "Продление статуса"
                            : "Досрочное завершение статуса"}
                        </h4>

                        {currentAction === "extend" ? (
                          <div className="space-y-2">
                            <Label htmlFor="extend-date">
                              Новая дата окончания{" "}
                              <span className="text-destructive-ink">*</span>
                            </Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  id="extend-date"
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal"
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {extendDate
                                    ? format(extendDate, "dd MMMM yyyy", {
                                        locale: ru,
                                      })
                                    : "Выберите дату"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0"
                                align="start"
                              >
                                <CalendarComponent
                                  mode="single"
                                  selected={extendDate}
                                  onSelect={(date) => {
                                    setExtendDate(date);
                                    if (date) setDateError(null);
                                  }}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            {dateError !== null ? (
                              <p role="alert" className="text-destructive-ink text-sm">
                                {dateError}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Должна быть позже текущей —{" "}
                                {formatDate(statuses.current.end_date)}.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="terminate-date">
                                Дата завершения{" "}
                                <span className="text-destructive-ink">*</span>
                              </Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    id="terminate-date"
                                    variant="outline"
                                    className="w-full justify-start text-left font-normal"
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {terminateDate
                                      ? format(terminateDate, "dd MMMM yyyy", {
                                          locale: ru,
                                        })
                                      : "Выберите дату"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-auto p-0"
                                  align="start"
                                >
                                  <CalendarComponent
                                    mode="single"
                                    selected={terminateDate}
                                    onSelect={(date) => {
                                      setTerminateDate(date);
                                      if (date) setDateError(null);
                                    }}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                              {dateError !== null ? (
                                <p role="alert" className="text-destructive-ink text-sm">
                                  {dateError}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  С этого дня сотрудник снова «В строю» — статус
                                  заводится автоматически.
                                </p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="terminate-reason">
                                Причина{" "}
                                <span className="text-destructive-ink">*</span>
                              </Label>
                              <Textarea
                                id="terminate-reason"
                                rows={2}
                                value={terminateReason}
                                aria-invalid={reasonError !== null}
                                aria-describedby={
                                  reasonError !== null
                                    ? "terminate-reason-error"
                                    : undefined
                                }
                                onChange={(e) => {
                                  setTerminateReason(e.target.value);
                                  if (reasonError !== null) setReasonError(null);
                                }}
                                placeholder="Почему статус завершается раньше срока"
                              />
                              {/* Ошибка У ПОЛЯ, а не сводкой наверху: сервер
                                  причину тоже требует, и без неё отказ
                                  приходил бы уже с сервера. */}
                              {reasonError !== null && (
                                <p
                                  id="terminate-reason-error"
                                  role="alert"
                                  className="text-destructive-ink text-sm"
                                >
                                  {reasonError}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {actionError !== null && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>{actionError}</AlertDescription>
                          </Alert>
                        )}

                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={closeCurrentAction}
                            disabled={isSaving}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Отмена
                          </Button>
                          <Button
                            size="sm"
                            onClick={
                              currentAction === "extend"
                                ? handleExtend
                                : handleTerminate
                            }
                            disabled={isSaving}
                          >
                            {isSaving ? (
                              <Clock className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4 mr-2" />
                            )}
                            {currentAction === "extend"
                              ? "Продлить"
                              : "Завершить"}
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Текущий активный статус отсутствует.
                </div>
              )}
            </div>

            {/* Запланированные статусы */}
            <div className="space-y-3">
              {/* Кнопка стоит У СПИСКА, а не в шапке диалога: она пополняет
                  именно его, и при пустом списке это единственная подсказка,
                  чем его заполнить. */}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  Запланированные статусы
                </h3>
                {onSchedule && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onSchedule}
                    aria-label={
                      employeeName
                        ? `Запланировать статус: ${employeeName}`
                        : "Запланировать статус"
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Запланировать
                  </Button>
                )}
              </div>
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
                                <SelectTrigger
                                  aria-label="Статус"
                                  // `aria-busy` — единственный признак, по
                                  // которому скринридер узнаёт, что список
                                  // ещё едет; глазу об этом говорит подпись.
                                  aria-busy={statusTypesLoading || undefined}
                                >
                                  <SelectValue
                                    placeholder={
                                      statusTypesLoading
                                        ? "Загружаем статусы…"
                                        : "Выберите статус"
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {/* Три состояния справочника названы словами
                                      (Plane №354). Пустой выпадающий список
                                      читается как поломка: человек не может
                                      отличить «справочник пуст» от «не
                                      загрузилось» и идёт спрашивать. */}
                                  {statusTypes.length === 0 ? (
                                    <div
                                      className="text-muted-foreground px-2 py-3 text-sm"
                                      role={statusTypesError ? "alert" : undefined}
                                    >
                                      {statusTypesLoading
                                        ? "Загружаем справочник статусов…"
                                        : statusTypesError
                                          ? "Справочник статусов не загрузился. Обновите страницу."
                                          : "Справочник типов статусов пуст — заведите тип в разделе «Система → Справочники»."}
                                    </div>
                                  ) : (
                                    statusTypes.map((item) => (
                                      <SelectItem
                                        key={item.code}
                                        value={item.code}
                                      >
                                        {item.label}
                                      </SelectItem>
                                    ))
                                  )}
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
