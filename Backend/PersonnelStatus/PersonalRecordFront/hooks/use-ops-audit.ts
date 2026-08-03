"use client";

// Журнал аудита ОМ — только чтение.
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { OPS_AUDIT_LOGS_PATH } from "@/entities/audit-log";
import type { ListOpsAuditLogsResponse } from "@/entities/audit-log";

export function useOpsAuditLogs() {
  return useQuery<ListOpsAuditLogsResponse, OpsApiFailure>({
    queryKey: ["ops-audit-logs"],
    queryFn: () =>
      opsApiClient.get<ListOpsAuditLogsResponse>(OPS_AUDIT_LOGS_PATH),
  });
}
