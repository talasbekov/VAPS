"use client";

// Форма на react-hook-form + zod. Правила — в `model/edit-status-schema.ts`,
// разметка ошибки и фокус — в `shared/lib/form`; здесь остаётся то, что знает
// только эта модалка: засев с сервера, сборка запроса и наряд.
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller } from "react-hook-form";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { employeeIdOfKey } from "../model/row-key";
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
  getEmployeeStatusColor,
  getEmployeeStatusPaint,
} from "@/lib/status";
import { useStatusNaming } from "@/entities/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import {
  removeDutyAssignment,
  upsertDutyAssignment,
} from "@/entities/duty-assignment";
import { useDutyAssignment } from "@/hooks/use-duty-assignments";
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { DutyAssignmentFields } from "./DutyAssignmentFields";
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";
import { useCreateOpsStatus } from "@/hooks/use-ops-status-write";
import {
  EMPTY_DUTY_DRAFT,
  EMPTY_EDIT_STATUS_FORM,
  IN_SERVICE_LABEL,
  ON_DUTY_LABEL,
  editStatusFormSchema,
  type EditStatusFormValues,
} from "../model/edit-status-schema";

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
    formState: { errors, isSubmitting },
  } = useZodForm(editStatusFormSchema, EMPTY_EDIT_STATUS_FORM);

  // Используем React Query для загрузки данных
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

  // Звания — только при открытом диалоге (Plane №329): таблица статусов
  // монтирует диалог рядом с собой, а не по клику, и справочник запрашивался
  // при открытии ЭКРАНА. У ролевых учёток раздела права `dictionary.view` нет,
  // и экран отдавал 403 в консоль ещё до первого клика. Тот же приём, что у
  // состава строкой выше (№234).
  const { data: ranks } = useRanks(open);
  const existingDuty = useDutyAssignment(employeeId);

  // Ветки формы зависят только от статуса: у «В строю» дат нет, у «На
  // дежурстве» появляется наряд.
  const status = watch("status");

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
        const current = emp.current_status;
        // Подпись действующего статуса — из справочника (Plane №366): окно
        // подставляет её в поле выбора, а выбор собран из того же каталога.
        // Пока подпись бралась из таблицы тринадцати кодов, окно, открытое у
        // человека с ОМ-статусом, показывало ПУСТОЕ поле — то есть предлагало
        // проставить статус тому, у кого он есть.
        setValue("status", naming.labelOf(current.status_type, ""));
        // Если передан initialStartDate (для планирования), используем его
        if (initialStartDate) {
          setValue("startDate", initialStartDate);
        } else if (current.start_date) {
          setValue("startDate", new Date(current.start_date));
        }
        if (current.end_date) {
          setValue("endDate", new Date(current.end_date));
        }
      } else if (initialStartDate) {
        // Если нет текущего статуса, но есть начальная дата для планирования
        setValue("startDate", initialStartDate);
      }
    }
  }, [open, employeeId, staffUnits, initialStartDate, setValue]);

  // Действующий наряд подставляется в форму при открытии: модалка правит
  // статус, а не заводит его заново — потерять при повторном входе объект и
  // пост значило бы показать пустую форму там, где наряд есть.
  useEffect(() => {
    if (!open) return;
    setValue(
      "duty",
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
  }, [open, employeeId, setValue]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
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
  // «Привлечён на мероприятие»). Он и должен остаться видимым: сервер отбивает
  // его ручной ввод СЛОВАМИ, куда идти (чекбоксы запроса на сбор сил на этом
  // же экране, №427/№487), и на этом отказе стоит проба
  // `status-portal-participation`. Убрав его из списка, я снял бы подсказку и
  // сломал бы стерегущую её пробу — ради задачи, которая про другие два типа.
  const MANUAL_HIDDEN_STATUS_CODES: ReadonlySet<string> = new Set([
    "EVENT_ASSIGNMENT",
    "EVENT_ASSIGNMENT_GROUP",
  ]);
  const statusTypes = catalogTypes
    .filter((item) => !MANUAL_HIDDEN_STATUS_CODES.has(item.code))
    .map((item) => ({
      value: item.label,
      label: item.label,
      color: item.color || getEmployeeStatusColor(item.code as never),
    }));
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
    codeByLabel.get(status) ?? EMPLOYEE_STATUS_CODE_BY_LABEL[status] ?? "";
  // «Участие в ОМ» вручную не ставится (Plane №427, `[СТА-04]`): статус
  // заводится только из запроса на сбор сил — чекбоксами на «Статусах
  // сотрудников» — и всегда с мероприятием и датами объекта.
  //
  // С №486 «Привлечён на мероприятие» из списка убран, но `IN_EVENT`
  // («Участие в ОМ») в нём остался — значит признак ниже по-прежнему может
  // стать истинным, и ветка «Привлечение на ОМ» (Plane №367) вместе с отказом
  // сервера продолжает работать ровно как раньше.
  const isEventParticipation = EVENT_PARTICIPATION_STATUS_CODES.has(selectedCode);
  const createOpsStatus = useCreateOpsStatus();

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

  const submit = async (values: EditStatusFormValues) => {
    if (!employeeId) return;

    // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
    const [, employeeIdStr] = employeeId.split("-");
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
      codeByLabel.get(values.status) ??
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
    // Повторять приём блока наряда (тот держит объект и пост в localStorage)
    // здесь нельзя по тому же правилу: заглушка на клиенте вместо серверного
    // факта — долг, а не выполнение.
    if (isEventParticipation) {
      setError("root", {
        message:
          "«Участие в ОМ» ставится только из запроса на сбор сил — отметьте сотрудника чекбоксом в баннере запроса на «Статусах сотрудников».",
      });
      return;
    }
    const valueIsInService = values.status === IN_SERVICE_LABEL;
    const valueIsOnDuty = values.status === ON_DUTY_LABEL;

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

    // У «В строю» дат в форме нет, но start_date на бэкенде обязателен:
    // бессрочный статус начинается сегодня и не кончается.
    const startDateValue = valueIsInService
      ? formatDate(new Date())
      : formatDate(values.startDate!);

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
        related_division: relatedDivision,
      });

      // Наряд — расшифровка статуса, поэтому пишется тем же действием.
      // ЛЮБОЙ статус, кроме «На дежурстве», наряд снимает: иначе сотрудник
      // остался бы в «Дежурных силах» объекта после ухода в отпуск.
      if (valueIsOnDuty) {
        upsertDutyAssignment({
          employeeKey: employeeId,
          employeeName: employeeName || "",
          rankName: employeeSnapshot.rankName,
          positionName: employeeSnapshot.positionName,
          departmentName: employeeSnapshot.departmentName,
          dutyKind: values.duty.dutyKind as "POST" | "GROUP",
          objectId: values.duty.objectId,
          objectName: values.duty.objectName,
          postId: values.duty.dutyKind === "POST" ? values.duty.postId : null,
          postName:
            values.duty.dutyKind === "POST" ? values.duty.postName : null,
          groupId: values.duty.dutyKind === "GROUP" ? values.duty.groupId : null,
          groupName:
            values.duty.dutyKind === "GROUP" ? values.duty.groupName : null,
          startDate: startDateValue,
          endDate: formatDate(values.endDate!),
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

        <form
          onSubmit={(e) =>
            void handleSubmit(submit, (invalid) => focusFirstError(invalid))(e)
          }
          className="space-y-6"
          noValidate
        >
          {/* Status Selection */}
          <Field name="status" label="Новый статус" required error={errors.status}>
            {(field) => (
              <Controller
                control={control}
                name="status"
                render={({ field: input }) => (
                  <Select value={input.value} onValueChange={input.onChange}>
                    <SelectTrigger
                      {...field}
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
                    <SelectContent>
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
                              ? "Справочник статусов не загрузился. Обновите страницу."
                              : "Справочник типов статусов пуст — заведите тип в разделе «Система → Справочники»."}
                        </div>
                      )}
                      {statusTypes.map((statusType) => {
                        // Цвет пункта — из общей палитры по КОДУ статуса. Здесь лежала копия
                        // таблицы «класс Tailwind → hex» на 28 литералов (вторая такая же —
                        // в соседнем диалоге): inline-стиль Radix-пункта классами не
                        // задать, но и знать про классы ему незачем.
                        const colors = getEmployeeStatusPaint(
                          statusType.value
                        ).hex;

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
                              <span className="font-medium">
                                {statusType.label}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>

          {/* «Участие в ОМ» ставится только из запроса (Plane №427,
              `[СТА-04]`): тип в списке остаётся (им подписан текущий статус
              привлечённых), но заводить его отсюда нельзя — причина видна
              сразу при выборе, кнопка сохранения заперта. */}
          {isEventParticipation && (
            <Alert variant="destructive" data-testid="participation-refusal">
              <AlertDescription>
                «Участие в ОМ» ставится только из запроса на сбор сил — отметьте
                сотрудника чекбоксом в баннере запроса на «Статусах сотрудников».
              </AlertDescription>
            </Alert>
          )}
          {/* Наряд: только у «На дежурстве» */}
          {isOnDuty && (
            <Controller
              control={control}
              name="duty"
              render={({ field: input }) => (
                <DutyAssignmentFields
                  value={input.value}
                  onChange={input.onChange}
                  errors={errors.duty}
                />
              )}
            />
          )}

          {/* Период. У «В строю» дат нет — он бессрочный и стоит по умолчанию. */}
          {isInService ? (
            <p className="text-sm text-muted-foreground">
              «{IN_SERVICE_LABEL}» — бессрочный статус, даты не указываются.
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
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  />
                )}
              </Field>

              <Field
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
              </Field>
            </div>
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
              disabled={isEventParticipation || isSubmitting}
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
