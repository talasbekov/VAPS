// Story 20.6c — org/подразделение-scoped сводка по статусам
// (`GET /api/operations/statuses/summary/`, 20.6b). Тип — из схемы
// (`StatusSummaryResponse`, ARCH-FE-011): бэкенд декорирован `@extend_schema`
// (в отличие от `StaffingTableViewSet`, 20.5c), поэтому здесь типы берутся
// напрямую из `components['schemas']`, ручного зеркала не нужно.
//
// Структурный образец: `overload.ts`/`staffingTable.ts` — тотальный разбор
// (невалидный конверт → `null`), классификация ошибок (400/422 видимы,
// 5xx/сеть/401 молчат).
//
// Русские подписи 11 отчётных колонок — СКОПИРОВАНЫ (не импортированы, тот
// же принцип изоляции, что везде в этом эпике) из уже устоявшихся русских
// формулировок `daily-grid/statusTypes.ts`'s `STATUS_TYPE_OPTIONS` для
// соответствующих кодов (`REPORT_COLUMN_BY_CODE`, Backend strength_report.py).
// `SICK` (агрегирующая report-колонка) → «На больничном», СЛОВО-В-СЛОВО код
// `SICK_LEAVE`'s подпись в `statusTypes.ts` (ревью 20.6c: первый черновик
// сочинил «Болен», разошёлся с уже устоявшимся текстом на соседнем экране).
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'
import type { components } from '../../shared/api/schema'

export type StatusSummaryResponse = components['schemas']['StatusSummaryResponse']

export interface StatusSummary {
  businessDate: string
  divisionId: string | null
  staffTotal: number
  listTotal: number
  vacancies: number
  attached: number
  columns: Record<string, number>
}

/** Фиксированный порядок и русские подписи 11 отчётных колонок
 * (`REPORT_COLUMNS`, Backend strength_report.py:65-77). */
export const REPORT_COLUMN_LABELS: readonly { code: string; label: string }[] = [
  { code: 'SICK', label: 'На больничном' },
  { code: 'VACATION', label: 'В отпуске' },
  { code: 'COMMAND', label: 'В командировке' },
  { code: 'TRAINING', label: 'Учёба/сборы' },
  { code: 'OTHER', label: 'Иное отсутствие' },
  { code: 'DETACHED', label: 'Откомандирован' },
  { code: 'AFTER_DUTY', label: 'После дежурства' },
  { code: 'BEFORE_DUTY', label: 'Перед дежурством' },
  { code: 'ON_DUTY', label: 'На дежурстве' },
  { code: 'PENDING', label: 'Уточняется' },
  { code: 'IN_SERVICE', label: 'В строю' },
]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Тотальный разбор — невалидный конверт даёт `null` (панель показывает
 * честную ошибку загрузки, не пустую/фиктивную сводку). `columns` —
 * построчная фильтрация на числовые значения (мусорный ключ отбрасывается,
 * не роняет весь разбор, тот же приём, что `parseStaffingTableRow`).
 */
export function parseStatusSummary(raw: unknown): StatusSummary | null {
  const envelope = asRecord(raw)
  if (envelope === null) return null
  if (typeof envelope.business_date !== 'string') return null
  if (envelope.division_id !== null && typeof envelope.division_id !== 'string') return null
  if (typeof envelope.staff_total !== 'number') return null
  if (typeof envelope.list_total !== 'number') return null
  if (typeof envelope.vacancies !== 'number') return null
  if (typeof envelope.attached !== 'number') return null
  const rawColumns = asRecord(envelope.columns)
  if (rawColumns === null) return null

  const columns: Record<string, number> = {}
  for (const [key, value] of Object.entries(rawColumns)) {
    if (typeof value === 'number') columns[key] = value
  }

  return {
    businessDate: envelope.business_date,
    divisionId: envelope.division_id,
    staffTotal: envelope.staff_total,
    listTotal: envelope.list_total,
    vacancies: envelope.vacancies,
    attached: envelope.attached,
    columns,
  }
}

export type StatusSummaryFailureKind = 'validation' | 'other' | 'silent'

export interface StatusSummaryFailureDescription {
  kind: StatusSummaryFailureKind
  /** Текст для инлайна; для `silent` — пустой. */
  message: string
}

/** Тот же класс, что `describeOverloadFailure`/`describeStaffingTableFailure`
 * — 400/422 несут точный серверный текст, 5xx/сеть/401 молчат. */
export function describeStatusSummaryFailure(
  error: ApiFailure,
): StatusSummaryFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 400 || error.status === 422) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}
