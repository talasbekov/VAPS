"use client";

// Форма на react-hook-form + zod. Правила — в `model/secondment-schema.ts`,
// разметка ошибки и фокус — в `shared/lib/form`; здесь остаётся только то, что
// относится к откомандированию: дерево подразделений и сборка запроса.
import { useEffect, useMemo } from "react";
import { Controller } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { CalendarIcon, AlertTriangle, Save, X, Building2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import { useDivisionsTree } from "@/hooks/use-divisions-tree";
import { useToast } from "@/shared/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ApiRequestError, readApiError } from "@/shared/lib/api-error";
import {
  Field,
  applyServerErrors,
  focusFirstError,
  focusFirstOf,
  useZodForm,
} from "@/shared/lib/form";
import {
  EMPTY_SECONDMENT_FORM,
  SECONDMENT_API_FIELDS,
  secondmentSchema,
  type SecondmentFormValues,
} from "../model/secondment-schema";

interface Division {
  id: number;
  name: string;
  code?: string;
  division_type?: string;
  parent?: number | null;
  is_active: boolean;
  order?: number;
  children?: Division[];
}

interface SecondEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
  employeeName?: string;
  onSuccess?: () => void;
}

export function SecondEmployeeDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  onSuccess,
}: SecondEmployeeDialogProps) {
  const { toast } = useToast();

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useZodForm(secondmentSchema, EMPTY_SECONDMENT_FORM);

  // Календарь окончания не должен предлагать дни раньше начала.
  const startDate = watch("startDate");

  // Загружаем дерево подразделений
  const {
    data: divisionsTree,
    isLoading: loadingDivisions,
    error: divisionsError,
  } = useDivisionsTree();

  // Преобразуем дерево подразделений в плоский список.
  //
  // Это НЕ `flattenDivisions` из `features/add-employee/lib/utils`: там ветка
  // неактивного подразделения отсекается целиком, а здесь спуск в детей
  // продолжается — откомандировать можно в активный отдел, висящий под
  // расформированным управлением.
  const divisions = useMemo(() => {
    if (!divisionsTree) {
      return [];
    }

    const flattenDivisions = (
      division: Division,
      prefix = ""
    ): Array<{
      id: number;
      name: string;
    }> => {
      const result: Array<{ id: number; name: string }> = [];

      // Пропускаем неактивные подразделения
      // Но если у неактивного подразделения есть активные дети, обрабатываем их
      if (!division.is_active) {
        // Если родитель неактивен, все равно обрабатываем детей (они могут быть активны)
        if (division.children && division.children.length > 0) {
          division.children.forEach((child) => {
            result.push(...flattenDivisions(child, prefix));
          });
        }
        return result;
      }

      const displayName = prefix
        ? `${prefix} → ${division.name}`
        : division.name;

      // Добавляем текущее подразделение
      result.push({
        id: division.id,
        name: displayName,
      });

      // Рекурсивно обрабатываем дочерние подразделения
      if (division.children && division.children.length > 0) {
        division.children.forEach((child) => {
          result.push(...flattenDivisions(child, displayName));
        });
      }

      return result;
    };

    return flattenDivisions(divisionsTree);
  }, [divisionsTree]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) reset(EMPTY_SECONDMENT_FORM);
  }, [open, reset]);

  const submit = async (values: SecondmentFormValues) => {
    if (!employeeId) return;

    try {
      // Парсим ID сотрудника - формат: unitId-employeeId
      const [, employeeIdStr] = employeeId.split("-");
      const employeeIdNum =
        employeeIdStr && !employeeIdStr.startsWith("vacant")
          ? parseInt(employeeIdStr, 10)
          : null;

      if (!employeeIdNum) {
        throw new Error("Неверный ID сотрудника");
      }

      // Форматируем даты в ISO формат
      const startDateISO = values.startDate
        ? format(values.startDate, "yyyy-MM-dd")
        : null;
      const endDateISO = values.endDate
        ? format(values.endDate, "yyyy-MM-dd")
        : null;

      if (!startDateISO || !endDateISO) {
        throw new Error("Необходимо указать даты начала и окончания");
      }

      // Отправляем запрос на откомандирование
      const endpoint = `/api/secondments/secondment-requests/`;
      const url = `${BACKEND_URL}${endpoint}`;

      const token = await getAccessToken();

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        accept: "application/json",
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          employee: employeeIdNum,
          to_division: parseInt(values.divisionId, 10),
          start_date: startDateISO,
          end_date: endDateISO,
          reason: values.comment.trim(),
        }),
      });

      // Тело отказа доезжает до формы КАК ЕСТЬ: раскладкой по полям занимается
      // `applyServerErrors` ниже — она одна знает, что `date_from` в ответе это
      // поле «Дата начала откомандирования».
      if (!response.ok) {
        throw await readApiError(response);
      }

      const data = await response.json();

      // Показываем уведомление об успехе
      toast({
        title: "Запрос создан",
        description: `Запрос на откомандирование сотрудника ${
          employeeName || "сотрудника"
        } успешно создан. Статус: ${
          data.status === "pending" ? "Ожидает одобрения" : data.status
        }`,
      });

      if (onSuccess) {
        onSuccess();
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Ошибка при откомандировании сотрудника:", error);
      // Полевой отказ ложится под свои поля, остальное — в сводку формы.
      const { fields, rest } =
        error instanceof ApiRequestError
          ? applyServerErrors<SecondmentFormValues>(
              setError,
              error.payload,
              SECONDMENT_API_FIELDS
            )
          : {
              fields: [],
              rest: [
                error instanceof Error
                  ? error.message
                  : "Произошла ошибка при откомандировании сотрудника",
              ],
            };
      if (rest.length > 0) {
        setError("root", { message: rest.join("; ") });
      }
      // Сервер мог отметить поле, которое сейчас за пределами видимой части.
      // Свежего `formState.errors` в этом замыкании ещё нет — идём по списку
      // полей, которые отметил сам сервер.
      focusFirstOf(fields);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Откомандировать сотрудника
          </DialogTitle>
          <DialogDescription>
            {employeeName && (
              <span className="font-medium text-foreground">
                Сотрудник: {employeeName}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) =>
            void handleSubmit(submit, (invalid) => focusFirstError(invalid))(e)
          }
          className="flex flex-col flex-1 min-h-0"
          noValidate
        >
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            {/* Дата начала откомандирования */}
            <Field
              name="startDate"
              label="Дата начала откомандирования"
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
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !input.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {input.value ? (
                            format(input.value, "PPP", { locale: ru })
                          ) : (
                            <span>Выберите дату начала</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={input.value}
                          onSelect={input.onChange}
                          initialFocus
                          locale={ru}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                />
              )}
            </Field>

            {/* Дата окончания откомандирования */}
            <Field
              name="endDate"
              label="Дата окончания откомандирования"
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
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !input.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {input.value ? (
                            format(input.value, "PPP", { locale: ru })
                          ) : (
                            <span>Выберите дату окончания</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={input.value}
                          onSelect={input.onChange}
                          initialFocus
                          disabled={(date) =>
                            startDate ? date < startDate : false
                          }
                          locale={ru}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                />
              )}
            </Field>

            {/* Выбор подразделения */}
            <Field
              name="divisionId"
              label="Подразделение для откомандирования"
              required
              error={errors.divisionId}
            >
              {(field) => (
                <Controller
                  control={control}
                  name="divisionId"
                  render={({ field: input }) => (
                    <Select
                      value={input.value}
                      onValueChange={input.onChange}
                      disabled={loadingDivisions}
                    >
                      <SelectTrigger
                        {...field}
                        ref={input.ref}
                        onBlur={input.onBlur}
                      >
                        <SelectValue placeholder="Выберите подразделение" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[400px] overflow-y-auto">
                        {loadingDivisions ? (
                          <SelectItem value="loading" disabled>
                            Загрузка подразделений...
                          </SelectItem>
                        ) : divisionsError ? (
                          <SelectItem value="error" disabled>
                            Ошибка загрузки подразделений
                          </SelectItem>
                        ) : divisions.length === 0 ? (
                          <SelectItem value="empty" disabled>
                            Нет доступных подразделений
                          </SelectItem>
                        ) : (
                          divisions.map((division) => (
                            <SelectItem
                              key={division.id}
                              value={division.id.toString()}
                              className="whitespace-normal"
                            >
                              {division.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </Field>

            {/* Комментарий */}
            <Field
              name="comment"
              label="Причина откомандирования"
              required
              error={errors.comment}
            >
              {(field) => (
                <Textarea
                  {...field}
                  placeholder="Дополнительная информация об откомандировании..."
                  rows={3}
                  {...register("comment")}
                />
              )}
            </Field>

            {/* То, что не относится к конкретному полю: отказ сервера при
                сохранении. */}
            {errors.root?.message !== undefined && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1">
                    <li>{errors.root.message}</li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Кнопки действий - фиксированные внизу */}
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t flex-shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              <X className="mr-2 h-4 w-4" />
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting ? "Отправка..." : "Откомандировать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
