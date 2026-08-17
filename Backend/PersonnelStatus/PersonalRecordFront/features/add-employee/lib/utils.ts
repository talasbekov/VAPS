// Утилиты для фичи добавления сотрудника

import type { Division } from "@/lib/api";

/**
 * Преобразует дерево подразделений в плоский список
 */
export function flattenDivisions(
  division: Division,
  prefix = ""
): Array<{ id: number; name: string }> {
  const result: Array<{ id: number; name: string }> = [];

  // Пропускаем неактивные подразделения
  if (!division.is_active) {
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
}

/**
 * Валидация ИИН (12 цифр)
 */
export function validateIIN(iin: string): boolean {
  return /^\d{12}$/.test(iin);
}

export type EmployeeFormField =
  | "lastName"
  | "firstName"
  | "iin"
  | "divisionId"
  | "positionId";

/**
 * Валидация формы ПО ПОЛЯМ: сводка списком строк не позволяла подсветить само
 * поле — человек читал «Введите ИИН» под кнопкой и искал, где это поле.
 */
export function validateEmployeeFields(formData: {
  firstName: string;
  lastName: string;
  iin: string;
  positionId: string;
  divisionId: string;
}): Partial<Record<EmployeeFormField, string>> {
  const errors: Partial<Record<EmployeeFormField, string>> = {};

  if (!formData.lastName.trim()) errors.lastName = "Введите фамилию сотрудника.";
  if (!formData.firstName.trim()) errors.firstName = "Введите имя сотрудника.";
  if (!formData.iin.trim()) errors.iin = "Введите ИИН сотрудника.";
  else if (!validateIIN(formData.iin))
    errors.iin = "ИИН должен состоять из 12 цифр.";
  if (!formData.divisionId) errors.divisionId = "Выберите подразделение.";
  if (!formData.positionId) errors.positionId = "Выберите должность.";

  return errors;
}

/**
 * Валидация формы добавления сотрудника
 */
export function validateEmployeeForm(formData: {
  firstName: string;
  lastName: string;
  iin: string;
  positionId: string;
  divisionId: string;
}): string[] {
  const errors: string[] = [];

  if (!formData.firstName.trim()) {
    errors.push("Введите имя сотрудника");
  }
  if (!formData.lastName.trim()) {
    errors.push("Введите фамилию сотрудника");
  }
  if (!formData.iin.trim()) {
    errors.push("Введите ИИН сотрудника");
  }
  if (!formData.positionId) {
    errors.push("Выберите должность");
  }
  if (!formData.divisionId) {
    errors.push("Выберите подразделение");
  }

  // Валидация ИИН (12 цифр)
  if (formData.iin && !validateIIN(formData.iin)) {
    errors.push("ИИН должен состоять из 12 цифр");
  }

  return errors;
}








