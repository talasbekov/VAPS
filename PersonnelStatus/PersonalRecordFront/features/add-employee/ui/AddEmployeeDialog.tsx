"use client";

import type React from "react";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createEmployee } from "../api/add-employee-api";
import type { CreateEmployeeFormData } from "../model/types";
import { flattenDivisions, validateEmployeeFields } from "../lib/utils";
import type { EmployeeFormField } from "../lib/utils";
import {
  FieldError,
  fieldProps,
  focusFirstInvalid,
} from "@/shared/lib/field-errors";

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
  const [formData, setFormData] = useState<CreateEmployeeFormData>({
    firstName: "",
    lastName: "",
    middleName: "",
    iin: "",
    positionId: "",
    rankId: "",
    divisionId: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  // Ошибки по полям — рядом с полем; сводка ниже осталась для того, что к
  // конкретному полю не относится (сбой справочников, отказ сервера).
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<EmployeeFormField, string>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Преобразуем дерево подразделений в плоский список
  const divisions = useMemo(() => {
    if (!divisionsTree) {
      return [];
    }

    return flattenDivisions(divisionsTree);
  }, [divisionsTree]);

  // Сброс формы при закрытии
  useEffect(() => {
    if (!open) {
      setFormData({
        firstName: "",
        lastName: "",
        middleName: "",
        iin: "",
        positionId: "",
        rankId: "",
        divisionId: "",
      });
      setErrors([]);
      setFieldErrors({});
    }
  }, [open]);

  // Показываем ошибки загрузки справочников
  useEffect(() => {
    if (positionsError || ranksError || divisionsError) {
      setErrors((prev) => {
        if (!prev.includes("Ошибка загрузки справочников")) {
          return [...prev, "Ошибка загрузки справочников"];
        }
        return prev;
      });
    }
  }, [positionsError, ranksError, divisionsError]);

  /** Порядок полей на экране — по нему ищем, куда вести фокус. */
  const FIELD_ORDER: readonly EmployeeFormField[] = [
    "lastName",
    "firstName",
    "iin",
    "divisionId",
    "positionId",
  ];

  const validateForm = () => {
    const next = validateEmployeeFields(formData);
    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      // Без перевода фокуса сабмит выглядел как «ничего не произошло»:
      // сводка ошибок могла быть за пределами видимой части формы.
      focusFirstInvalid(FIELD_ORDER, next);
      return false;
    }
    return true;
  };

  /** Проверка одного поля на уходе фокуса: ошибка находится сразу, а не после «Добавить». */
  const validateField = (field: EmployeeFormField) => {
    const next = validateEmployeeFields(formData);
    setFieldErrors((prev) => ({ ...prev, [field]: next[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      // Формируем данные для API
      const requestData = {
        employees: [
          {
            first_name: formData.firstName,
            last_name: formData.lastName,
            middle_name: formData.middleName || undefined,
            iin: formData.iin,
            rank: formData.rankId ? Number(formData.rankId) : undefined,
          },
        ],
        staff_units: [
          {
            division: Number(formData.divisionId),
            position: Number(formData.positionId),
          },
        ],
      };

      console.log("Отправка запроса на создание сотрудника:", requestData);

      await createEmployee(requestData);

      // Сбрасываем форму
      setFormData({
        firstName: "",
        lastName: "",
        middleName: "",
        iin: "",
        positionId: "",
        rankId: "",
        divisionId: "",
      });
      setErrors([]);
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
    } catch (error: any) {
      console.error("Error creating employee:", error);
      const errorMessage =
        error?.message || "Произошла ошибка при добавлении сотрудника";
      
      // Если есть ошибки по полям, используем их
      if (error?.fieldErrors && Array.isArray(error.fieldErrors)) {
        setErrors(error.fieldErrors);
      } else {
        setErrors([errorMessage]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: keyof CreateEmployeeFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Личная информация</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lastName">Фамилия *</Label>
                <Input
                  {...fieldProps("lastName", fieldErrors.lastName)}
                  placeholder="Петров"
                  value={formData.lastName}
                  onChange={(e) =>
                    handleInputChange("lastName", e.target.value)
                  }
                  onBlur={() => validateField("lastName")}
                />
                <FieldError id="lastName" error={fieldErrors.lastName} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="firstName">Имя *</Label>
                <Input
                  {...fieldProps("firstName", fieldErrors.firstName)}
                  placeholder="Володя"
                  value={formData.firstName}
                  onChange={(e) =>
                    handleInputChange("firstName", e.target.value)
                  }
                  onBlur={() => validateField("firstName")}
                />
                <FieldError id="firstName" error={fieldErrors.firstName} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="middleName">Отчество</Label>
                <Input
                  id="middleName"
                  placeholder="Иванович"
                  value={formData.middleName}
                  onChange={(e) =>
                    handleInputChange("middleName", e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="iin">ИИН *</Label>
                <Input
                  {...fieldProps("iin", fieldErrors.iin)}
                  placeholder="971126300673"
                  inputMode="numeric"
                  value={formData.iin}
                  onChange={(e) => handleInputChange("iin", e.target.value)}
                  onBlur={() => validateField("iin")}
                  maxLength={12}
                />
                <FieldError id="iin" error={fieldErrors.iin} />
              </div>
            </div>
          </div>

          {/* Work Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Рабочая информация</h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="divisionId">Подразделение *</Label>
                <Select
                  value={formData.divisionId}
                  onValueChange={(value) =>
                    handleInputChange("divisionId", value)
                  }
                  disabled={loadingDictionaries}
                >
                  <SelectTrigger
                    className="w-full"
                    {...fieldProps("divisionId", fieldErrors.divisionId)}
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
                        <span className="truncate block">{division.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="divisionId" error={fieldErrors.divisionId} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="positionId">Должность *</Label>
                  <Select
                    value={formData.positionId}
                    onValueChange={(value) =>
                      handleInputChange("positionId", value)
                    }
                    disabled={loadingDictionaries}
                  >
                    <SelectTrigger
                      {...fieldProps("positionId", fieldErrors.positionId)}
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
                  <FieldError id="positionId" error={fieldErrors.positionId} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rank">Звание</Label>
                  <Select
                    value={formData.rankId}
                    onValueChange={(value) =>
                      handleInputChange("rankId", value)
                    }
                    disabled={loadingDictionaries}
                  >
                    <SelectTrigger>
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
                        <SelectItem key={rank.id} value={rank.id.toString()}>
                          {rank.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {/* Validation Errors */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
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

