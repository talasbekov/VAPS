import { useQuery } from "@tanstack/react-query";
import { ApiHttpError, apiClient, type StaffUnit } from "@/lib/api";

/**
 * Ручка `staff-units/directorate/` закрыта ролевой проверкой (ROLE_3/6/7) —
 * см. staff_unit/views.py::directorate_management. Отказ по правам не станет
 * успехом от повтора, а react-query по умолчанию переспросит трижды: лишние
 * 403 в сети и задержка перед тем, как страница покажет гвард.
 */
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiHttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}

/** 403 от этой ручки означает «роль не ведёт штатку», а не поломку. */
export function isDirectorateForbidden(error: unknown): error is ApiHttpError {
  return error instanceof ApiHttpError && error.status === 403;
}

/**
 * ВЕСЬ состав подразделения. Отдельный хук страницы — `useStaffUnitsPage`.
 *
 * `enabled` появился в №228: на пяти тысячах сотрудников этот ответ весит
 * 2,7 МБ, и грузить его при открытии экрана, которому нужна одна страница,
 * незачем. Экраны, которым состав нужен целиком (календарь, массовая правка),
 * зовут хук без аргументов — поведение прежнее.
 */
export function useStaffUnitsByDirectorate(enabled = true) {
  return useQuery<{
    /** Подразделение, ОДНИМ КОТОРЫМ описывается ответ, либо `null`.
     *
     * `null` приходит, когда такого подразделения не существует: у
     * суперпользователя, видящего все деревья оргструктуры сразу (корней в базе
     * бывает несколько). Раньше сервер отдавал в этом случае первый корень —
     * и диалог статусов писал его в `related_division` всем подряд (Plane
     * №304). Читателю положен запасной путь: подразделение ШТАТНОЙ ЕДИНИЦЫ
     * сотрудника. */
    division: {
      id: number;
      name: string;
      code: string;
    } | null;
    staff_units: StaffUnit[];
    total_count: number;
  }>({
    queryKey: ["staff-units-by-directorate"],
    queryFn: async () => {
      return await apiClient.getStaffUnitsByDirectorate();
    },
    enabled,
    retry: retryUnlessClientError,
  });
}
