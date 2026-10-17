import type { UseOpsPermissionsResult } from '@/hooks/use-ops-permissions'
import type { DepartmentRequestRow } from '@/entities/security-event'

export type WorkspaceRole = 'responsible' | 'expense' | 'headquarters'
export type WorkspaceEntry = WorkspaceRole | 'legacy' | 'loading' | 'denied'
export type WorkspaceView = 'desk' | 'daily' | 'forces'

export type LegacyWorkspaceView = 'daily' | 'forces' | 'department-summary'

export function legacyWorkspaceView(value: string | null): LegacyWorkspaceView {
  return value === 'forces' || value === 'department-summary' ? value : 'daily'
}

export function legacyWorkspaceTitle(view: LegacyWorkspaceView): string {
  return view === 'forces' ? 'Сбор сил на ОМ'
    : view === 'department-summary' ? 'Свод департамента'
    : 'Ежедневный расход организации'
}

export const DEPARTMENT_RESPONSIBLE_ROLES = ['DEPARTMENT_EXPENSE_OFFICER', 'FORCES_GATHERING_OFFICER'] as const

/** A missing or conflicting assignment must not silently select a department. */
export function responsibleDepartmentScope(roles: { code: string; scope_division_id: number | null }[]): number | null {
  const scopes = [...new Set(roles.filter(role => DEPARTMENT_RESPONSIBLE_ROLES.some(code => code === role.code)).map(role => role.scope_division_id))]
  return scopes.length === 1 && scopes[0] != null ? scopes[0] : null
}

export function resolveWorkspaceRole(access: UseOpsPermissionsResult): WorkspaceEntry {
  if (access.error) return 'denied'
  if (access.isLoading || access.permissions === undefined) return 'loading'
  if (access.roles.some(role => role.code === 'FORCES_GATHERING_OFFICER') && access.hasPermission('forces.allocate')) {
    return 'responsible'
  }
  if (access.roles.some(role => role.code === 'OPS_STAFF') && access.hasPermission('forces.command')) {
    return 'headquarters'
  }
  if (access.roles.some(role => role.code === 'DEPARTMENT_EXPENSE_OFFICER') && access.hasPermission('forces.allocate')) {
    return 'expense'
  }
  // A retained role must not veto a different explicit permission. The generic
  // screen gates each forces action separately; it does not infer a department.
  if (['forces.command', 'forces.allocate', 'forces.select'].some(access.hasPermission)) return 'legacy'
  if (access.roles.some(role => role.code === 'OPS_STAFF' || DEPARTMENT_RESPONSIBLE_ROLES.some(code => code === role.code))) return 'denied'
  return 'legacy'
}

export function resolveWorkspaceView(role: WorkspaceRole, query: URLSearchParams, canViewDaily = true): WorkspaceView {
  if (query.get('request') || query.get('collection') || query.get('campaign')) return 'forces'
  const view = query.get('view')
  if (view === 'daily' || view === 'department-summary') return 'daily'
  if (view === 'forces') return 'forces'
  if (role === 'expense') return canViewDaily ? 'daily' : 'forces'
  return role === 'responsible' ? 'desk' : 'forces'
}

export function workspaceHref(query: URLSearchParams, view: WorkspaceView, request?: string) {
  const next = new URLSearchParams(query)
  for (const key of ['request', 'collection', 'campaign', 'tab']) next.delete(key)
  if (view === 'desk') next.delete('view')
  else next.set('view', view)
  if (request) next.set('request', request)
  const suffix = next.toString()
  return `/employees${suffix ? `?${suffix}` : ''}`
}

export function activeRequests(rows: DepartmentRequestRow[]) {
  return rows.filter(row => !['SUBMITTED', 'ACCEPTED', 'DECLINED'].includes(row.status))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) ||
      (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
}

export function requestTotals(rows: DepartmentRequestRow[]) {
  return {
    requested: rows.reduce((sum, row) => sum + row.need, 0),
    allocating: rows.some(row => row.allocating === null) ? null : rows.reduce((sum, row) => sum + (row.allocating ?? 0), 0),
    assigned: rows.reduce((sum, row) => sum + row.assigned, 0),
    unanswered: rows.filter(row => row.allocating === null).length,
  }
}
