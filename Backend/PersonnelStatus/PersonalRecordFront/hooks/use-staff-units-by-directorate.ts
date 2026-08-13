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

export function useStaffUnitsByDirectorate() {
  return useQuery<{
    division: {
      id: number;
      name: string;
      code: string;
    };
    staff_units: StaffUnit[];
    total_count: number;
  }>({
    queryKey: ["staff-units-by-directorate"],
    queryFn: async () => {
      return await apiClient.getStaffUnitsByDirectorate();
    },
    retry: retryUnlessClientError,
  });
}
