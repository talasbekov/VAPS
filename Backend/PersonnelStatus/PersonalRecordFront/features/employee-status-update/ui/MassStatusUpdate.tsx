"use client";

// Форма на react-hook-form + zod. Правила — в `model/mass-status-schema.ts`,
// разметка ошибки и фокус — в `shared/lib/form`; здесь остаётся только то, что
// относится к массовому обновлению: разбор выбранных строк, сборка запроса и
// чтение ответа ручки.
import { useState, useMemo} from "react";
import { Controller } from "react-hook-form";
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
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { apiClient } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateDutyViews } from "@/hooks/use-duty-assignments";
import { useStaffUnitsSelection } from "@/hooks/use-staff-units-page";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { canManageStatusSelection } from "@/entities/status/access";
import { employeeIdOfKey } from "../model/row-key";
import {
  getEmployeeStatusColor,
} from "@/lib/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { formatIsoDate } from "@/shared/lib/date";
import { statusServerDates } from "../model/status-action-date";
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { toast } from "@/shared/hooks/use-toast";
import { readMassStatusResult } from "../model/mass-status-result";
import {
  EMPTY_MASS_STATUS_FORM,
  massStatusSchema,
  type MassStatusFormValues,
} from "../model/mass-status-schema";

interface MassStatusUpdateProps {
  selectedEmployees: string[];
  onSuccess?: () => void;
  onRetainFailedSelection: (submitted: string[], remaining: string[]) => void;
}

