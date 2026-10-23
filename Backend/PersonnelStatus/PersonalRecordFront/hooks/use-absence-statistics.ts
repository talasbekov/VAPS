import { ApiHttpError, apiClient } from "@/lib/api"
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read"

/** Почему сводка недоступна. `unlinked` — учётка не привязана к сотруднику:
 *  ШТАТНОЕ состояние служебной учётки, а не поломка (Plane №340). Все 28
 *  ролевых учёток стенда получают именно его, и дашборд показывал им «не
 *  удалось загрузить… повторить» — предложение чинить то, что не сломано. */
export type AbsenceStatsFailure = "unlinked" | "other"

export function absenceStatsFailure(error: unknown): AbsenceStatsFailure | null {
  if (error === null || error === undefined) return null
  if (
    error instanceof ApiHttpError &&
    error.status === 400 &&
    /не привязан/i.test(error.message)
  ) {
    return "unlinked"
  }
  return "other"
}

export function useAbsenceStatistics(enabled = true) {
  const access = useOpsReadAccess("status.view")
  return useOpsProtectedRead<{
    period: {
      start_date: string
      end_date: string
    }
    division_id: number
    staff_count: number
    total_absences: number
    by_type: {
      vacation: number
      leave_by_report: number
      sick_leave: number
      business_trip: number
      training: number
      competition: number
      conference: number
      other_absence: number
      on_duty: number
      after_duty: number
      seconded_from: number
      seconded_to: number
    }
  }>(["absence-statistics", "summary"], [], access,
    () => apiClient.getAbsenceStatistics(), { enabled, staleTime: 60_000 })
}



