"use client";

// Каталог кадровых типов статусов — С СЕРВЕРА, а не из копии в коде
// (Plane №354).
//
// ЖАЛОБА ЗАКАЗЧИКА ДОСЛОВНО: «в админке добавил новый статус, там она не
// появилась» — про окно планирования статуса.
//
// ПОЧЕМУ ХУК, А НЕ КОНСТАНТА РЯДОМ. Список типов правится в админке, то есть
// меняется без выкатки клиента. Любая копия каталога в коде расходится с
// сервером в тот день, когда администратор заведёт первый свой тип — так уже
// было с каталогом раздела ОМ (Plane №342), и лечилось тем же: копия удалена,
// читатели переведены на справочник.
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";

export interface EmployeeStatusTypeItem {
  /** Код, который уходит на сервер в поле `status_type`. */
  code: string;
  label: string;
  /** Цвет из справочника; пусто — клиент берёт свой по коду. */
  color: string;
}

/**
 * @param selectableOnly только то, что человек выбирает руками (без заглушек
 *   и без прикомандирования — у него свой процесс с заявкой).
 */
export function useEmployeeStatusTypes(selectableOnly = true) {
  const query = useQuery<EmployeeStatusTypeItem[]>({
    queryKey: ["employee-status-types", selectableOnly],
    queryFn: () => apiClient.getEmployeeStatusTypes(selectableOnly),
    // Справочник меняется редко: держим пять минут, чтобы каждое открытие
    // окна не било в сервер за одним и тем же списком.
    staleTime: 5 * 60 * 1000,
  });

  return {
    types: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
