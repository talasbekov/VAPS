// Аудит (§29 мастер-промпта). Тип — ИЗ СХЕМЫ (ARCH-FE-011), `/api/audit/logs/`
// существующая (`existing`) donor-схема, не pending-contract.
import type { paths } from '../../../shared/api/schema'

export type AuditLog =
  paths['/api/audit/logs/']['get']['responses']['200']['content']['application/json']['results'][number]
