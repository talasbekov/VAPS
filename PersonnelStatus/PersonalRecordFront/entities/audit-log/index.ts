// Аудит раздела ОМ: read-only журнал действий. Записи создаёт сервер
// (мок-слой) при мутациях — фронт их только читает.
export interface OpsAuditLog {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string;
  createdAt: string;
}

export const OPS_AUDIT_LOGS_PATH = "/api/ops/audit-logs/";

export interface ListOpsAuditLogsResponse {
  results: OpsAuditLog[];
}
