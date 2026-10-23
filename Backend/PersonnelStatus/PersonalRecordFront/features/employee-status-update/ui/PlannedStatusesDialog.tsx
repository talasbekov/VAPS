"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { EVENT_PARTICIPATION_STATUS_CODES, addDaysIso } from "@/entities/daily-grid";
import { employeeIdOfKey } from "../model/row-key";
import { StatusDocuments } from "./StatusDocuments";
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
  CheckCircle2,
  LockKeyhole,
} from "lucide-react";
import { useStatusNaming } from "@/entities/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { PERSONNEL_STATUS_SOURCE, apiClient, type OpsEmployeeStatusRow } from "@/lib/api";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { DutyPlacement } from "@/entities/duty-assignment";
import { DutyIntervalsFields } from "./DutyIntervalsFields";
import { dutyIntervalDrafts, dutyIntervalLabel, dutyIntervalsPayload, validateDutyIntervals, type DutyIntervalDraft } from "../model/duty-intervals";
import { usesDutyAssignment } from "../model/edit-status-schema";
import { calendarStatusFingerprint } from "../model/calendar-status-draft";
import { parseIsoDate } from "@/shared/lib/date";

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
  duty_assignment?: DutyPlacement | null;
}

interface PlannedStatusesResponse {
  current: EmployeeStatusDto | null;
  planned: EmployeeStatusDto[];
}

