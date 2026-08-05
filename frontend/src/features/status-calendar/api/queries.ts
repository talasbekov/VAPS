// Story 19.4c: query-хук над GET /api/operations/statuses/calendar/ (19.4b).
// Образец: personnel/api/queries.ts (простой useQuery-хук) +
// security-events/api/queries.ts's toQueryString (сериализация параметров).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'

export type EmployeeStatusCalendarResponse =
  paths['/api/operations/statuses/calendar/']['get']['responses']['200']['content']['application/json']

export const statusCalendarKeys = {
  employeeMonth: (divisionId: string, employeeId: string, year: number, month: number) =>
    ['status-calendar', 'employee', divisionId, employeeId, year, month] as const,
}

function toQueryString(divisionId: string, employeeId: string, year: number, month: number): string {
  const search = new URLSearchParams()
  search.set('division_id', divisionId)
  search.set('employee_id', employeeId)
  search.set('year', String(year))
  search.set('month', String(month))
  return search.toString()
}

export function useEmployeeStatusCalendar(
  divisionId: string,
  employeeId: string,
  year: number,
  month: number,
) {
  return useQuery<EmployeeStatusCalendarResponse, ApiFailure>({
    queryKey: statusCalendarKeys.employeeMonth(divisionId, employeeId, year, month),
    queryFn: () =>
      apiClient.get<EmployeeStatusCalendarResponse>(
        `/api/operations/statuses/calendar/?${toQueryString(divisionId, employeeId, year, month)}`,
      ),
    enabled: Boolean(divisionId && employeeId),
  })
}
