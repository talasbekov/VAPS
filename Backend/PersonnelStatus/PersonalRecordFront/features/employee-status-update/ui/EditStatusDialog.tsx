"use client";

// Форма на react-hook-form + zod. Правила — в `model/edit-status-schema.ts`,
// разметка ошибки и фокус — в `shared/lib/form`; здесь остаётся то, что знает
// только эта модалка: засев с сервера, сборка запроса и наряд.
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { employeeIdOfKey, staffUnitOfEmployeeKey } from "../model/row-key";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { canManageStatusInDivision } from "@/entities/status/access";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { parseIsoDate } from "@/shared/lib/date";
import { opsExclusiveEndDate, statusServerDates, statusStartForSave, type StatusActionMode } from "../model/status-action-date";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  getEmployeeStatusColor,
} from "@/lib/status";
import { useStatusNaming } from "@/entities/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { invalidateDutyViews, useDutyAssignment } from "@/hooks/use-duty-assignments";
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { DutyAssignmentFields } from "./DutyAssignmentFields";
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";
import {
  EMPTY_PARTICIPATION_ROW,
  EventParticipationFields,
  participationsToPayload,
  validateParticipations,
  type ParticipationDraft,
} from "@/features/event-participation/ui/EventParticipationFields";
import { useParticipationCatalog } from "@/hooks/use-participation-catalog";
import { useDirectorateForcesRequests } from "@/hooks/use-forces-request-banner";
import { useCreateOpsStatus } from "@/hooks/use-ops-status-write";
import {
  EMPTY_DUTY_DRAFT,
  EMPTY_EDIT_STATUS_FORM,
  IN_SERVICE_LABEL,
  isInServiceStatus,
  usesDutyAssignment,
  editStatusFormSchema,
  type EditStatusFormInput,
} from "../model/edit-status-schema";

