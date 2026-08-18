// Утилиты для фичи добавления сотрудника.
//
// Правила валидации отсюда уехали в `model/schema.ts`: три функции проверяли
// одно и то же (`validateEmployeeFields`, `validateEmployeeForm`, `validateIIN`),
// причём формулировки уже разошлись, а одна из трёх не вызывалась нигде.

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
