"use client";

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { opsApiClient } from '@/lib/ops-api'
import { useAuth } from '@/lib/auth'
import { useOpsPermissions } from '@/hooks/use-ops-permissions'
import { DAILY_DIVISIONS_PATH, DAILY_SUBMISSIONS_PATH, parseSubmissionList } from '@/entities/daily-grid'
import { useBusinessDate } from '@/features/daily-expense/model/business-date'
import { groupDirectorates, type ResponsibleDivision } from '@/features/daily-expense/model/directorate-summary'
import { responsibleDepartmentScope } from './workspace'
import { moduleOpenFor } from '@/entities/portal-access'

/** One complete snapshot, isolated from the date-only caches of the daily form. */
export function useDailyActionQueue(selectedDate?: string) {
  const access = useOpsPermissions()
  const { user } = useAuth()
  const scopeId = responsibleDepartmentScope(access.roles)
  const allowed = Boolean(user) && !access.isLoading && !access.error && access.permissions !== undefined &&
    access.hasPermission('status.view') && (access.hasPermission('forces.allocate') || moduleOpenFor('/daily-expense', access.hasPermission)) &&
    !access.globalPermissions?.has('*') && scopeId !== null
  const { businessDate, dateError, retryDate } = useBusinessDate(selectedDate, allowed)
  // A successful permission refresh can change scope without changing account or date.
  // Such snapshots must never share cached names/counts, including after a 403.
  const authority = JSON.stringify([
    [...(access.permissions ?? [])].sort(), [...(access.globalPermissions ?? [])].sort(),
    access.roles.map(role => [role.code, role.scope_division_id]).sort(),
  ])
  const query = useQuery({
    queryKey: ['daily-expense-board', 'workspace-actions', user?.id, businessDate, scopeId, authority],
    enabled: allowed && businessDate !== null,
    queryFn: async () => {
      const [report, divisions, submissions] = await Promise.all([
        apiClient.getStrengthReport({ businessDate: businessDate! }),
        opsApiClient.get<{ results: ResponsibleDivision[] }>(`${DAILY_DIVISIONS_PATH}?business_date=${businessDate}`),
        opsApiClient.get<{ results: unknown[] }>(`${DAILY_SUBMISSIONS_PATH}?business_date=${businessDate}`),
      ])
      if (report.business_date !== businessDate) throw new Error('Расход получен на другую дату')
      if (!Array.isArray(divisions.results) || divisions.results.some(row => typeof row.id !== 'string' ||
        !(row.parent_id === null || typeof row.parent_id === 'string') || typeof row.name !== 'string' ||
        typeof row.without_status !== 'number' || !row.division_type)) throw new Error('Неполная структура подразделений')
      const parsed = parseSubmissionList(submissions)
      if (!Array.isArray(submissions.results) || parsed.length !== submissions.results.length) throw new Error('Некорректный ответ сдач')
      if (parsed.some(row => row.business_date !== businessDate)) throw new Error('Сдачи получены на другую дату')
      return groupDirectorates(divisions.results, report.rows, scopeId!, parsed)
    },
  })
  return { access, businessDate, scopeId, query, data: allowed ? query.data : undefined, dateError, retryDate }
}