interface EditStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
  employeeName?: string;
  currentStatus?: string;
  onSuccess?: () => void;
  initialStartDate?: Date; // Дата выбранного дня на экранах расхода.
  mode?: StatusActionMode;
  /** Optional caller context retained for existing integrations. */
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
  mode = "change",
  employeePosition,
  employeeDepartment,
}: EditStatusDialogProps) {
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dutyPlacementReady, setDutyPlacementReady] = useState(false);
  const serverDateQuery = useQuery({
    queryKey: ["daily-expense-board", "default-business-date"],
    queryFn: () => apiClient.getTomorrowBlockState({}),
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const serverDates = useMemo(() => {
    if (!serverDateQuery.data) return null;
    try { return statusServerDates(serverDateQuery.data.business_date); }
    catch { return null; }
  }, [serverDateQuery.data]);
  // Подписи статусов — из справочника (Plane №366).
  const naming = useStatusNaming();
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, dirtyFields },
  } = useZodForm(editStatusFormSchema, EMPTY_EDIT_STATUS_FORM);

  // Используем React Query для загрузки данных
  // Штатная единица ОДНОГО сотрудника, и только когда диалог открыт
  // (Plane №234). Прежде здесь звался весь состав подразделения — 2,7 МБ ради
  // одной строки на пяти тысячах человек, и грузился он при открытии ЭКРАНА, а
  // не диалога.
  const wantedEmployeeId = employeeIdOfKey(employeeId);
  const employeeQuery = useStaffUnitsPage(
    { employeeIds: wantedEmployeeId === null ? [] : [wantedEmployeeId], pageSize: 1 },
    open && wantedEmployeeId !== null
  );
  const staffUnits = employeeQuery.data?.staff_units || [];

  const access = useOpsPermissions();
  const hasOpsPermission = access.hasPermission;
  const employeeDivision = staffUnitOfEmployeeKey(employeeId, staffUnits)?.division?.id;
  const canSaveStatus = !access.isLoading && !access.error && !employeeQuery.isError &&
    canManageStatusInDivision(access, employeeDivision);

  // Ветки формы зависят только от статуса: у «В строю» дат нет, у «На
  // дежурстве» появляется наряд.
  const status = watch("status");
  const statusCode = watch("statusCode");

  const isInService = isInServiceStatus(statusCode);
  const hasDutyAssignment = usesDutyAssignment(statusCode);
  const dutyQuery = useDutyAssignment(wantedEmployeeId, serverDates?.today ?? "", open && mode === "change" && hasDutyAssignment);
  const dutySeededForRef = useRef<string | null>(null);


  // Находим текущий статус сотрудника при открытии диалога.
  // Подстановка с сервера — ОДИН раз на открытие: дальше форму ведёт
  // пользователь. Данные штатки в зависимостях нужны потому, что диалог
  // открывается раньше их загрузки, но повторный прогон засева на фоновом
  // рефетче (invalidateQueries после чужого действия, кнопка «Обновить»)
  // затирал бы уже введённые статус и даты.
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && employeeId && staffUnits.length > 0 && serverDates &&
        !serverDateQuery.isFetching && !serverDateQuery.isError) {
      if (seededForRef.current === employeeId) return;

      // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
      const employeeIdNum = wantedEmployeeId;

      if (!employeeIdNum) return;

      const staffUnit = staffUnitOfEmployeeKey(employeeId, staffUnits);
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
        const current = emp.current_status;
        // Подпись действующего статуса — из справочника (Plane №366): окно
        // подставляет её в поле выбора, а выбор собран из того же каталога.
        // Пока подпись бралась из таблицы тринадцати кодов, окно, открытое у
        // человека с ОМ-статусом, показывало ПУСТОЕ поле — то есть предлагало
        // проставить статус тому, у кого он есть.
        setValue("status", naming.labelOf(current.status_type, ""));
        setValue("statusCode", current.status_type);
        setValue("location", current.location ?? "");
      }
      const start = initialStartDate ?? parseIsoDate(mode === "schedule" ? serverDates.tomorrow : serverDates.today)!;
      setValue("startDate", start);
      // A new plan does not inherit the current status's elapsed period.
      const end = mode === "change" && emp?.current_status?.end_date
        ? parseIsoDate(emp.current_status.end_date) : null;
      setValue("endDate", end && end >= start ? end : undefined);
    }
  }, [open, employeeId, wantedEmployeeId, staffUnits, initialStartDate, mode, serverDates,
    serverDateQuery.isFetching, serverDateQuery.isError, setValue]);

  // Wait for server defaults, then seed once. A late response or refetch must
  // never overwrite a placement the user has already edited.
  useEffect(() => {
    if (!open || mode !== "change" || !hasDutyAssignment || !employeeId || !serverDates || serverDateQuery.isFetching || !dutyQuery.allowed || !dutyQuery.isSuccess || dutyQuery.isFetching || dutySeededForRef.current === employeeId) return;
    dutySeededForRef.current = employeeId;
    if (dirtyFields.duty) return;
    const placement = dutyQuery.assignment?.placement;
    setValue(
      "duty",
      placement
        ? {
            dutyKind: placement.kind,
            objectId: placement.object_id,
            objectName: placement.object_name,
            postId: placement.post_id ?? "",
            postName: placement.post_name ?? "",
            groupId: placement.group_id ?? "",
            groupName: placement.group_name ?? "",
          }
        : EMPTY_DUTY_DRAFT
    );
  }, [open, mode, hasDutyAssignment, employeeId, serverDates, serverDateQuery.isFetching, dutyQuery.allowed, dutyQuery.isSuccess, dutyQuery.isFetching, dutyQuery.assignment, dirtyFields.duty, setValue]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
      dutySeededForRef.current = null;
      setDutyPlacementReady(false);
      reset(EMPTY_EDIT_STATUS_FORM);
    }
  }, [open, reset]);

  // 🔴 ЭТО И ЕСТЬ ОКНО ИЗ ЖАЛОБЫ ЗАКАЗЧИКА (Plane №354): «нажимаешь на статус,
  // открывается окошка… нажимаешь на Запланировать и выходит другая окошка для
  // планирования статуса. В этой окошке есть список статусов, они как будто
  // захардкодены на фронте». Список приходит с сервера — из справочника,
  // который заказчик и правит в админке.
  //
  // Перечень берётся ЦЕЛИКОМ (`selectableOnly = false`), включая
  // прикомандирование: модалка показывает статусы сотрудника, а не
  // подмножество, удобное форме, — это прежнее решение, и оно сохранено.
  //
  // Цвет — по КОДУ из палитры клиента: в справочнике поле `color` пустое у
  // всех строк, и красить по нему значило бы обесцветить список.
  const {
    types: catalogTypes,
    isLoading: statusTypesLoading,
    error: statusTypesError,
    isFetching: statusTypesFetching,
    retry: retryStatusTypes,
  } = useEmployeeStatusTypes(false);
  // 🔴 «ПРИВЛЕЧЁН НА МЕРОПРИЯТИЕ» В СПИСКЕ НЕ ПРЕДЛАГАЕТСЯ (Plane №486,
  // задача заказчика: «Убери статусы Привлечен на мероприятия(обе)»).
  //
  // Раньше здесь стояло обратное решение: тип оставляли видимым, а отправку
  // отбивал сервер словами, куда идти (№427). На деле это был выбор, который
  // не мог сработать НИКОГДА: человек выбирал «Привлечён на мероприятие
  // (наряд)», заполнял форму и получал отказ.
  //
  // Из СПРАВОЧНИКА типы не удаляются и удалены быть не могут: их ставит
  // система при назначении на мероприятие (`security_events`), по ним считает
  // колонки расход (`strength_report`) и разрезы сбора сил. Убран ровно ручной
  // выбор.
  //
  // СНИМАЮТСЯ ДВА КОДА, А НЕ ВЕСЬ НАБОР УЧАСТИЯ, и это осознанно. Общий
  // `EVENT_PARTICIPATION_STATUS_CODES` несёт третий код — `IN_EVENT`
  // («Участие в ОМ»), — а его заказчик убрать не просил («обе» сказано про
  // «Привлечён на мероприятие»). С №737 он не просто остаётся видимым, а
  // становится РАБОЧИМ выбором: начальник управления ставит им своего
  // сотрудника, назвав мероприятие из заявок на сбор сил (ветка ниже).
  // Два снятых кода погашены слиянием №486 и в справочнике неактивны —
  // фильтр здесь стережёт базы, пересеянные до миграции 0091.
  const MANUAL_HIDDEN_STATUS_CODES: ReadonlySet<string> = new Set([
    "EVENT_ASSIGNMENT",
    "EVENT_ASSIGNMENT_GROUP",
  ]);
  const statusTypes = catalogTypes
    .filter((item) => !MANUAL_HIDDEN_STATUS_CODES.has(item.code))
    .map((item) => ({
      value: item.code,
      label: item.label,
      color: item.color || getEmployeeStatusColor(item.code as never),
    }));
  const catalogReady = !statusTypesLoading && !statusTypesError && !statusTypesFetching && statusTypes.length > 0;
  // Обратный перевод «подпись → код» — из того же ответа: статический словарь
  // знает лишь тринадцать старых подписей и на заведённом в админке типе
  // вернул бы undefined, а форма отказала бы «Неверный тип статуса».
  const codeByLabel = new Map(catalogTypes.map((item) => [item.label, item.code]));
  // 🔴 ПРИВЛЕЧЕНИЕ НА ОМ — ВТОРАЯ ВЕТКА ОКНА (Plane №367, Ш-2 задачи №365).
  //
  // Заказчик: «Участие на ОМ должно быть как статус На дежурстве, должен
  // выбираться группы (какие-то группы с возможностью) и Физнаряд». Ветка
  // включается ПО КОДУ, а не по подписи: подписи правит заказчик в админке, а
  // код — то единственное, чем «привлечён на мероприятие» отличим от отпуска.
  //
  // Список кодов ОБЩИЙ на всю систему (`entities/daily-grid`): департаментский
  // разрез считает привлечённых по нему же, и своя копия здесь означала бы,
  // что человек, привлечённый группой, у одного экрана занят, а у другого
  // свободен — так уже было (№274, Ш-5).
  const selectedCode =
    statusCode || codeByLabel.get(status) || EMPLOYEE_STATUS_CODE_BY_LABEL[status] || "";
  const isOnDuty = hasDutyAssignment || catalogTypes.some(
    (item) => item.code === selectedCode && item.report_column_code === "ON_DUTY"
  );
  // 🔴 «УЧАСТИЕ В ОМ» СНОВА СТАВИТСЯ РУКАМИ (Plane №737, решение заказчика
  // 04.09.2026, отменившее запрет №427).
  //
  // Заказчик: «пользователь с доступом к редактированию модуля „Статусы
  // сотрудников“ должен иметь возможность давать своим сотрудникам статус
  // „На участие ОМ“; этим занимается начальник управления, а не ответственный
  // за сбор сил». До этой задачи окно при выборе типа показывало красный
  // отказ и запирало «Сохранить» — на него заказчик и указал.
  //
  // МЕРОПРИЯТИЕ ВЫБИРАЕТСЯ ИЗ ЗАЯВОК СВОЕГО УПРАВЛЕНИЯ, а не из реестра ОМ
  // (вариант 2 из трёх, выбран заказчиком). Реестр закрыт правом
  // `event.view`, которого у роли `HEAD_DIRECTORATE_LINE` нет: тот же список,
  // что показывает баннер запросов, — единственный, который этой роли ВИДЕН,
  // и он же служит проверкой на сервере (`requested_event_ids`).
  const isEventParticipation = EVENT_PARTICIPATION_STATUS_CODES.has(selectedCode);
  const [participations, setParticipations] = useState<ParticipationDraft[]>([]);
  // Каталог видов нужен окну и после отрисовки блока — по нему проверяется
  // черновик перед отправкой (запрос общий, из кэша).
  const participationCatalog = useParticipationCatalog(open && isEventParticipation);
  const forcesRequests = useDirectorateForcesRequests({
    enabled: open && isEventParticipation,
  });
  // Заявок на одно ОМ бывает несколько (департамент просит в два захода) —
  // в списке мероприятие обязано быть ОДНО: повтор строки читался бы как два
  // разных ОМ с одинаковым названием.
  const participationEvents = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const row of forcesRequests.data?.results ?? []) {
      if (seen.has(row.eventId)) continue;
      const day = row.businessDate
        ? format(new Date(row.businessDate), "dd.MM.yyyy")
        : "";
      seen.set(row.eventId, {
        id: row.eventId,
        label: [row.code, row.title, day].filter(Boolean).join(" · "),
      });
    }
    return [...seen.values()];
  }, [forcesRequests.data]);
  const createOpsStatus = useCreateOpsStatus();

  // Уход с ОМ-типа снимает выбранные мероприятия: держать их у отпуска значит
  // отправить на сервер заведомо бессмысленное тело. Приход на него, наоборот,
  // сразу открывает ПУСТУЮ СТРОКУ: вид участия обязателен, а конкретное
  // мероприятие для физнаряда может быть назначено позже штабом.
  useEffect(() => {
    setParticipations((rows) =>
      isEventParticipation
        ? rows.length === 0
          ? [{ ...EMPTY_PARTICIPATION_ROW }]
          : rows
        : []
    );
  }, [isEventParticipation]);

  const saveStatus = async (values: EditStatusFormInput) => {
    if (!employeeId) return;
    if (!canSaveStatus) {
      setError("root", { message: "Нет подтверждённого права изменять статус этого сотрудника. Черновик сохранён в форме." });
      return;
    }
    if (!catalogReady) {
      setError("root", { message: "Дождитесь загрузки типов статусов или повторите её. Черновик сохранён в форме." });
      return;
    }
    if (usesDutyAssignment(values.statusCode) && !hasOpsPermission("object.view")) {
      setError("root", { message: "Для назначения на объект нужен доступ к объектам." });
      return;
    }
    if (usesDutyAssignment(values.statusCode) && !dutyPlacementReady) {
      setError("root", { message: "Выберите объект и актуальный пост или группу." });
      return;
    }
    if (!serverDates || serverDateQuery.isError || serverDateQuery.isFetching) {
      setError("root", { message: "Дождитесь загрузки даты сервера." });
      return;
    }
    let startDateValue: string;
    try {
      startDateValue = statusStartForSave({ mode, today: serverDates.today,
        initialStartDate, chosenStartDate: values.startDate, inService: isInServiceStatus(values.statusCode) });
    } catch (error) {
      setError("startDate", { message: error instanceof Error ? error.message : "Укажите дату начала." });
      return;
    }

    // Парсим ID - формат: unitId-employeeId, unitId-vacant-index либо голый
    // employeeId (экраны свода, Plane №1233) — как в `employeeIdOfKey`.
    const idParts = employeeId.split("-");
    const employeeIdStr = idParts.length > 1 ? idParts[1] : idParts[0];
    const employeeIdNum =
      employeeIdStr && !employeeIdStr.startsWith("vacant")
        ? parseInt(employeeIdStr, 10)
        : null;

    if (!employeeIdNum) {
      setError("root", { message: "Сотрудник не найден" });
      return;
    }

    // Примечание: НЕ проверяем штатную единицу - прикомандированные сотрудники
    // могут не иметь штатную единицу в текущем подразделении, но им тоже можно назначать статус

    // Преобразуем статус в формат API
    const apiStatusType =
      values.statusCode || codeByLabel.get(values.status) ||
      EMPLOYEE_STATUS_CODE_BY_LABEL[values.status];
    if (!apiStatusType) {
      setError("root", { message: "Неверный тип статуса" });
      return;
    }

    // Формат YYYY-MM-DD по МЕСТНОЙ дате: toISOString() отдаёт UTC и в минусовых
    // зонах уводит дату на сутки назад.
    const formatDate = (date: Date) => format(date, "yyyy-MM-dd");

    // 🔴 ПРИВЛЕЧЕНИЕ НА ОМ ПИШЕТСЯ В МОДЕЛЬ РАСХОДА, А НЕ В КАДРОВУЮ
    // (Plane №367, решение заказчика 31.08.2026).
    //
    // Причина не в удобстве, а в том, что участию в кадровой модели негде
    // лежать: полей мероприятия, вида участия и роли у `statuses.EmployeeStatus`
    // нет вовсе, а `operations.OpsStatusParticipation` существует и по нему
    // считаются расход и сводки департамента. Записать «привлечён» рядом с
    // «На дежурстве» значило бы, что привлечения не видит НИКТО, кроме того,
    // кто его поставил.
    //
    if (isEventParticipation) {
      if (participations.length === 0) {
        // Без строки нельзя передать даже обязательный вид участия; пустое
        // мероприятие допустимо только внутри строки физнаря.
        setError("root", { message: "Выберите вид участия." });
        return;
      }
      const invalid = validateParticipations(
        participations,
        participationCatalog.data ?? []
      );
      if (invalid !== null) {
        setError("root", { message: invalid });
        return;
      }
      // Ручка расхода требует ОБЕ даты: у привлечения есть начало и конец —
      // мероприятие кончается, и бессрочного участия не бывает.
      if (!values.startDate || !values.endDate) {
        setError("root", {
          message: "У привлечения на мероприятие укажите начало и окончание.",
        });
        return;
      }
      try {
        await createOpsStatus.mutateAsync({
          employee_id: employeeIdNum,
          status_type_code: apiStatusType,
          date_start: startDateValue,
          // Both status forms show the last included day. The operations
          // API alone stores the following, exclusive calendar day.
          date_end: opsExclusiveEndDate(values.endDate),
          participations: participationsToPayload(participations),
        });
        // The server owns the status lifecycle and the object roster.
        void invalidateDutyViews(queryClient);
        onOpenChange(false);
        if (onSuccess) onSuccess();
      } catch (error) {
        setError("root", {
          message:
            error instanceof Error
              ? error.message
              : "Не удалось записать привлечение на мероприятие",
        });
      }
      return;
    }
    const valueIsInService = isInServiceStatus(values.statusCode);
    const valueHasDutyAssignment = usesDutyAssignment(values.statusCode);

    // Записываем фактическое подразделение штатной единицы. Корень области
    // чтения может быть департаментом и не описывает подразделение сотрудника.
    const relatedDivision = staffUnitOfEmployeeKey(employeeId, staffUnits)?.division?.id;

    try {
      await apiClient.createEmployeeStatus({
        employee: employeeIdNum,
        status_type: apiStatusType,
        start_date: startDateValue,
        end_date:
          valueIsInService || !values.endDate
            ? undefined
            : formatDate(values.endDate),
        comment: values.comment || undefined,
        location: valueHasDutyAssignment ? undefined : values.location ?? "",
        related_division: relatedDivision,
        duty_assignment: valueHasDutyAssignment ? {
          kind: values.duty.dutyKind as "POST" | "GROUP",
          object_id: values.duty.objectId,
          ...(values.duty.dutyKind === "POST" ? { post_id: values.duty.postId } : { group_id: values.duty.groupId }),
        } : undefined,
      });

      // Placement was saved atomically with the status, including future plans.
      void invalidateDutyViews(queryClient);

      // Закрываем диалог
      onOpenChange(false);

      // Вызываем callback для обновления данных
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error updating status:", error);
      // Ручка статусов отдаёт причину отказа текстом («период пересекается с
      // отпуском»), а не парами «поле: текст» — раскладывать по полям нечего.
      setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Произошла ошибка при обновлении статуса",
      });
    }
  };

  const submit = async (values: EditStatusFormInput) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try { await saveStatus(values); }
    finally { savingRef.current = false; setIsSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!savingRef.current) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[800px] w-full"
        onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (savingRef.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Статусы сотрудника</DialogTitle>
          <DialogDescription>
            {employeeName ? `Сотрудник: ${employeeName}` : "Выберите новый статус для сотрудника"}
          </DialogDescription>
        </DialogHeader>

        {mode === "schedule" ? (
          <p className="text-sm font-medium">Планирование на будущую дату</p>
        ) : initialStartDate ? (
          <p className="text-sm">Статус на выбранную дату: {format(initialStartDate, "yyyy-MM-dd")}.</p>
        ) : serverDates ? (
          <div className="text-sm space-y-1">
            <p>Изменение статуса на сегодня: {serverDates.today}.</p>
            <p className="text-muted-foreground">Дата сдачи дня не меняет дату начала статуса.</p>
          </div>
        ) : null}
        {!serverDates || serverDateQuery.isError ? (
          <Alert>
            <AlertDescription>
              {serverDateQuery.isError ? "Не удалось загрузить дату сервера." : "Загрузка даты сервера…"}
              {serverDateQuery.isError && <Button type="button" variant="outline" size="sm" onClick={() => void serverDateQuery.refetch()}>Повторить</Button>}
            </AlertDescription>
          </Alert>
        ) : null}

        {!canSaveStatus && <Alert><AlertDescription>
          <p>{access.isLoading || employeeQuery.isLoading
            ? "Проверяем права на изменение статуса сотрудника…"
            : "Нет подтверждённого права изменять статус этого сотрудника. Черновик сохранён в форме."}</p>
          {(access.error || employeeQuery.isError) && <Button type="button" variant="outline" onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["ops-me"] });
            void employeeQuery.refetch();
          }}>Повторить проверку прав</Button>}
        </AlertDescription></Alert>}
        <form
          onSubmit={(e) =>
            void handleSubmit(submit, (invalid) => focusFirstError(invalid))(e)
          }
          className="space-y-6"
          noValidate
        >
          <fieldset disabled={isSaving || !serverDates || serverDateQuery.isFetching || serverDateQuery.isError} className="space-y-6 min-w-0">
          {/* Status Selection */}
          <Field name="status" label="Новый статус" required error={errors.status}>
            {(field) => (
              <Controller
                control={control}
                name="status"
                render={({ field: input }) => (
                  <Select value={statusCode} onValueChange={(next) => {
                    // Radix's hidden native select can emit an empty change while
                    // asynchronous options are absent. No empty option is offered;
                    // keep the draft code until the user chooses an actual type.
                    if (!next) return;
                    input.onChange(naming.labelOf(next, ""));
                    setValue("statusCode", next);
                  }}>
                    <SelectTrigger
                      {...field}
                      className="w-full"
                      ref={input.ref}
                      onBlur={input.onBlur}
                    >
                      <SelectValue
                        placeholder={
                          statusTypesLoading
                            ? "Загружаем статусы…"
                            : "Выберите статус"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
                      {/* Пустой список читается как поломка: человек не
                          отличит «справочник пуст» от «не загрузилось».
                          Три состояния названы словами (Plane №354). */}
                      {statusTypes.length === 0 && (
                        <div
                          className="text-muted-foreground px-2 py-3 text-sm"
                          role={statusTypesError ? "alert" : undefined}
                        >
                          {statusTypesLoading
                            ? "Загружаем справочник статусов…"
                            : statusTypesError
                              ? "Справочник статусов не загрузился. Повторите загрузку ниже."
                              : "Справочник типов статусов пуст — заведите тип в разделе «Система → Справочники»."}
                        </div>
                      )}
                      {statusTypes.map((statusType) => (
                        <SelectItem key={statusType.value} value={statusType.value}>
                          {statusType.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>

          {statusTypesError && (
            <div className="space-y-2 text-sm">
              <p role="alert">Типы статусов не загрузились. Черновик сохранён.</p>
              <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={statusTypesFetching || isSaving} onClick={() => void retryStatusTypes()}>
                Повторить загрузку типов статусов
              </Button>
            </div>
          )}
          {statusTypesFetching && <p role="status" className="text-sm text-muted-foreground">Загружаем типы статусов…</p>}

          {/* Привлечение на ОМ: мероприятие из заявок СВОЕГО управления, вид
              участия (физнаряд либо группа) и роль в группе (Plane №737).
              Список мероприятий даёт окно — блок про право `event.view` не
              знает и знать не должен. */}
          {isEventParticipation && (
            <div data-testid="participation-fields">
              <EventParticipationFields
                rows={participations}
                onChange={setParticipations}
                enabled={open && isEventParticipation}
                hint="Мероприятия — те, по которым вашему управлению разослан запрос сил. Статус запишется в учёт раздела ОМ: там его видят расход и сводки департамента."
                events={participationEvents}
                eventsPending={forcesRequests.isPending}
                eventsError={forcesRequests.isError}
                eventsEmptyText="Запросов сил вашему управлению нет — привлекать не на что"
                eventsErrorText="Запросы на сбор сил не загрузились — обновите страницу."
              />
            </div>
          )}
          {/* Наряд: только у «На дежурстве» */}
          {["DUTY_COMBAT", "DUTY_DAILY", "DUTY_OPERATIONAL"].includes(statusCode ?? "") && (
            <p className="text-sm text-muted-foreground">
              Сотрудник появится в разделе «Боевое дежурство по Службе» на даты статуса.
              Сотрудник появится в «Расстановке дежурств» на даты статуса.
              Объект, пост или группу и смену назначает дежурный принимающего департамента.
            </p>
          )}
          {hasDutyAssignment && !hasOpsPermission("object.view") ? (
            <p role="alert" className="text-sm text-muted-foreground">Для назначения на объект нужен доступ к объектам.</p>
          ) : hasDutyAssignment && (
            <>
            <p className="text-sm text-muted-foreground">
              После сохранения сотрудник появится в карточке выбранного объекта,
              в разделе «Дежурные силы», на даты назначения. Пост или группу выбираете здесь.
            </p>
            {dutyQuery.isError && <div role="alert" className="text-sm">
              Не удалось загрузить текущее назначение.
              <Button type="button" size="sm" variant="outline" disabled={dutyQuery.isFetching} onClick={() => void dutyQuery.refetch()}>Повторить загрузку назначения</Button>
            </div>}
            <Controller
              control={control}
              name="duty"
              render={({ field: input }) => (
                <DutyAssignmentFields
                  value={input.value}
                  onChange={input.onChange}
                  onReadyChange={setDutyPlacementReady}
                  errors={errors.duty}
                />
              )}
            />
            </>
          )}

          {/* Период. У «В строю» дат нет — он бессрочный и стоит по умолчанию. */}
          {isInService && mode === "change" ? (
            <p className="text-sm text-muted-foreground">
              «{naming.labelOf(statusCode, status || IN_SERVICE_LABEL)}» — бессрочный статус, даты не указываются.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                name="startDate"
                label="Дата начала"
                required
                error={errors.startDate}
              >
                {(field) => (
                  <Controller
                    control={control}
                    name="startDate"
                    render={({ field: input }) => (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            {...field}
                            ref={input.ref}
                            onBlur={input.onBlur}
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {input.value
                              ? format(input.value, "dd MMMM yyyy", {
                                  locale: ru,
                                })
                              : "Выберите дату"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={input.value}
                            onSelect={input.onChange}
                            defaultMonth={input.value}
                            disabled={(date) => !serverDates || (mode === "schedule"
                              ? date < (parseIsoDate(serverDates.tomorrow) as Date)
                              : !initialStartDate && date > (parseIsoDate(serverDates.today) as Date))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  />
                )}
              </Field>

              {!isInService && <Field
                name="endDate"
                label="Дата окончания"
                required
                error={errors.endDate}
              >
                {(field) => (
                  <Controller
                    control={control}
                    name="endDate"
                    render={({ field: input }) => (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            {...field}
                            ref={input.ref}
                            onBlur={input.onBlur}
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {input.value
                              ? format(input.value, "dd MMMM yyyy", {
                                  locale: ru,
                                })
                              : "Выберите дату"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={input.value}
                            onSelect={input.onChange}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  />
                )}
              </Field>}
            </div>
          )}

          {!isInService && <p className="text-xs text-muted-foreground">Дата окончания включается в период статуса.</p>}

          {!isInService && !hasDutyAssignment && (
            <Field name="location" label={isOnDuty ? "Место дежурства" : "Место убытия"} error={errors.location}>
              {(field) => <Input {...field} {...register("location")} />}
            </Field>
          )}

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="comment">Комментарий</Label>
            <Textarea
              id="comment"
              placeholder="Дополнительная информация о изменении статуса..."
              rows={3}
              {...register("comment")}
            />
          </div>

          {/* Отказ сервера: к конкретному полю он не относится. */}
          {errors.root?.message !== undefined && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}
          </fieldset>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !canSaveStatus || !catalogReady || !serverDates || serverDateQuery.isError || serverDateQuery.isFetching || (hasDutyAssignment && (!hasOpsPermission("object.view") || !dutyPlacementReady))}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? (
                <Clock className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {isSaving ? "Обновление..." : "Сохранить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
