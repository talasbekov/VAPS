"use client";

// Журнал аудита ОМ — только чтение.
import { opsApiClient } from "@/lib/ops-api";
import { useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { OPS_AUDIT_LOGS_PATH } from "@/entities/audit-log";
import type { ListOpsAuditLogsResponse } from "@/entities/audit-log";

export function useOpsAuditLogs() {
  const access = useOpsReadAccess("audit.view");
  return useOpsProtectedRead<ListOpsAuditLogsResponse>(["ops-audit-logs", "feed"], [], access,
    () => opsApiClient.get<ListOpsAuditLogsResponse>(OPS_AUDIT_LOGS_PATH), { staleTime: 60_000 });
}
