import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api"

export function useAbsenceStatistics() {
  return useQuery<{
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
      other_absence: number
      on_duty: number
      after_duty: number
      seconded_from: number
      seconded_to: number
    }
  }>({
    queryKey: ["absence-statistics"],
    queryFn: async () => {
      return await apiClient.getAbsenceStatistics()
    },
  })
}