export function MassStatusUpdate({
  selectedEmployees,
  onSuccess,
  onRetainFailedSelection,
}: MassStatusUpdateProps) {
  const queryClient = useQueryClient();
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useZodForm(massStatusSchema, EMPTY_MASS_STATUS_FORM);

  // Причины отказов от сервера при ЧАСТИЧНОМ успехе — это отчёт о результате,
  // а не ошибка валидации: форма прошла проверку, запрос ушёл, часть строк
  // сервер не принял. В `errors` таким строкам не место — `handleSubmit` на
  // каждом сабмите сносит `root`, а поля они не называют и чинить их в форме
  // нечем. Поэтому отдельное состояние, живущее до следующего сабмита.
  const [failures, setFailures] = useState<string[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [partialSummary, setPartialSummary] = useState<string | null>(null);

  // Штатные единицы ВЫБРАННЫХ сотрудников, а не весь состав подразделения
  // (Plane №234): диалог ищет в ответе ровно те строки, которые человек
  // отметил галочками, и на пяти тысячах сотрудников полный ответ означал
  // 2,7 МБ ради десятка.
  //
  // Ключи выбора приходят строкой `${staffUnitId}-${employeeId}` — сюда
  // уходят только идентификаторы людей; вакантные слоты (`vacant-…`) в
  // массовую правку не попадают.
  const selectedEmployeeIds = useMemo(
    () =>
      selectedEmployees
        .map(employeeIdOfKey)
        .filter((id): id is number => id !== null),
    [selectedEmployees]
  );
  const access = useOpsPermissions();
  const serverDateQuery = useQuery({
    queryKey: ["employee-status-update", "server-date"],
    queryFn: () => apiClient.getTomorrowBlockState({}),
    enabled: !access.isLoading && !access.error && access.hasPermission("status.manage"),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const serverDates = useMemo(() => {
    if (!serverDateQuery.data) return null;
    try { return statusServerDates(serverDateQuery.data.business_date); }
    catch { return null; }
  }, [serverDateQuery.data]);
  const dateReady = serverDates !== null && serverDateQuery.isSuccess && !serverDateQuery.isFetching && !serverDateQuery.isError;
  const dateFailed = serverDateQuery.isError || (serverDateQuery.isSuccess && serverDates === null);
  const dateMessage = dateFailed
    ? "Не удалось определить текущую дату. Повторите загрузку перед сохранением."
    : "Уточняем текущую дату…";
  const { data, isSuccess: selectionLoaded, isError: selectionFailed, isFetching: selectionFetching, refetch: reloadSelection } = useStaffUnitsSelection(
    selectedEmployeeIds, access.hasPermission("status.manage"),
  );
  const staffUnits = data || [];
  const selectionEditable = selectionLoaded && !selectionFetching && !selectionFailed && canManageStatusSelection(access, selectedEmployees, staffUnits);
  const selectionMessage = selectionFailed ? "Не удалось проверить выбранных сотрудников. Повторите загрузку перед изменением статусов." : !selectionLoaded || selectionFetching
    ? "Проверяем выбранных сотрудников…"
    : "Среди выбранных есть сотрудники, статусы которых вы не можете менять, или недоступные строки. Вернитесь в таблицу и оставьте только сотрудников своей области редактирования.";

  // 🔴 СПИСОК С СЕРВЕРА, А НЕ ИЗ КОПИИ В КОДЕ (Plane №354). Жалоба заказчика
  // дословно: «в админке добавил новый статус, там она не появилась» — это
  // окно и есть «окошка для планирования».
  //
  // Цвет берётся по КОДУ из палитры клиента: в справочнике поле `color` у всех
  // строк пустое, и красить по нему значило бы обесцветить весь список.
  // Незнакомый код получает нейтральный цвет — это честнее, чем подставить
  // зелёный «в строю» первому попавшемуся новому типу.
  const {
    types: catalogTypes,
    isLoading: statusTypesLoading,
    error: statusTypesError,
    isFetching: statusTypesFetching,
    retry: retryStatusTypes,
  } = useEmployeeStatusTypes();
  // 🔴 «УЧАСТИЕ В ОМ» В МАССОВОЙ ПРОСТАНОВКЕ НЕ ПРЕДЛАГАЕТСЯ (Plane №757).
  // Правила этого статуса живут в разделе ОМ: мероприятие обязательно и
  // обязано быть тем, о котором управление просили, а вид наряда пишется в
  // строку участия (№737/№663/№664). Это окно мероприятия не спрашивает
  // ВООБЩЕ и отправляет статус кадровой ручкой
  // (`staff-units/directorate/`) — мимо всех правил разом. Человек получал
  // «привлечён неизвестно куда»: расход считает его занятым, а департамент не
  // видит, куда он отдан.
  //
  // Сервер эту дверь теперь закрывает сам (`_refuse_participation_status`),
  // здесь же — чтобы не предлагать того, что всё равно отобьётся: список,
  // обещающий невозможное, хуже короткого. Ставится «Участие в ОМ» там, где
  // есть мероприятие, — чекбоксами запроса на «Статусах» и в окне одного
  // сотрудника.
  const statusTypes = catalogTypes
    .filter((item) => !EVENT_PARTICIPATION_STATUS_CODES.has(item.code))
    .map((item) => ({
      value: item.code,
      label: item.label,
      color: item.color || getEmployeeStatusColor(item.code as never),
    }));
  const status = watch("status");
  const catalogReady = !statusTypesLoading && !statusTypesError && !statusTypesFetching && statusTypes.length > 0;
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const comment = watch("comment");
  const inService = status === "in_service";
  const periodReady = inService || Boolean(startDate && endDate && startDate <= endDate);
  const periodReadiness = !status ? "Сначала выберите статус"
    : inService ? "Сегодня, без даты окончания"
    : !startDate && !endDate ? "Укажите даты начала и окончания"
    : !startDate ? "Укажите дату начала"
    : !endDate ? "Укажите дату окончания"
    : startDate > endDate ? "Дата окончания раньше даты начала"
    : "Период указан";

  const submit = async (values: MassStatusFormValues) => {
    if (unconfirmed) return;
    setFailures([]);
    setPartialSummary(null);
    // «В строю» — бессрочный статус по умолчанию, дат не требует. Берём от
    // ЗНАЧЕНИЙ сабмита, а не от подписки `watch`: сборка запроса читает только
    // `values`, и второй источник того же признака разошёлся бы.
    const submittedInService =
      values.status === "in_service";

    // Выбор сотрудников живёт в таблице снаружи формы — это не её поле, но без
    // него обновлять нечего. Поэтому проверка есть, а место ей — в сводке.
    if (selectedEmployees.length === 0) {
      setError("root", { message: "Выберите сотрудников для обновления" });
      return;
    }
    if (!selectionEditable) {
      setError("root", { message: selectionMessage });
      return;
    }
    if (!catalogReady) {
      setError("root", { message: "Дождитесь загрузки типов статусов или повторите её. Черновик сохранён в форме." });
      return;
    }
    if (!dateReady || !serverDates) {
      setError("root", { message: dateMessage });
      return;
    }

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
        setError("root", { message: "Не найдены сотрудники для обновления" });
        return;
      }

      // Подписи каталога могут совпадать или изменяться; в форме хранится код.
      const apiStatusType = catalogTypes.find(item => item.code === values.status)?.code;
      if (!apiStatusType) {
        setError("root", { message: "Неверный тип статуса" });
        return;
      }

      // Формат YYYY-MM-DD по МЕСТНОЙ дате. toISOString() отдаёт UTC и в
      // минусовых зонах уводит дату на сутки назад — вечерняя правка легла бы
      // вчерашним числом.
      const formatDate = (date: Date) => format(date, "yyyy-MM-dd");

      // У «В строю» дат в форме нет, но start_date на бэкенде обязателен:
      // бессрочный статус начинается сегодня и не кончается.
      const startDateValue = submittedInService
        ? serverDates.today
        : formatDate(values.startDate!);

      // Формируем массив статусов для отправки
      const employeeStatuses = employeesWithIds.map(({ employeeId }) => ({
        employee: employeeId,
        status_type: apiStatusType,
        start_date: startDateValue,
        end_date:
          submittedInService || !values.endDate
            ? undefined
            : formatDate(values.endDate),
        comment: values.comment || undefined,
      }));

      // Отправляем запрос на обновление
      const response = await apiClient.updateStaffUnitsByDirectorate({
        employee_statuses: employeeStatuses,
      });

      // Ручка отвечает 200 и на частичный, и на ПОЛНЫЙ отказ: причины лежат
      // в теле (success/errors). Раньше ответ не читался вовсе — форма
      // рапортовала об успехе там, где не обновился никто, и снимала наряды
      // на основании этого рапорта.
      const result = readMassStatusResult(response, employeesWithIds.map(item => item.employeeId));
      setFailures(result.messages);
      if (result.kind === "unconfirmed") {
        setUnconfirmed(true);
        // Invalidation respects current enabled/permission gates; do not replay.
        void queryClient.invalidateQueries({ queryKey: ["staff-units-page"] });
        void queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
        void invalidateDutyViews(queryClient);
        return;
      }
      if (result.kind === "rejected") return;
      const applied = result.applied!;
      if (result.kind === "partial") {
        const remaining = new Set(result.remainingEmployeeIds!);
        const failedKeys = selectedEmployees.filter(key => {
          const id = employeeIdOfKey(key);
          return id !== null && remaining.has(id);
        });
        if (failedKeys.length !== remaining.size) { setUnconfirmed(true); return; }
        onRetainFailedSelection([...selectedEmployees], failedKeys);
        setPartialSummary(`Обновлено ${applied} из ${employeesWithIds.length}. Черновик сохранён для не обновившихся сотрудников.`);
      } else {
        reset(EMPTY_MASS_STATUS_FORM);
      }

      // Re-read actual server results, including partial success.
      void invalidateDutyViews(queryClient);

      // Вызываем callback для обновления данных
      if (onSuccess) {
        onSuccess();
      }

      // alert() блокирует вкладку и не читается скринридером как сообщение
      // приложения; тост в проекте уже есть и используется соседними экранами.
      toast(
        result.kind === "partial"
          ? {
              title: "Статус обновлён частично",
              description: `Обновлено ${applied} из ${employeesWithIds.length}; часть строк не обновлена.`,
              variant: "destructive",
            }
          : {
              title: "Статус обновлён",
              description: `Обновлено сотрудников: ${applied}.`,
            }
      );
    } catch (error) {
      console.error("Error updating statuses:", error);
      // Ручка отдаёт отказ текстом (`Error`), а не полевым 400-ответом: класть
      // под поля нечего, всё идёт в сводку формы.
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Произошла ошибка при обновлении статусов";
      setError("root", { message: errorMessage });
      const status = (error as { status?: unknown } | null)?.status;
      if (typeof status !== "number" || ![400, 401, 403, 404, 405, 409, 422].includes(status)) {
        setUnconfirmed(true);
        void queryClient.invalidateQueries({ queryKey: ["staff-units-page"] });
        void queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] });
        void invalidateDutyViews(queryClient);
      }
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
            <form
              onSubmit={(e) =>
                void handleSubmit(submit, (invalid) => focusFirstError(invalid))(
                  e
                )
              }
              className="space-y-6"
              noValidate
            >
              {/* Status Selection */}
              <Field
                name="status"
                label="Новый статус"
                required
                error={errors.status}
              >
                {(field) => (
                  <Controller
                    control={control}
                    name="status"
                    render={({ field: input }) => (
                      <Select value={input.value} onValueChange={input.onChange}>
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
                          {/* Пустой список читается как поломка, поэтому три
                              состояния справочника названы словами (Plane
                              №354): едет, не доехал, пуст. */}
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

              {/* Date Range */}
              {statusTypesError && (
                <div className="space-y-2 text-sm">
                  <p role="alert">Типы статусов не загрузились. Черновик сохранён.</p>
                  <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={statusTypesFetching || isSubmitting} onClick={() => void retryStatusTypes()}>
                    Повторить загрузку типов статусов
                  </Button>
                </div>
              )}
              {statusTypesFetching && <p role="status" className="text-sm text-muted-foreground">Загружаем типы статусов…</p>}

              {status && !inService && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                              variant="outline"
                              className="w-full justify-start text-left font-normal bg-transparent"
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
                              variant="outline"
                              className="w-full justify-start text-left font-normal bg-transparent"
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
              </div>}
              {status && <p className="text-sm text-muted-foreground">
                {inService ? serverDates ? `Этот статус будет действовать с ${formatIsoDate(serverDates.today)} без даты окончания.` : "Уточняем дату начала бессрочного статуса…"
                  : "Период сохраняется по указанным датам. Будущие периоды сохраняются как запланированные."}
              </p>}

              {/* Comment */}
              <Field name="comment" label="Комментарий" error={errors.comment}>
                {(field) => (
                  <Textarea
                    {...field}
                    placeholder="Дополнительная информация о изменении статуса..."
                    rows={3}
                    {...register("comment")}
                  />
                )}
              </Field>

              {/* То, что не относится к конкретному полю: отказ сервера при
                  сохранении и причины непринятых строк. */}
              {(errors.root !== undefined || failures.length > 0) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {errors.root?.message !== undefined && (
                        <li>{errors.root.message}</li>
                      )}
                      {failures.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              {partialSummary && <p role="status" className="text-sm">{partialSummary}</p>}
              {unconfirmed && <p role="alert" className="text-sm text-destructive">Результат не подтверждён. Проверьте статусы выбранных сотрудников в таблице перед новым изменением.</p>}
              {!dateReady && (
                <div role={dateFailed ? "alert" : "status"} className="space-y-2 text-sm text-muted-foreground">
                  <p>{dateMessage}</p>
                  {dateFailed && <Button type="button" variant="outline" disabled={serverDateQuery.isFetching} onClick={() => void serverDateQuery.refetch()}>Повторить загрузку даты</Button>}
                </div>
              )}
              {selectedEmployees.length > 0 && !selectionEditable && (
                <div role="status" className="space-y-2 text-sm text-muted-foreground">
                  <p>{selectionMessage}</p>
                  {selectionFailed && <Button type="button" variant="outline" disabled={selectionFetching} onClick={() => void reloadSelection()}>Повторить проверку</Button>}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => { reset(EMPTY_MASS_STATUS_FORM); setFailures([]); setUnconfirmed(false); setPartialSummary(null); }}>
                  <X className="h-4 w-4 mr-2" />
                  Очистить форму
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || unconfirmed || !selectionEditable || !dateReady || !catalogReady}
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
                {inService ? (
                  serverDates ? `С ${formatIsoDate(serverDates.today)} · без даты окончания` : "Уточняем дату начала…"
                ) : startDate && endDate ? (
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
              <span className="text-sm">{dateReady ? "Текущая дата подтверждена" : dateFailed ? "Текущая дата недоступна" : "Проверяем текущую дату"}</span>
              {dateReady ? <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600" /> : <X aria-hidden="true" className="h-4 w-4 text-red-600" />}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{status ? "Статус выбран" : "Выберите статус"}</span>
              {status ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <X className="h-4 w-4 text-red-600" />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{selectionEditable ? "Сотрудники проверены" : selectedEmployees.length > 0 ? "Проверка сотрудников не завершена" : "Выберите сотрудников"}</span>
              {selectionEditable ? (
                <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600" />
              ) : (
                <X className="h-4 w-4 text-red-600" />
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{periodReadiness}</span>
              {periodReady ? (
                <CheckCircle aria-hidden="true" className="h-4 w-4 text-green-600" />
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
