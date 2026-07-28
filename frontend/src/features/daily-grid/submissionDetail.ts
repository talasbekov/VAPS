// Story 10.6c — контракт GET /daily-submissions/{id}/ на фронте.
//
// Тип — ИЗ схемы (`DailySubmissionDetail`), НЕ рукописное зеркало: в отличие
// от `daySubmission.ts`'s `DaySubmission` (легаси рукописный тип, унаследован
// с ранних стори, не в скоупе исправления здесь), эта стори — новый код,
// ARCH-FE-011 требует схему там, где она есть.
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { components } from '../../shared/api/schema'

export type DaySubmissionDetail = components['schemas']['DailySubmissionDetail']

const EVENTS = new Set(['CONFIRMED_NO_CHANGES', 'CHANGED', 'AMENDED'])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/**
 * Тотализирующий разбор (unknown → безопасный `null` при несовпадении формы,
 * НЕ throw) — зеркало `parseSubmission` (`daySubmission.ts:89-114`), но на 13
 * полях вместо 9. `snapshot` НЕ валидируется по форме (`unknown` в схеме) —
 * панель его не рендерит, только `reason`/`sanction`/`triggered_by_status_id`.
 */
export function parseSubmissionDetail(raw: unknown): DaySubmissionDetail | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.id !== 'number') return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.business_date !== 'string') return null
  if (typeof row.version !== 'number') return null
  if (typeof row.is_current !== 'boolean') return null
  if (typeof row.event !== 'string' || !EVENTS.has(row.event)) return null
  if (typeof row.submitted_by !== 'string') return null
  if (typeof row.submitted_at !== 'string') return null
  if (typeof row.late !== 'boolean') return null
  if (typeof row.reason !== 'string') return null
  if (typeof row.sanction !== 'string') return null
  if (row.triggered_by_status_id !== null && typeof row.triggered_by_status_id !== 'number') {
    return null
  }
  return {
    id: row.id,
    division_id: row.division_id,
    business_date: row.business_date,
    version: row.version,
    is_current: row.is_current,
    event: row.event as DaySubmissionDetail['event'],
    submitted_by: row.submitted_by,
    submitted_at: row.submitted_at,
    late: row.late,
    snapshot: row.snapshot,
    reason: row.reason,
    sanction: row.sanction,
    triggered_by_status_id: row.triggered_by_status_id,
  }
}

/**
 * `null`, если версия НЕ исправлялась (`reason === ""` — модельный дефолт,
 * v1/неисправленная версия), иначе оба поля буквально. Пустая строка НЕ
 * рисуется как «причина» — панель обязана явно назвать «без исправления»
 * (AC-4), не показать пустое место.
 */
export function describeAmendmentReason(
  detail: DaySubmissionDetail,
): { reason: string; sanction: string } | null {
  if (detail.reason === '') return null
  return { reason: detail.reason, sanction: detail.sanction }
}
