"use client";

import { useQuery } from '@tanstack/react-query'
import { apiClient, type StrengthReportRow, type OpsEmployeeStatusRow, type OpsStatusType } from '@/lib/api'
import { opsApiClient } from '@/lib/ops-api'
import { useOpsPermissions } from '@/hooks/use-ops-permissions'
import { useStrengthReport } from '@/hooks/use-strength-report'
import { useOpsStatusTypes } from '@/hooks/use-ops-status-types'
import { DAILY_DIVISIONS_PATH, DAILY_SUBMISSIONS_PATH, currentSubmission, parseSubmissionList, type DaySubmission } from '@/entities/daily-grid'
import { useBusinessDate } from './business-date'

export interface ResponsibleDivision {
  id: string; parent_id: string | null; name: string; division_type: string
  without_status: number; notify_recipient_name: string | null
}
export interface DirectorateSummary {
  division: ResponsibleDivision; ids: string[]; listTotal: number; offList: number
  inService: number | null; deviations: number | null; withoutStatus: number
  columns: Record<string, number>; submission: DaySubmission | null
}

/** Same winner as operations/strength_report.py resolve_status_row:
 * uncancelled facts on [start,end), lowest priority, then code/start date.
 * Deactivated catalog entries still resolve historical facts. */
export function effectiveDailyStatus(rows: OpsEmployeeStatusRow[], date: string, catalog: OpsStatusType[]): OpsEmployeeStatusRow | null {
  const priorities = new Map(catalog.map(type => [type.code, type.priority]))
  const active = rows.filter(row => row.cancelled_at === null).filter(row => {
    if (!Number.isFinite(priorities.get(row.status_type_code))) throw new Error('Статус не найден в справочнике')
    return row.date_start <= date && date < row.date_end
  })
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  active.sort((a, b) => priorities.get(a.status_type_code)! - priorities.get(b.status_type_code)! || compare(a.status_type_code, b.status_type_code) || compare(a.date_start, b.date_start))
  return active[0] ?? null
}

/** Report rows are exact divisions. Each subtree is summed once, including its root. */
export function groupDirectorates(divisions: ResponsibleDivision[], rows: StrengthReportRow[], scopeId: number, submissions: DaySubmission[], inServiceColumn?: string) {
  const scope = divisions.find(row => row.id === String(scopeId) && row.division_type === 'department')
  if (!scope) throw new Error('Департамент роли не найден в доступной структуре')
  const children = (id: string) => divisions.filter(row => row.parent_id === id)
  const descendants = (id: string) => {
    const seen = new Set<string>(); const stack = [id]
    while (stack.length) {
      const next = stack.pop()!
      if (seen.has(next)) continue
      seen.add(next); stack.push(...children(next).map(row => row.id))
    }
    return [...seen]
  }
  const summarize = (division: ResponsibleDivision, ids: string[]): DirectorateSummary => {
    const wanted = new Set(ids)
    const exactRows = rows.filter(row => wanted.has(String(row.division_id)))
    const columns: Record<string, number> = {}
    for (const row of exactRows) for (const [code, count] of Object.entries(row.columns)) columns[code] = (columns[code] ?? 0) + count
    const listTotal = exactRows.reduce((sum, row) => sum + row.list_total, 0)
    const offList = exactRows.reduce((sum, row) => sum + row.off_list, 0)
    const inService = inServiceColumn ? columns[inServiceColumn] ?? 0 : null
    return { division, ids, listTotal, offList, inService,
      deviations: inServiceColumn ? Object.entries(columns).reduce((sum, [code, count]) => sum + (code === inServiceColumn ? 0 : count), 0) : null,
      // Unlike exact strength rows, this metadata already includes descendants.
      withoutStatus: division.without_status, columns,
      submission: currentSubmission(submissions.filter(row => row.division_id === division.id)) }
  }
  const sources = children(scope.id).map(division => summarize(division, descendants(division.id))).filter(row => row.listTotal + row.offList > 0)
  sources.sort((a, b) => Number(!!a.submission) - Number(!!b.submission) || a.division.name.localeCompare(b.division.name, 'ru'))
  return { scope, sources, total: summarize(scope, descendants(scope.id)), direct: summarize(scope, [scope.id]) }
}

export function useResponsibleDaily(selectedDate?: string) {
  const access = useOpsPermissions()
  const scopes = [...new Set(access.roles.filter(role => role.code === 'FORCES_GATHERING_OFFICER').map(role => role.scope_division_id))]
  const scopeId = scopes.length === 1 ? scopes[0] : null
  const { businessDate } = useBusinessDate(selectedDate)
  const clock = useQuery({ queryKey: ['daily-expense-board', 'default-business-date'], queryFn: () => apiClient.getTomorrowBlockState({}), staleTime: 300_000 })
  const enabled = businessDate !== null && access.hasPermission('status.view')
  const report = useStrengthReport(enabled, businessDate ?? undefined)
  const catalog = useOpsStatusTypes(enabled)
  const divisions = useQuery({ queryKey: ['daily-expense-board', 'responsible-divisions', businessDate], enabled,
    queryFn: async () => {
      const response = await opsApiClient.get<{ results: ResponsibleDivision[] }>(`${DAILY_DIVISIONS_PATH}?business_date=${businessDate}`)
      if (!Array.isArray(response.results) || response.results.some(row => typeof row.id !== 'string' || !(row.parent_id === null || typeof row.parent_id === 'string') || typeof row.without_status !== 'number' || !row.division_type)) throw new Error('Неполная структура подразделений')
      return response.results
    } })
  const submissions = useQuery({ queryKey: ['daily-expense-board', 'responsible-submissions', businessDate], enabled,
    queryFn: async () => {
      const response = await opsApiClient.get<{ results: unknown[] }>(`${DAILY_SUBMISSIONS_PATH}?business_date=${businessDate}`)
      const parsed = parseSubmissionList(response)
      if (!Array.isArray(response.results) || parsed.length !== response.results.length) throw new Error('Некорректный ответ сдач')
      return parsed.filter(row => row.business_date === businessDate)
    } })
  let data: ReturnType<typeof groupDirectorates> | null = null
  let structureError: string | null = null
  if (!access.isLoading && scopeId == null) structureError = 'Не определён единственный департамент роли'
  if (scopeId != null && divisions.data && report.data) {
    try { data = groupDirectorates(divisions.data, report.data.rows, scopeId, submissions.data ?? [], catalog.all.find(row => row.code === 'IN_SERVICE')?.report_column_code) }
    catch (error) { structureError = error instanceof Error ? error.message : 'Структура недоступна' }
  }
  return { businessDate, scopeId, data, structureError, clock, report, divisions, submissions, catalog, access }
}
