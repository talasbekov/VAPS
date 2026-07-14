// Story 9.7 — prefill «вчера» + маппинг дельт в bulk-контракт 3.8. Чистые
// функции (без React/DOM). BulkStatusRequest выровнен с сервисом 3.8
// (_REQUIRED_ROW_KEYS: employee_id, status_type_code, date_start, date_end —
// решение D1 ревью 9.7); HTTP-роут = 10.2/E10 (там же division_id/actor, Q1).
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
  date_start: string
  date_end: string
}

export interface BulkStatusRequest {
  business_date: string
  rows: BulkStatusRow[]
}

/** Дефолт для сотрудника без вчерашней записи (Д1): derived «В строю». */
export const DEFAULT_STATUS = 'IN_SERVICE'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// UTC-математика, не local (урок tz-флейка test_vacancies_endpoint): локальный
// парсер сдвинул бы дату на границе суток в минусовых поясах.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Строки грида, предзаполненные вчерашней расстановкой (правятся отклонения). */
export function buildPrefilledRows(
  employees: EmployeeSeed[],
  yesterday: YesterdayPlacement,
  defaultStatus: string = DEFAULT_STATUS,
): EmployeeRow[] {
  // Самоисцеление входа (прецедент 9.2/9.4): рантайм-ответ E10 может отдать
  // null/undefined вопреки типам — грид не должен ронять страницу.
  const placement = yesterday ?? {}
  const rows: EmployeeRow[] = []
  const seen = new Set<string>()
  for (const e of employees ?? []) {
    // Дубль сотрудника из грязного источника (склейка подразделений/refetch):
    // первый выигрывает — иначе две строки с одним id дают дубль React-key,
    // общий ValueState и двойную дельту, а бэк-3.8 отвергает весь payload 400.
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const y = placement[e.id]
    // || (не ??): пустая строка из грязных вчерашних данных — тоже «нет
    // статуса», иначе она просочилась бы в грид и легла invalid-маркером
    // на невиновную строку (ревью 9.6).
    const yStatus = y?.statusCode || ''
    rows.push({
      id: e.id,
      fullName: e.fullName,
      rank: e.rank,
      statusCode: yStatus || defaultStatus,
      // Период живёт только при живом вчерашнем статусе: статус лёг в дефолт —
      // его осиротевший period не должен уехать date_end уже с ДРУГИМ статусом.
      period: yStatus ? y?.period : undefined,
    })
  }
  return rows
}

/** Дельты грида → bulk-3.8-запрос (ТОЛЬКО отклонения). */
export function toBulkRequest(
  changes: RowChange[],
  businessDate: string,
): BulkStatusRequest {
  return {
    business_date: businessDate,
    rows: changes.map((c) => {
      const period = c.period.trim()
      return {
        employee_id: c.id,
        status_type_code: c.statusCode,
        date_start: businessDate,
        // Полуинтервал бэка [s, e): UI-период «по … включительно» → +1 день;
        // пусто → статус на один день [businessDate, businessDate+1).
        // Не-ISO мусор уходит как есть — громкий 422 бэка вместо тихого
        // Invalid Date (полная валидация периода = date-редактор E10).
        date_end: ISO_DATE_RE.test(period)
          ? addDaysIso(period, 1)
          : period || addDaysIso(businessDate, 1),
      }
    }),
  }
}
