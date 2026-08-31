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
import { apiClient } from "@/lib/api";
import { removeDutyAssignment } from "@/entities/duty-assignment";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { employeeIdOfKey } from "../model/row-key";
import {
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_LABELS,
  getEmployeeStatusColor,
  getEmployeeStatusPaint,
} from "@/lib/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { Field, focusFirstError, useZodForm } from "@/shared/lib/form";
import { toast } from "@/shared/hooks/use-toast";
import {
  EMPTY_MASS_STATUS_FORM,
  massStatusSchema,
  type MassStatusFormValues,
} from "../model/mass-status-schema";

interface MassStatusUpdateProps {
  selectedEmployees: string[];
  onSuccess?: () => void;
}

export function MassStatusUpdate({
  selectedEmployees,
  onSuccess,
}: MassStatusUpdateProps) {
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
  const { data } = useStaffUnitsPage(
    { employeeIds: selectedEmployeeIds, pageSize: 200 },
    selectedEmployeeIds.length > 0
  );
  const staffUnits = data?.staff_units || [];

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
  } = useEmployeeStatusTypes();
  const statusTypes = catalogTypes.map((item) => ({
    value: item.label,
    label: item.label,
    color: item.color || getEmployeeStatusColor(item.code as never),
  }));
  // Обратный перевод «подпись → код» строится ИЗ ТОГО ЖЕ ответа: статический
  // словарь знает только тринадцать старых подписей и на заведённом в админке
  // типе вернул бы undefined — форма отказала бы «Неверный тип статуса».
  const codeByLabel = new Map(catalogTypes.map((item) => [item.label, item.code]));

  const status = watch("status");
  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const comment = watch("comment");

  const submit = async (values: MassStatusFormValues) => {
    setFailures([]);
    // «В строю» — бессрочный статус по умолчанию, дат не требует. Берём от
    // ЗНАЧЕНИЙ сабмита, а не от подписки `watch`: сборка запроса читает только
    // `values`, и второй источник того же признака разошёлся бы.
    const submittedInService =
      values.status === EMPLOYEE_STATUS_LABELS.in_service;

    // Выбор сотрудников живёт в таблице снаружи формы — это не её поле, но без
    // него обновлять нечего. Поэтому проверка есть, а место ей — в сводке.
    if (selectedEmployees.length === 0) {
      setError("root", { message: "Выберите сотрудников для обновления" });
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

      // Преобразуем статус в формат API: сперва по справочнику сервера,
      // и только потом по старому словарю — он остаётся как запасной путь на
      // случай, если справочник не доехал (Plane №354).
      const apiStatusType =
        codeByLabel.get(values.status) ??
        EMPLOYEE_STATUS_CODE_BY_LABEL[values.status];
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
        ? formatDate(new Date())
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
      const applied = Number(response?.updated?.statuses ?? 0);
      // Сервер кладёт причины парами {поле: текст}. Показываем текст: JSON со
      // скобками и кавычками читателю ничего не объясняет.
      const serverFailures: string[] = Array.isArray(response?.errors)
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
        setFailures(
          serverFailures.length > 0
            ? serverFailures
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
      reset(EMPTY_MASS_STATUS_FORM);
      setFailures(serverFailures);

      // Вызываем callback для обновления данных
      if (onSuccess) {
        onSuccess();
      }

      // alert() блокирует вкладку и не читается скринридером как сообщение
      // приложения; тост в проекте уже есть и используется соседними экранами.
      toast(
        serverFailures.length > 0
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

              {/* Date Range */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  name="startDate"
                  label="Дата начала"
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
              </div>

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

              {/* Options */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Controller
                    control={control}
                    name="notifyManagers"
                    render={({ field: input }) => (
                      <Checkbox
                        id="notifyManagers"
                        ref={input.ref}
                        checked={input.value}
                        onBlur={input.onBlur}
                        onCheckedChange={(checked) =>
                          input.onChange(checked === true)
                        }
                      />
                    )}
                  />
                  <Label htmlFor="notifyManagers" className="text-sm">
                    Уведомить руководителей подразделений
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Controller
                    control={control}
                    name="scheduleUpdate"
                    render={({ field: input }) => (
                      <Checkbox
                        id="scheduleUpdate"
                        ref={input.ref}
                        checked={input.value}
                        onBlur={input.onBlur}
                        onCheckedChange={(checked) =>
                          input.onChange(checked === true)
                        }
                      />
                    )}
                  />
                  <Label htmlFor="scheduleUpdate" className="text-sm">
                    Запланировать автоматическое обновление
                  </Label>
                </div>
              </div>

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