function DutyScheduleReadout({ placement }: { placement: DutyPlacement | null | undefined }) {
  if (placement?.intervals === undefined) return <p className="text-sm text-muted-foreground">Время выходов не указано. Период статуса не означает круглосуточное нахождение на посту.</p>;
  if (placement.intervals.length === 0) return <p className="text-sm text-muted-foreground">Выходов на дежурство нет.</p>;
  return <div className="text-sm"><p className="text-xs text-muted-foreground">Выходы · время Астаны</p><ul className="mt-1 space-y-1">{placement.intervals.map((interval, index) =>
    <li key={`${interval.start_at}:${interval.end_at}:${index}`}>{dutyIntervalLabel(interval)}</li>)}</ul></div>;
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
  // Подписи статусов — из справочника (Plane №366).
  const naming = useStatusNaming();
  const queryClient = useQueryClient();
  // Каталог типов — с сервера, а не копией в коде (Plane №354): заказчик
  // заводит тип в админке, и список обязан узнать о нём без выкатки клиента.
  const {
    types: catalogTypes,
    isLoading: statusTypesLoading,
    error: statusTypesError,
  } = useEmployeeStatusTypes();
  // 🔴 «УЧАСТИЕ В ОМ» ЗДЕСЬ НЕ ПРЕДЛАГАЕТСЯ (Plane №757, дозакрыто в №840).
  // Массовая простановка этот тип уже не показывает, а окно запланированных
  // показывало — и сохраняло его кадровой ручкой `PATCH /api/statuses/…`,
  // мимо всех правил раздела ОМ. То есть дефект «привлечён неизвестно куда»
  // открывался МЫШКОЙ из соседнего окна того же экрана.
  // Сервер теперь отбивает это сам (`statuses/participation_guard.py`), здесь
  // же — чтобы не предлагать того, что всё равно отобьётся: список,
  // обещающий невозможное, хуже короткого.
  const statusTypes = catalogTypes.filter(
    (item) => !EVENT_PARTICIPATION_STATUS_CODES.has(item.code)
  );
  // Справочник ОМ нужен не для второго раздела, а чтобы дать строкам обеих
  // моделей одну подпись и распознать точный дубль через legacy_code.
  const opsStatusTypes = useOpsStatusTypes(open);
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
  const [opsStatuses, setOpsStatuses] = useState<OpsEmployeeStatusRow[]>([]);
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    status_type: string;
    start_date: Date | undefined;
    end_date: Date | undefined;
    comment: string;
    dutyIntervals?: DutyIntervalDraft[];
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
  const savingRef = useRef(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

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

    setCurrentAction(null);
    setActionError(null);
    setRefreshRequired(false);
    setRefreshError(null);

    if (!employeeIdNum) {
      setError("Сотрудник не найден или вакантная должность");
      setStatuses(null);
      setOpsStatuses([]);
      return;
    }

    const fetchStatuses = async () => {
      try {
        setLoading(true);
        setError(null);
        const [employeeStatuses, sectionStatuses] = await Promise.all([
          apiClient.getEmployeePlannedStatuses(employeeIdNum),
          apiClient.getOpsStatusesFor(employeeIdNum),
        ]);
        setStatuses(employeeStatuses);
        setOpsStatuses(sectionStatuses);
        setEditingStatusId(null); // Сброс редактирования при обновлении
      } catch (e) {
        const message =
          e instanceof Error
            ? e.message
            : "Не удалось загрузить данные о статусах";
        setError(message);
        setStatuses(null);
        setOpsStatuses([]);
      } finally {
        setLoading(false);
      }
    };

    fetchStatuses();
  }, [open, employeeIdNum]);

  // Одна и та же будущая запись иногда существует в обеих таблицах во время
  // переходного периода. Совпадение считается дублем только при одинаковых
  // каноническом типе и границах периода; кадровая карточка остаётся, потому
  // что её можно править из этого окна. Самостоятельные строки ОМ сохраняются.
  const plannedOpsStatuses = useMemo(() => {
    const legacyCodeByOpsCode = new Map(
      opsStatusTypes.all.map((type) => [type.code, type.legacy_code])
    );
    const employeeKeys = new Set(
      (statuses?.planned ?? []).map(
        (status) =>
          `${status.status_type}|${status.start_date ?? ""}|${status.end_date ?? ""}`
      )
    );
    return opsStatuses.filter((row) => {
      if (row.state !== "PLANNED") return false;
      // Проекция кадрового статуса (Plane №1209) — та же карточка уже
      // показана выше из кадрового каталога, где её и правят; сравнение по
      // датам её не поймало бы (раздел хранит [start, end), кадровая дата
      // окончания включительная).
      if (row.source === PERSONNEL_STATUS_SOURCE) return false;
      const canonicalCode =
        legacyCodeByOpsCode.get(row.status_type_code) ?? row.status_type_code;
      return !employeeKeys.has(
        `${canonicalCode}|${row.date_start}|${row.date_end}`
      );
    });
  }, [opsStatusTypes.all, opsStatuses, statuses?.planned]);

  const handleEditClick = (status: EmployeeStatusDto) => {
    setEditingStatusId(status.id);
    setActionError(null);
    setCurrentAction(null);
    setEditForm({
      status_type: status.status_type,
      start_date: status.start_date ? parseIsoDate(status.start_date) ?? undefined : undefined,
      end_date: status.end_date ? parseIsoDate(status.end_date) ?? undefined : undefined,
      comment: status.comment || "",
      dutyIntervals: dutyIntervalDrafts(status.duty_assignment),
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
    const [employeeStatuses, sectionStatuses] = await Promise.all([
      apiClient.getEmployeePlannedStatuses(employeeIdNum),
      apiClient.getOpsStatusesFor(employeeIdNum),
    ]);
    setStatuses(employeeStatuses);
    setOpsStatuses(sectionStatuses);
  };

  const refreshAcceptedStatus = async () => {
    setRefreshError(null);
    try {
      await reloadStatuses();
      setRefreshRequired(false);
    } catch {
      setRefreshError("Изменение сохранено. Не удалось обновить список статусов. Повторите загрузку, чтобы продолжить.");
    }
  };

  const retryRead = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try { await refreshAcceptedStatus(); }
    finally { savingRef.current = false; setIsSaving(false); }
  };

  const mutateStatus = async (write: () => Promise<unknown>, failure: string) => {
    if (savingRef.current || refreshRequired) return;
    savingRef.current = true;
    setIsSaving(true);
    setActionError(null);
    try {
      await write();
      // Acknowledged writes must never become retryable because a read fails.
      setCurrentAction(null);
      setEditingStatusId(null);
      setEditForm(null);
      setRefreshRequired(true);
      for (const key of ["staff-units-by-directorate", "staff-units-page", "ops-statuses",
        "status-duty-assignments", "duty-register", "duty-dispatch", "service-combat-duty", "daily-expense-board", "strength-report", "service-summary"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      await refreshAcceptedStatus();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : failure);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const openCurrentAction = (action: "extend" | "terminate") => {
    if (action === "extend" && !canExtendCurrent) return;
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
        ? parseIsoDate(statuses.current.end_date) ?? undefined
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
    if (!statuses?.current || !canExtendCurrent) return;
    const statusId = statuses.current.id;
    // Молчаливый выход по пустой дате — тот же дефект, что чинит эта задача:
    // кнопка нажимается и не делает ничего. Календарь снимает выбор повторным
    // кликом по той же дате, так что пустое поле здесь достижимо.
    if (!extendDate) {
      setDateError("Укажите новую дату окончания.");
      return;
    }
    await mutateStatus(() => apiClient.extendEmployeeStatus(
      statusId,
      format(extendDate, "yyyy-MM-dd")
    ), "Не удалось продлить статус");
  };

  const handleTerminate = async () => {
    if (!statuses?.current) return;
    const statusId = statuses.current.id;
    if (!terminateDate) {
      setDateError("Укажите дату завершения.");
      return;
    }
    if (terminateReason.trim() === "") {
      setReasonError("Укажите причину досрочного завершения.");
      return;
    }
    setReasonError(null);
    setDateError(null);
    await mutateStatus(() => apiClient.terminateEmployeeStatus(
      statusId,
      format(terminateDate, "yyyy-MM-dd"),
      terminateReason.trim()
    ), "Не удалось завершить статус");
  };

  const handleSaveEdit = async (statusId: number) => {
    if (!editForm || !employeeIdNum) return;
    const original = statuses?.planned.find(row => row.id === statusId);
    const withPlacement = usesDutyAssignment(editForm.status_type);
    if (withPlacement) {
      if (editForm.dutyIntervals !== undefined && !original?.duty_assignment) { setActionError("Для выходов сначала укажите объект и пост или группу в полной форме статуса из календаря."); return; }
      const issues = validateDutyIntervals(editForm.dutyIntervals, editForm.start_date, editForm.end_date);
      if (issues.length) { setActionError(issues[0].message); return; }
    }

    const formatDateForApi = (date?: Date) => {
      return date ? format(date, "yyyy-MM-dd") : undefined;
    };

    await mutateStatus(async () => {
      if (withPlacement && original?.duty_assignment) {
        const latest = await apiClient.getEmployeePlannedStatuses(employeeIdNum);
        if (calendarStatusFingerprint(original) !== calendarStatusFingerprint(latest.planned.find((row: typeof original) => row.id === statusId))) {
          throw new Error("Запланированный статус уже изменён. Черновик сохранён; закройте форму и откройте статус снова после обновления.");
        }
      }
      await apiClient.updateEmployeeStatusById(statusId, {
      employee: employeeIdNum,
      status_type: editForm.status_type,
      start_date: formatDateForApi(editForm.start_date),
      end_date: formatDateForApi(editForm.end_date),
      comment: editForm.comment,
      ...(withPlacement && original?.duty_assignment ? { duty_assignment: {
        kind: original.duty_assignment.kind, object_id: original.duty_assignment.object_id,
        ...(original.duty_assignment.kind === "POST" ? { post_id: original.duty_assignment.post_id ?? undefined } : { group_id: original.duty_assignment.group_id ?? undefined }),
        ...dutyIntervalsPayload(editForm.dutyIntervals),
      } } : {}),
    }); }, "Не удалось обновить статус");
  };

  // Что вообще можно сделать с действующим статусом — решает модель, а не
  // экран. Продление сравнивает новую дату с текущей: у бессрочного статуса
  // («В строю») даты окончания нет, поэтому продлевать его нельзя. Досрочное
  // завершение заводит взамен «В строю»; завершать сам «В строю» нечем —
  // человек остался бы вовсе без статуса.
  const canExtendCurrent =
    statuses?.current?.state === "active" &&
    typeof statuses.current.end_date === "string" &&
    statuses.current.end_date.trim() !== "";
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
    const d = parseIsoDate(date);
    if (!d) return "Не указано";
    return d.toLocaleDateString("ru-RU");
  };

  // Подпись — из справочника (Plane №366). Прежде она искалась в таблице
  // тринадцати кадровых кодов, и запланированный «Участие в ОМ» в списке
  // плановых статусов читался как «Не обновлено» — то есть окно уверяло, что
  // статус не проставлен, показывая при этом его даты.
  const getStatusBadge = (statusType: EmployeeStatusDto["status_type"]) => (
    <Badge className={`${naming.colorOf(statusType)} whitespace-normal text-left`}>
      {naming.labelOf(statusType)}
    </Badge>
  );
  const isEventStatus = (status: OpsEmployeeStatusRow) =>
    EVENT_PARTICIPATION_STATUS_CODES.has(status.status_type_code) ||
    status.participations.length > 0;

  const showCurrentActionForm =
    currentAction !== null &&
    (currentAction !== "extend" || canExtendCurrent);
  const returnToServiceDate = terminateDate
    ? format(terminateDate, "dd.MM.yyyy")
    : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!savingRef.current) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5 sm:pr-12">
          <DialogTitle className="flex items-center gap-3 text-lg leading-6">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </span>
            Запланированные статусы сотрудника
          </DialogTitle>
          <DialogDescription>
            {employeeName
              ? `Сотрудник: ${employeeName}`
              : "Информация о текущем и запланированных статусах"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center px-4 py-8 text-muted-foreground">
            <Clock className="h-5 w-5 mr-2 animate-spin" />
            Загрузка данных о статусах...
          </div>
        )}

        {!loading && error && (
          <Alert variant="destructive" className="m-4 w-auto sm:mx-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {refreshError && <Alert className="m-4 w-auto sm:mx-6"><AlertDescription>
          <p>{refreshError}</p>
          <Button type="button" variant="outline" disabled={isSaving} onClick={() => void retryRead()}>Повторить загрузку статусов</Button>
        </AlertDescription></Alert>}
        {!loading && !error && statuses && (
          <fieldset disabled={isSaving || refreshRequired} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {/* Текущий статус */}
            <section aria-labelledby="current-status-heading" className="space-y-3">
              <h3 id="current-status-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                Текущий статус
              </h3>
              {statuses.current ? (
                <article aria-label="Текущий статус" className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/50 p-3 sm:p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {getStatusBadge(statuses.current.status_type)}
                      <Badge className={getStateBadgeColor(statuses.current.state)}>
                        {statuses.current.state_display}
                      </Badge>
                    </div>
                    {/* Активный статус допускает только продление и завершение. */}
                    {statuses.current.state === "active" && !showCurrentActionForm && (
                      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0">
                        {canExtendCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={() => openCurrentAction("extend")}
                          >
                            <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                            Продлить
                          </Button>
                        )}
                        {canTerminateCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={() => openCurrentAction("terminate")}
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            Завершить досрочно
                          </Button>
                        )}
                        {!canExtendCurrent && !canTerminateCurrent && (
                          <p className="max-w-sm text-xs text-muted-foreground">
                            Бессрочный статус: он снимается сам, когда
                            сотруднику заводят новый — кнопкой «Запланировать»
                            ниже.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 text-sm text-foreground sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Дата начала</div>
                      <div className="mt-1 font-medium">{formatDate(statuses.current.start_date)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Дата окончания</div>
                      <div className="mt-1 font-medium">{formatDate(statuses.current.end_date)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Фактическое окончание</div>
                      <div className="mt-1 font-medium">
                        {formatDate(statuses.current.effective_end_date)}
                      </div>
                    </div>
                  </div>
                  {statuses.current.comment && (
                    <div className="break-words text-sm text-muted-foreground">
                      <span className="font-medium">Комментарий: </span>
                      {statuses.current.comment}
                    </div>
                  )}
                  {usesDutyAssignment(statuses.current.status_type) && <DutyScheduleReadout placement={statuses.current.duty_assignment} />}

                  <StatusDocuments key={statuses.current.id} statusId={statuses.current.id} />

                  {statuses.current.state === "active" && showCurrentActionForm && (
                    <div className="space-y-3 rounded-lg border bg-background p-3 sm:p-4">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        {currentAction === "extend"
                          ? <CalendarIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          : <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
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
                                aria-required="true"
                                aria-invalid={dateError !== null}
                                aria-describedby={dateError ? "extend-date-error" : "extend-date-hint"}
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
                            <p id="extend-date-error" role="alert" className="text-destructive-ink text-sm">
                              {dateError}
                            </p>
                          ) : (
                            <p id="extend-date-hint" className="text-xs text-muted-foreground">
                              Должна быть позже текущей —{" "}
                              {formatDate(statuses.current.end_date)}.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="terminate-date">
                              Дата выхода в строй{" "}
                              <span className="text-destructive-ink">*</span>
                            </Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  id="terminate-date"
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal"
                                  aria-required="true"
                                  aria-invalid={dateError !== null}
                                  aria-describedby={dateError ? "terminate-date-hint terminate-date-error" : "terminate-date-hint"}
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
                            <p id="terminate-date-hint" className="text-xs leading-relaxed text-muted-foreground">
                              Выбранная дата — первый день статуса «В строю»
                              {returnToServiceDate ? `: ${returnToServiceDate}` : ""}.
                              {" "}Текущий статус будет завершён досрочно.
                              {" "}Даты учитываются по календарю сервера.
                            </p>
                            {dateError !== null && (
                              <p id="terminate-date-error" role="alert" className="text-destructive-ink text-sm">
                                {dateError}
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
                              required
                              className="min-h-20 resize-y"
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

                      <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t bg-background pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-w-0 flex-1 sm:flex-none"
                          onClick={closeCurrentAction}
                          disabled={isSaving}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                          Отмена
                        </Button>
                        <Button
                          size="sm"
                          className="min-w-0 flex-1 sm:flex-none"
                          onClick={
                            currentAction === "extend"
                              ? handleExtend
                              : handleTerminate
                          }
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Clock className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Save className="h-4 w-4" aria-hidden="true" />
                          )}
                          {currentAction === "extend"
                            ? "Продлить"
                            : "Завершить"}
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Текущий активный статус отсутствует.
                </div>
              )}
            </section>

            {/* Запланированные статусы */}
            <section aria-labelledby="planned-statuses-heading" className="space-y-3">
              {/* Кнопка стоит У СПИСКА, а не в шапке диалога: она пополняет
                  именно его, и при пустом списке это единственная подсказка,
                  чем его заполнить. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id="planned-statuses-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
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
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Запланировать
                  </Button>
                )}
              </div>
              {statuses.planned.length + plannedOpsStatuses.length > 0 ? (
                <div className="space-y-3">
                  {statuses.planned.map((status) => (
                    <article
                      key={`employee-${status.id}`}
                      aria-label={`Запланированный статус: ${naming.labelOf(status.status_type)}`}
                      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4"
                    >
                      {editingStatusId === status.id && editForm ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold">Редактирование запланированного статуса</h4>
                            <Badge className={getStateBadgeColor(status.state)}>{status.state_display}</Badge>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={`planned-status-${status.id}`}>Статус</Label>
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
                                  id={`planned-status-${status.id}`}
                                  aria-label="Статус"
                                  className="w-full"
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
                            <div className="sm:col-span-2">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`planned-start-${status.id}`}>Дата начала</Label>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        id={`planned-start-${status.id}`}
                                        variant="outline"
                                        className="w-full justify-start text-left font-normal"
                                      >
                                        <CalendarIcon className="h-4 w-4" aria-hidden="true" />
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
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`planned-end-${status.id}`}>Дата окончания</Label>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        id={`planned-end-${status.id}`}
                                        variant="outline"
                                        className="w-full justify-start text-left font-normal"
                                      >
                                        <CalendarIcon className="h-4 w-4" aria-hidden="true" />
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
                          </div>
                          {usesDutyAssignment(editForm.status_type) && <DutyIntervalsFields value={editForm.dutyIntervals}
                            onChange={dutyIntervals => setEditForm({ ...editForm, dutyIntervals })} />}
                          <div className="space-y-2">
                            <Label htmlFor={`planned-comment-${status.id}`}>Комментарий</Label>
                            <Textarea
                              id={`planned-comment-${status.id}`}
                              className="min-h-20 resize-y"
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
                          {actionError !== null && (
                            <Alert variant="destructive">
                              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                              <AlertDescription>{actionError}</AlertDescription>
                            </Alert>
                          )}
                          <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t bg-card pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-w-0 flex-1 sm:flex-none"
                              onClick={handleCancelEdit}
                              disabled={isSaving}
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                              Отмена
                            </Button>
                            <Button
                              size="sm"
                              className="min-w-0 flex-1 sm:flex-none"
                              onClick={() => handleSaveEdit(status.id)}
                              disabled={isSaving}
                            >
                              {isSaving ? (
                                <Clock className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Save className="h-4 w-4" aria-hidden="true" />
                              )}
                              Сохранить
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                                size="sm"
                                className="ml-auto"
                                onClick={() => handleEditClick(status)}
                                aria-label={`Изменить запланированный статус: ${status.state_display}`}
                              >
                                <Edit className="h-4 w-4" aria-hidden="true" />
                                Изменить
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-3 text-sm text-foreground sm:grid-cols-3">
                            <div>
                              <div className="text-xs text-muted-foreground">Дата начала</div>
                              <div className="mt-1 font-medium">{formatDate(status.start_date)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Дата окончания</div>
                              <div className="mt-1 font-medium">{formatDate(status.end_date)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">
                                Эффективная дата окончания
                              </div>
                              <div className="mt-1 font-medium">{formatDate(status.effective_end_date)}</div>
                            </div>
                          </div>
                          {usesDutyAssignment(status.status_type) && <DutyScheduleReadout placement={status.duty_assignment} />}
                          {status.comment && (
                            <div className="break-words text-sm text-muted-foreground">
                              <span className="font-medium">Комментарий: </span>
                              {status.comment}
                            </div>
                          )}
                        </>
                      )}
                      <StatusDocuments statusId={status.id} />
                    </article>
                  ))}
                  {plannedOpsStatuses.map((status) => (
                    <article
                      key={`operations-${status.id}`}
                      data-status-source="operations"
                      aria-label={`Запланированный статус ${isEventStatus(status) ? "ОМ" : "раздела"}: ${opsStatusTypes.labelOf(status.status_type_code)}`}
                      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge className={`${naming.colorOf(status.status_type_code)} whitespace-normal text-left`}>
                            {opsStatusTypes.labelOf(status.status_type_code)}
                          </Badge>
                          <Badge variant="outline">Запланирован</Badge>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Только просмотр
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-foreground">
                        <div>
                          <div className="text-xs text-muted-foreground">Дата начала</div>
                          <div className="mt-1 font-medium">{formatDate(status.date_start)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Дата окончания</div>
                          {/* Раздел хранит [start, end) — на экране день
                              окончания включительно, как у кадровых карточек
                              выше (`[ОМ-РШ-17]`, проходка №1142: участие на ОМ
                              05–06.10 печаталось «по 07.10»). */}
                          <div className="mt-1 font-medium">{formatDate(addDaysIso(status.date_end, -1))}</div>
                        </div>
                      </div>
                      {status.comment && (
                        <div className="break-words text-sm text-muted-foreground">
                          <span className="font-medium">Комментарий: </span>
                          {status.comment}
                        </div>
                      )}
                      {status.participations.length > 0 && (
                        <div className="break-words text-sm text-muted-foreground">
                          <span className="font-medium">Мероприятия: </span>
                          {status.participations
                            .map((participation) =>
                              participation.event_code === ""
                                ? `удалено из реестра (№${participation.event_id})`
                                : `${participation.event_code} · ${participation.event_title}`
                            )
                            .join("; ")}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {isEventStatus(status)
                          ? "Изменения выполняются в разделе ОМ."
                          : "Изменения выполняются в разделе назначения."}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Для сотрудника нет запланированных статусов.
                </div>
              )}
            </section>

          </fieldset>
        )}
      </DialogContent>
    </Dialog>
  );
}
