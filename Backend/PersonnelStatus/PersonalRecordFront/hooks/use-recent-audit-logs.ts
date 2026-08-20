import { useQuery } from "@tanstack/react-query"
import { apiClient, OpsApiError, type OpsAuditLogEntry } from "@/lib/api"

export function useRecentAuditLogs(limit: number = 4) {
  return useQuery<OpsAuditLogEntry[], OpsApiError>({
    queryKey: ["operations-audit-logs", limit],
    queryFn: () => apiClient.getRecentAuditLogs(limit),
  })
}
