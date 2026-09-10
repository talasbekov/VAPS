import type { UseOpsPermissionsResult } from '@/hooks/use-ops-permissions'
import type { DepartmentRequestRow } from '@/entities/security-event'

export type WorkspaceRole = 'responsible' | 'headquarters'
export type WorkspaceEntry = WorkspaceRole | 'legacy' | 'loading' | 'denied'
export type WorkspaceView = 'desk' | 'daily' | 'forces'

export function resolveWorkspaceRole(access: UseOpsPermissionsResult): WorkspaceEntry {
  if (access.error) return 'denied'
  if (access.isLoading || access.permissions === undefined) return 'loading'
  if (access.roles.some(role => role.code === 'FORCES_GATHERING_OFFICER')) {
    return access.hasPermission('forces.allocate') ? 'responsible' : 'denied'
  }
  if (access.roles.some(role => role.code === 'OPS_STAFF')) {
    return access.hasPermission('forces.command') ? 'headquarters' : 'denied'
  }
  return 'legacy'
}

export function resolveWorkspaceView(role: WorkspaceRole, query: URLSearchParams): WorkspaceView {
  if (query.get('request') || query.get('collection') || query.get('campaign')) return 'forces'
  const view = query.get('view')
  if (view === 'daily' || view === 'department-summary') return 'daily'
  if (view === 'forces') return 'forces'
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
