// Story 9.7 — prefill «вчера» + маппинг дельт в bulk-контракт 3.8. Чистые
// функции (без React/DOM). BulkStatusRequest — ФРОНТ-КОНТРАКТ: HTTP-роут bulk
// (3.8) в схеме пока нет, реальный вызов/типизация из схемы = 10.2/E10.
import type { EmployeeRow, RowChange } from './DailyGrid.types'

export interface EmployeeSeed {
  id: string
  fullName: string
  rank?: string
}

/** Вчерашняя расстановка: employee_id → значение статуса/периода. */
export type YesterdayPlacement = Record<
  string,
  { statusCode: string; period?: string }
>

export interface BulkStatusRow {
  employee_id: string
  status_type_code: string
  date_end?: string
}

export interface BulkStatusRequest {
  business_date: string
  rows: BulkStatusRow[]
}

/** Дефолт для сотрудника без вчерашней записи (Д1): derived «В строю». */
export const DEFAULT_STATUS = 'IN_SERVICE'

/** Строки грида, предзаполненные вчерашней расстановкой (правятся отклонения). */
export function buildPrefilledRows(
  employees: EmployeeSeed[],
  yesterday: YesterdayPlacement,
  defaultStatus: string = DEFAULT_STATUS,
): EmployeeRow[] {
  return employees.map((e) => {
    const y = yesterday[e.id]
    return {
      id: e.id,
      fullName: e.fullName,
      rank: e.rank,
      // || (не ??): пустая строка из грязных вчерашних данных — тоже «нет
      // статуса», иначе она просочилась бы в грид и легла invalid-маркером
      // на невиновную строку (ревью 9.6).
      statusCode: y?.statusCode || defaultStatus,
      period: y?.period,
    }
  })
}

/** Дельты грида → bulk-3.8-запрос (ТОЛЬКО отклонения; period → date_end). */
export function toBulkRequest(
  changes: RowChange[],
  businessDate: string,
): BulkStatusRequest {
  return {
    business_date: businessDate,
    rows: changes.map((c) => ({
      employee_id: c.id,
      status_type_code: c.statusCode,
      ...(c.period ? { date_end: c.period } : {}),
    })),
  }
}
