// Стор аудита ОМ: записи создают САМИ мок-операции (appendAudit из
// handlers мутаций) — журнал отражает реально сделанное в демо, а не
// фиксированную витрину. Read-only для фронта.
import { http, HttpResponse } from "msw";
import { OPS_AUDIT_LOGS_PATH } from "@/entities/audit-log";
import type { OpsAuditLog } from "@/entities/audit-log";

const STORE_KEY = "ops-mock-audit-logs";

function nowIso(): string {
  return new Date().toISOString();
}

/** Стартовые записи — прошлые действия демо-мира. */
function buildSeed(): OpsAuditLog[] {
  return [
    {
      id: "audit-seed-1",
      actorUserId: "demo-admin",
      action: "object.passport.publish",
      entityType: "SecurityObject",
      entityId: "OBJ-001",
      oldValue: null,
      newValue: { versionNumber: 1 },
      reason: "",
      createdAt: "2026-07-20T08:00:00.000Z",
    },
    {
      id: "audit-seed-2",
      actorUserId: "demo-admin",
      action: "security_event.create",
      entityType: "SecurityEvent",
      entityId: "ОМ-2026-1",
      oldValue: null,
      newValue: { title: "Визит иностранной делегации" },
      reason: "",
      createdAt: "2026-07-25T09:15:00.000Z",
    },
  ];
}

let logs: OpsAuditLog[] | null = null;
let seq = 0;

function getLogs(): OpsAuditLog[] {
  if (logs === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      logs = raw === null ? buildSeed() : (JSON.parse(raw) as OpsAuditLog[]);
    } catch {
      logs = buildSeed();
    }
  }
  return logs;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(logs));
  } catch {
    // квота/приватный режим — живём в памяти документа
  }
}

/** Запись действия — вызывается handler-ами мутаций, не фронтом. */
export function appendAudit(entry: {
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  reason?: string;
}): void {
  seq += 1;
  logs = [
    {
      id: `audit-${Date.now()}-${seq}`,
      actorUserId: "demo-admin",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? "",
      createdAt: nowIso(),
    },
    ...getLogs(),
  ];
  persist();
}

export const auditHandlers = [
  http.get(`*${OPS_AUDIT_LOGS_PATH}`, () =>
    HttpResponse.json({ results: getLogs() })
  ),
];
