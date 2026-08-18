"use client";

// Форма на react-hook-form + zod. Правила — в `model/schema.ts`, разметка
// ошибки и фокус — в `shared/lib/form`; здесь остаётся только то, что
// относится к добавлению сотрудника: справочники и сборка запроса.
import { useEffect, useMemo } from "react";
import { Controller } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Save, X, AlertTriangle } from "lucide-react";
import { usePositions } from "@/hooks/use-positions";
import { useRanks } from "@/hooks/use-ranks";
import { useDivisionsTree } from "@/hooks/use-divisions-tree";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/hooks/use-toast";
import { ApiRequestError } from "@/shared/lib/api-error";
import {
  Field,
  applyServerErrors,
  focusFirstError,
  focusFirstOf,
  useZodForm,
} from "@/shared/lib/form";
import { createEmployee } from "../api/add-employee-api";
import { flattenDivisions } from "../lib/utils";
import {
  EMPLOYEE_API_FIELDS,
  EMPTY_EMPLOYEE_FORM,
  employeeFormSchema,
  type EmployeeFormValues,
} from "../model/schema";

interface AddEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddEmployeeDialog({
  open,
  onOpenChange,
}: AddEmployeeDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useZodForm(employeeFormSchema, EMPTY_EMPLOYEE_FORM);

  // Используем React Query для загрузки справочников
  const {
    data: positions = [],
    isLoading: loadingPositions,
    error: positionsError,
  } = usePositions();

  const {
    data: ranks = [],
    isLoading: loadingRanks,
    error: ranksError,
  } = useRanks();

  const {
    data: divisionsTree,
    isLoading: loadingDivisions,
    error: divisionsError,
  } = useDivisionsTree();

  const loadingDictionaries =
    loadingPositions || loadingRanks || loadingDivisions;
  // Отказ справочника — не ошибка формы: чинить его человеку нечем, но и
  // выбрать подразделение он не сможет, поэтому сказать надо.
  const dictionariesFailed =
    positionsError !== null || ranksError !== null || divisionsError !== null;

  // Преобразуем дерево подразделений в плоский список
  const divisions = useMemo(() => {
    if (!divisionsTree) {
      return [];
    }

    return flattenDivisions(divisionsTree);
  }, [divisionsTree]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) reset(EMPTY_EMPLOYEE_FORM);
  }, [open, reset]);

  const submit = async (values: EmployeeFormValues) => {
    try {
      await createEmployee({
        employees: [
          {
            first_name: values.firstName,
            last_name: values.lastName,
            middle_name: values.middleName || undefined,
            iin: values.iin,
            rank: values.rankId ? Number(values.rankId) : undefined,
          },
        ],
        staff_units: [
          {
            division: Number(values.divisionId),
            position: Number(values.positionId),
          },
        ],
      });

      reset(EMPTY_EMPLOYEE_FORM);
      onOpenChange(false);

      // Обновляем список сотрудников
      queryClient.invalidateQueries({
        queryKey: ["staff-units-by-directorate"],
      });

      // Показываем уведомление об успехе
      toast({
        title: "Сотрудник добавлен",
        description: "Сотрудник успешно добавлен в систему",
      });
    } catch (error) {
      console.error("Error creating employee:", error);
      // Полевой отказ ложится под свои поля, остальное — в сводку формы.
      const { fields, rest } =
        error instanceof ApiRequestError
          ? applyServerErrors<EmployeeFormValues>(
              setError,
              error.payload,
              EMPLOYEE_API_FIELDS
            )
          : {
              fields: [],
              rest: [
                error instanceof Error
                  ? error.message
                  : "Произошла ошибка при добавлении сотрудника",
              ],
            };
      if (rest.length > 0) {
        setError("root", { message: rest.join("; ") });
      }
      // Сервер мог отметить поле, которое сейчас за пределами видимой части.
      focusFirstOf(fields);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 60vw на телефоне — это 225 px под многополевую форму: на узком экране
          диалог занимает почти всю ширину, а «шестьдесят процентов» включаются
          с планшета. */}
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-[60vw] !max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить нового сотрудника</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) =>
            void handleSubmit(submit, (invalid) => focusFirstError(invalid))(e)
          }
          className="space-y-6"
          noValidate
        >
          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Личная информация</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field name="lastName" label="Фамилия" required error={errors.lastName}>
                {(field) => (
                  <Input {...field} placeholder="Петров" {...register("lastName")} />
                )}
              </Field>

              <Field name="firstName" label="Имя" required error={errors.firstName}>
                {(field) => (
                  <Input {...field} placeholder="Володя" {...register("firstName")} />
                )}
              </Field>

              <Field name="middleName" label="Отчество" error={errors.middleName}>
                {(field) => (
                  <Input
                    {...field}
                    placeholder="Иванович"
                    {...register("middleName")}
                  />
                )}
              </Field>

              <Field name="iin" label="ИИН" required error={errors.iin}>
                {(field) => (
                  <Input
                    {...field}
                    placeholder="971126300673"
                    inputMode="numeric"
                    maxLength={12}
                    {...register("iin")}
                  />
                )}
              </Field>
            </div>
          </div>

          {/* Work Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Рабочая информация</h3>

            <div className="space-y-4">
              <Field
                name="divisionId"
                label="Подразделение"
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
                        disabled={loadingDictionaries}
                      >
                        <SelectTrigger
                          {...field}
                          ref={input.ref}
                          onBlur={input.onBlur}
                          className="w-full"
                        >
                          <SelectValue
                            placeholder={
                              loadingDictionaries
                                ? "Загрузка..."
                                : "Выберите подразделение"
                            }
                            className="truncate"
                          />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {divisions.length === 0 && !loadingDictionaries && (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                              Нет доступных подразделений
                            </div>
                          )}
                          {divisions.map((division) => (
                            <SelectItem
                              key={division.id}
                              value={division.id.toString()}
                            >
                              <span className="truncate block">
                                {division.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  name="positionId"
                  label="Должность"
                  required
                  error={errors.positionId}
                >
                  {(field) => (
                    <Controller
                      control={control}
                      name="positionId"
                      render={({ field: input }) => (
                        <Select
                          value={input.value}
                          onValueChange={input.onChange}
                          disabled={loadingDictionaries}
                        >
                          <SelectTrigger
                            {...field}
                            ref={input.ref}
                            onBlur={input.onBlur}
                          >
                            <SelectValue
                              placeholder={
                                loadingDictionaries
                                  ? "Загрузка..."
                                  : "Выберите должность"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {positions.map((position) => (
                              <SelectItem
                                key={position.id}
                                value={position.id.toString()}
                              >
                                {position.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                </Field>

                <Field name="rankId" label="Звание" error={errors.rankId}>
                  {(field) => (
                    <Controller
                      control={control}
                      name="rankId"
                      render={({ field: input }) => (
                        <Select
                          value={input.value}
                          onValueChange={input.onChange}
                          disabled={loadingDictionaries}
                        >
                          <SelectTrigger
                            {...field}
                            ref={input.ref}
                            onBlur={input.onBlur}
                          >
                            <SelectValue
                              placeholder={
                                loadingDictionaries
                                  ? "Загрузка..."
                                  : "Выберите звание"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {ranks.map((rank) => (
                              <SelectItem
                                key={rank.id}
                                value={rank.id.toString()}
                              >
                                {rank.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                </Field>
              </div>
            </div>
          </div>

          {/* То, что не относится к конкретному полю: отказ справочников и
              отказ сервера при сохранении. */}
          {(dictionariesFailed || errors.root !== undefined) && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {dictionariesFailed && <li>Ошибка загрузки справочников</li>}
                  {errors.root?.message !== undefined && (
                    <li>{errors.root.message}</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              <X className="h-4 w-4 mr-2" />
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? "Добавление..." : "Добавить сотрудника"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
