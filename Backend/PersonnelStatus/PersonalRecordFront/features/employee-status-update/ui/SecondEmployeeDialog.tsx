"use client";

import type React from "react";
import { useState, useEffect, useMemo } from "react";
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
  FieldError,
  fieldProps,
  focusFirstInvalid,
} from "@/shared/lib/field-errors";
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
import { apiClient, getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import { useDivisionsTree } from "@/hooks/use-divisions-tree";
import { useToast } from "@/shared/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [targetDivisionId, setTargetDivisionId] = useState<string>("");
  const [comment, setComment] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Загружаем дерево подразделений
  const {
    data: divisionsTree,
    isLoading: loadingDivisions,
    error: divisionsError,
  } = useDivisionsTree();

  // Преобразуем дерево подразделений в плоский список
  const divisions = useMemo(() => {
    if (!divisionsTree) {
      console.log("Divisions tree is not loaded yet");
      return [];
    }

    console.log("Divisions tree loaded:", divisionsTree);

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

    const flattened = flattenDivisions(divisionsTree);
    console.log("Flattened divisions:", flattened);
    console.log("Total divisions count:", flattened.length);
    return flattened;
  }, [divisionsTree]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      setStartDate(undefined);
      setEndDate(undefined);
      setTargetDivisionId("");
      setComment("");
      setValidationErrors([]);
    }
  }, [open]);

  /** Порядок полей на экране — по нему ведём фокус к первой ошибке. */
  const FIELD_ORDER = [
    "start-date",
    "end-date",
    "division",
    "comment",
  ] as const;

  /**
   * Имена полей API → поля формы. Без этой таблицы 400-ответ печатался
   * как есть — человек читал «date_from: ...» и не понимал, что чинить.
   */
  const API_FIELD_MAP: Record<string, string> = {
    start_date: "start-date",
    date_from: "start-date",
    end_date: "end-date",
    date_to: "end-date",
    to_division: "division",
    target_division: "division",
    reason: "comment",
  };

  const validateForm = (): boolean => {
    const errors: string[] = [];
    const byField: Record<string, string> = {};

    if (!startDate) {
      errors.push("Необходимо указать дату начала откомандирования");
      byField["start-date"] = "Укажите дату начала.";
    }

    if (!endDate) {
      errors.push("Необходимо указать дату окончания откомандирования");
      byField["end-date"] = "Укажите дату окончания.";
    }

    if (startDate && endDate && startDate > endDate) {
      errors.push("Дата начала не может быть позже даты окончания");
      byField["end-date"] = "Дата окончания раньше даты начала.";
    }

    if (!targetDivisionId) {
      errors.push("Необходимо выбрать подразделение для откомандирования");
      byField.division = "Выберите подразделение.";
    }

    if (!comment || comment.trim() === "") {
      errors.push("Необходимо указать причину откомандирования");
      byField.comment = "Укажите причину откомандирования.";
    }

    setValidationErrors(errors);
    setFieldErrors(byField);
    if (errors.length > 0) focusFirstInvalid(FIELD_ORDER, byField);
    return errors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm() || !employeeId) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Парсим ID сотрудника - формат: unitId-employeeId
      const [unitIdStr, employeeIdStr] = employeeId.split("-");
      const employeeIdNum =
        employeeIdStr && !employeeIdStr.startsWith("vacant")
          ? parseInt(employeeIdStr, 10)
          : null;

      if (!employeeIdNum) {
        throw new Error("Неверный ID сотрудника");
      }

      // Форматируем даты в ISO формат
      const startDateISO = startDate ? format(startDate, "yyyy-MM-dd") : null;
      const endDateISO = endDate ? format(endDate, "yyyy-MM-dd") : null;

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

      const requestBody = {
        employee: employeeIdNum,
        to_division: parseInt(targetDivisionId, 10),
        start_date: startDateISO,
        end_date: endDateISO,
        reason: comment.trim(),
      };

      console.log("Отправка запроса на откомандирование:", {
        url,
        body: requestBody,
      });

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = `Ошибка ${response.status}`;
        const errors: string[] = [];

        try {
          const errorData = await response.json();
          console.error("Ошибка от API:", errorData);

          // Обрабатываем различные форматы ошибок от API
          if (errorData.detail) {
            errorMessage = errorData.detail;
            errors.push(errorData.detail);
          } else if (errorData.message) {
            errorMessage = errorData.message;
            errors.push(errorData.message);
          } else if (typeof errorData === "string") {
            errorMessage = errorData;
            errors.push(errorData);
          } else if (errorData.non_field_errors) {
            const nonFieldErrors = Array.isArray(errorData.non_field_errors)
              ? errorData.non_field_errors.join(", ")
              : errorData.non_field_errors;
            errorMessage = nonFieldErrors;
            errors.push(nonFieldErrors);
          } else {
            // Ошибки валидации полей: то, что удалось сопоставить с полем
            // формы, уезжает ПОД это поле; остальное — в общую сводку.
            const fromApi: Record<string, string> = {};
            Object.keys(errorData).forEach((key) => {
              const raw = errorData[key];
              const text = Array.isArray(raw)
                ? raw.join(", ")
                : typeof raw === "string"
                  ? raw
                  : JSON.stringify(raw);
              const field = API_FIELD_MAP[key];
              if (field !== undefined) {
                fromApi[field] = text;
              } else {
                errors.push(`${key}: ${text}`);
              }
            });
            if (Object.keys(fromApi).length > 0) {
              setFieldErrors(fromApi);
              focusFirstInvalid(FIELD_ORDER, fromApi);
              if (errors.length === 0) {
                errorMessage = "Проверьте отмеченные поля.";
              }
            }

            if (errors.length > 0) {
              errorMessage = errors.join("; ");
            }
          }
        } catch (e) {
          const errorText = await response.text();
          console.error("Не удалось распарсить ошибку:", errorText);
          errorMessage = errorText || errorMessage;
          errors.push(errorMessage);
        }

        setValidationErrors(errors.length > 0 ? errors : [errorMessage]);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("Запрос на откомандирование создан:", data);

      // Показываем уведомление об успехе
      toast({
        title: "Запрос создан",
        description: `Запрос на откомандирование сотрудника ${
          employeeName || "сотрудника"
        } успешно создан. Статус: ${
          data.status === "pending" ? "Ожидает одобрения" : data.status
        }`,
      });

      // Успешно отправлено
      if (onSuccess) {
        onSuccess();
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Ошибка при откомандировании сотрудника:", error);
      setValidationErrors([
        error instanceof Error
          ? error.message
          : "Произошла ошибка при откомандировании сотрудника",
      ]);
    } finally {
      setIsSubmitting(false);
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

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            {/* Дата начала откомандирования */}
            <div className="space-y-2">
              <Label htmlFor="start-date">Дата начала откомандирования *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    {...fieldProps("start-date", fieldErrors["start-date"])}
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? (
                      format(startDate, "PPP", { locale: ru })
                    ) : (
                      <span>Выберите дату начала</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
              <FieldError id="start-date" error={fieldErrors["start-date"]} />
            </div>

            {/* Дата окончания откомандирования */}
            <div className="space-y-2">
              <Label htmlFor="end-date">
                Дата окончания откомандирования *
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    {...fieldProps("end-date", fieldErrors["end-date"])}
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? (
                      format(endDate, "PPP", { locale: ru })
                    ) : (
                      <span>Выберите дату окончания</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                    disabled={(date) => (startDate ? date < startDate : false)}
                    locale={ru}
                  />
                </PopoverContent>
              </Popover>
              <FieldError id="end-date" error={fieldErrors["end-date"]} />
            </div>

            {/* Выбор подразделения */}
            <div className="space-y-2">
              <Label htmlFor="division">
                Подразделение для откомандирования *
              </Label>
              <Select
                value={targetDivisionId}
                onValueChange={setTargetDivisionId}
                disabled={loadingDivisions}
              >
                <SelectTrigger {...fieldProps("division", fieldErrors.division)}>
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
              <FieldError id="division" error={fieldErrors.division} />
            </div>

            {/* Комментарий */}
            <div className="space-y-2">
              <Label htmlFor="comment">Причина откомандирования *</Label>
              <Textarea
                {...fieldProps("comment", fieldErrors.comment)}
                placeholder="Дополнительная информация об откомандировании..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
              <FieldError id="comment" error={fieldErrors.comment} />
            </div>

            {/* Ошибки валидации */}
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
