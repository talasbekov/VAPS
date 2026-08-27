import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ApiHttpError,
  apiClient,
  type DirectorateQuery,
  type StaffUnit,
} from "@/lib/api";

/**
 * СТРАНИЦА штатки подразделения (Plane №228).
 *
 * Отдельный хук, а не флаг у соседнего `useStaffUnitsByDirectorate`: тот
 * отдаёт ВЕСЬ состав, и им живут календарь статусов, массовая правка и расход
 * дня. Один хук с двумя режимами означал бы один кэш на два разных ответа —
 * экран, попросивший состав, получал бы страницу от соседа.
 *
 * `keepPreviousData` обязателен: без него на каждом «Далее» таблица
 * размонтируется и страница прыгает вверх, а на пяти тысячах строк это
 * происходит на каждом шаге листания.
 */
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiHttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}

export interface StaffUnitsPage {
  division: { id: number; name: string; code: string };
  staff_units: StaffUnit[];
  total_count: number;
  matched_count?: number;
  page?: number;
  page_size?: number;
  has_next?: boolean;
  summary?: {
    employees: number;
    without_status: number;
    overdue: number;
    scheduled: number;
  };
}

export function useStaffUnitsPage(params: DirectorateQuery, enabled = true) {
  return useQuery<StaffUnitsPage>({
    enabled,
    // Ключ несёт ВЕСЬ отбор: иначе смена поиска отдаёт кэш предыдущего.
    queryKey: [
      "staff-units-page",
      params.page ?? 1,
      params.pageSize ?? 50,
      params.search ?? "",
      params.divisionId ?? "",
      params.status ?? "",
      params.positionLevelMax ?? "",
      (params.employeeIds ?? []).join(","),
      params.withSummary ? "summary" : "",
    ],
    queryFn: async () => await apiClient.getStaffUnitsByDirectorate(params),
    placeholderData: keepPreviousData,
    retry: retryUnlessClientError,
  });
}
