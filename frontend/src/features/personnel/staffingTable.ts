// Story 20.5c — штатное расписание (`GET /api/core/staffing-table/`, 20.5b).
//
// Исключение из «типы только из схемы» (ARCH-FE-011, тот же класс, что
// `expense.ts`'s конверт ошибки): `StaffingTableViewSet` — голый
// `viewsets.ViewSet` БЕЗ `@extend_schema` (структурный образец
// `VacancyViewSet`, established convention того же файла), схема несёт
// «No response body» — типы здесь ручные, разбор ТОТАЛЬНЫЙ (рантайм —
// единственная гарантия формы).
//
// Структурный образец: `overload.ts` (20.3c) — тотальный разбор
// (невалидный конверт → `null`), классификация ошибок (400/422 видимы,
// 5xx/сеть/401 молчат).
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'

export interface StaffingTableRow {
  division_id: string
  position_code: string
  position_name: string
  allocated: number
  filled: number
  vacant: number
}

export interface StaffingTable {
  businessDate: string
  count: number
  rows: StaffingTableRow[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseStaffingTableRow(raw: unknown): StaffingTableRow | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.position_code !== 'string') return null
  if (typeof row.position_name !== 'string') return null
  if (typeof row.allocated !== 'number') return null
  if (typeof row.filled !== 'number') return null
  if (typeof row.vacant !== 'number') return null
  return {
    division_id: row.division_id,
    position_code: row.position_code,
    position_name: row.position_name,
    allocated: row.allocated,
    filled: row.filled,
    vacant: row.vacant,
  }
}

/**
 * Тотальный разбор — невалидный конверт даёт `null` (страница показывает
 * честную ошибку загрузки, не пустую/фиктивную таблицу). Мусорная строка
 * внутри `results` отбрасывается построчно (тот же приём, что
 * `parseOverloadSummary`), остальные строки не страдают.
 */
export function parseStaffingTable(raw: unknown): StaffingTable | null {
  const envelope = asRecord(raw)
  if (envelope === null) return null
  if (typeof envelope.business_date !== 'string') return null
  if (typeof envelope.count !== 'number') return null
  if (!Array.isArray(envelope.results)) return null

  const rows: StaffingTableRow[] = []
  for (const item of envelope.results) {
    const parsed = parseStaffingTableRow(item)
    if (parsed !== null) rows.push(parsed)
  }

  return {
    businessDate: envelope.business_date,
    count: envelope.count,
    rows,
  }
}

export type StaffingTableFailureKind = 'validation' | 'other' | 'silent'

export interface StaffingTableFailureDescription {
  kind: StaffingTableFailureKind
  /** Текст для инлайна; для `silent` — пустой. */
  message: string
}

/** Тот же класс, что `describeOverloadFailure`/`describeExpenseDashboardFailure`
 * — 400/422 несут точный серверный текст, 5xx/сеть/401 молчат. Здесь это
 * ЕДИНСТВЕННЫЙ контент страницы (не панель-обогащение внутри другого
 * экрана) — тихая ошибка означает пустую страницу с одними контролами,
 * тот же контракт, что уже принят для этого класса ошибок в проекте. */
export function describeStaffingTableFailure(
  error: ApiFailure,
): StaffingTableFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 400 || error.status === 422) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}
