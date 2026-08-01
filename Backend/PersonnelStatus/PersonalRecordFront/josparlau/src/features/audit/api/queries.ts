// Query hooks (§7.10, §5.4). `/api/audit/logs/` — существующая (`existing`)
// donor-схема (ARCH-FE-011: типы из schema.d.ts, не рукописные). Demo-масштаб
// мал — одна страница (`limit=100`) без пролистывания, как personnel/divisions.
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'

type AuditLogsResponse =
  paths['/api/audit/logs/']['get']['responses']['200']['content']['application/json']

export function useAuditLogs() {
  return useQuery<AuditLogsResponse, ApiFailure>({
    queryKey: ['audit', 'logs'],
    queryFn: () => apiClient.get<AuditLogsResponse>('/api/audit/logs/?limit=100'),
  })
}
