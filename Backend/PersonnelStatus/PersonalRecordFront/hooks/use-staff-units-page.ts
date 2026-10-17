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
  /** Подразделение, ОДНИМ КОТОРЫМ описывается ответ, либо `null` — см.
   *  `getStaffUnitsByDirectorate` в lib/api.ts (Plane №304). */
  division: { id: number; name: string; code: string } | null;
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
      params.directorateId ?? "",
      params.status ?? "",
      params.positionLevelMax ?? "",
      (params.employeeIds ?? []).join(","),
      params.withSummary ? "summary" : "",
      (params.statusNot ?? []).join(","),
    ],
    queryFn: async () => await apiClient.getStaffUnitsByDirectorate(params),
    placeholderData: keepPreviousData,
    retry: retryUnlessClientError,
  });
}

/** The API accepts at most 200 employee IDs; a person may have several slots. */
export async function loadStaffUnitsSelection(
  employeeIds: readonly number[],
  readPage: (params: DirectorateQuery) => Promise<StaffUnitsPage>,
  signal?: AbortSignal,
): Promise<StaffUnit[]> {
  const ids = [...new Set(employeeIds)];
  const units = new Map<number, StaffUnit>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const seen = new Set<number>();
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      if (page > 200) throw new Error("Проверка страниц выбранных сотрудников не завершена.");
      const response = await readPage({ employeeIds: batch, page, pageSize: 200 });
      signal?.throwIfAborted();
      let added = 0;
      for (const unit of response.staff_units) {
        if (!seen.has(unit.id)) { seen.add(unit.id); added++; }
        units.set(unit.id, unit);
      }
      if (!response.has_next) break;
      if (!added) throw new Error("Некорректный повтор страниц выбранных сотрудников.");
    }
  }
  return [...units.values()];
}

export function useStaffUnitsSelection(employeeIds: readonly number[], enabled = true) {
  const ids = [...new Set(employeeIds)].sort((a, b) => a - b);
  return useQuery<StaffUnit[]>({
    queryKey: ["staff-units-page", "selection", ids],
    enabled: enabled && ids.length > 0,
    queryFn: ({ signal }) => loadStaffUnitsSelection(ids, params => apiClient.getStaffUnitsByDirectorate(params), signal),
    retry: retryUnlessClientError,
  });
}
