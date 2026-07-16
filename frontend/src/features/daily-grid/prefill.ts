// Story 9.7 — prefill «вчера» + маппинг дельт в bulk-контракт 3.8. Чистые
// функции (без React/DOM). BulkStatusRequest выровнен с сервисом 3.8
// (_REQUIRED_ROW_KEYS: employee_id, status_type_code, date_start, date_end —
// решение D1 ревью 9.7). Story 10.2 — fromGridPrefill: живой ответ GET
// grid-prefill (10.1b + status_types 10.2 AC-1) → входы грида.
import type { paths } from '../../shared/api/schema'
import type { EmployeeRow, RowChange, StatusOption } from './DailyGrid.types'

/** Живой контракт ответа grid-prefill (ARCH-FE-011: тип — из schema.d.ts). */
export type GridPrefillResponse =
  paths['/api/operations/statuses/grid-prefill/']['get']['responses']['200']['content']['application/json']

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

// type, не interface (10.2): type-литерал несёт неявную index-сигнатуру и
// проходит constraint `TVariables extends Record<string, unknown>` хука
// useApiMutation (interface — нет); форма не изменилась.
export type BulkStatusRow = {
  employee_id: string
  status_type_code: string
  date_start: string
  date_end: string
}

export type BulkStatusRequest = {
  business_date: string
  rows: BulkStatusRow[]
}

/** Дефолт для сотрудника без вчерашней записи (Д1): derived «В строю». */
export const DEFAULT_STATUS = 'IN_SERVICE'

/** ISO-дата `YYYY-MM-DD`. Экспорт (ревью 10.2, дедуп): страница гейтит ввод
 * date-input тем же регэкспом, что и период здесь — не дублировать. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Сегодняшняя ЛОКАЛЬНАЯ дата (дефолт date-input экрана — Решение №6 10.2).
 * ТОЛЬКО дефолт берёт локальные геттеры (осознанно, НЕ UTC-срез: оператор
 * живёт в местных сутках); вся АРИФМЕТИКА дат — addDaysIso (UTC, урок
 * tz-флейка test_vacancies_endpoint). */
export function todayLocalIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

// UTC-математика, не local (урок tz-флейка test_vacancies_endpoint): локальный
// парсер сдвинул бы дату на границе суток в минусовых поясах. Экспорт (10.2):
// страница считает prefill-дату «выбранная − 1» тем же кодом — не дублировать.
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Выходы маппера ответа grid-prefill — ровно входы DailyGridContainer. */
export interface GridPrefillMapped {
  employees: EmployeeSeed[]
  yesterday: YesterdayPlacement
  statusOptions: StatusOption[]
}

/**
 * Живой ответ grid-prefill → входы грида (10.2 AC-3, от raise-сайтов бэка):
 * - `full_name→fullName`; `rank: ""` → undefined (контракт P4 ревью 10.1b);
 * - победитель при 2+ строках статусов сотрудника = ПЕРВАЯ строка серверного
 *   порядка `(employee_id, status_type_code, date_start)` (P2; Решение №3);
 * - период: полуинтервал `[)` бэка → UI «по … включительно» = `date_end − 1`;
 *   однодневный интервал (`date_end = date_start + 1`) → period пуст;
 * - `status_types` → `StatusOption[]` (`name→label`), порядок сервера.
 */
export function fromGridPrefill(response: GridPrefillResponse): GridPrefillMapped {
  const employees: EmployeeSeed[] = (response.employees ?? []).map((e) => ({
    id: e.id,
    fullName: e.full_name,
    // "" и null — одинаково «нет звания» (P4: бэк шлёт "" при пустом коде).
    rank: e.rank ? e.rank : undefined,
  }))
  const yesterday: YesterdayPlacement = {}
  for (const s of response.statuses ?? []) {
    if (yesterday[s.employee_id]) continue // первая строка выигрывает (№3)
    const inclusiveEnd = addDaysIso(s.date_end, -1)
    yesterday[s.employee_id] = {
      statusCode: s.status_type_code,
      period: inclusiveEnd === s.date_start ? undefined : inclusiveEnd,
    }
  }
  const statusOptions: StatusOption[] = (response.status_types ?? []).map(
    (t) => ({ code: t.code, label: t.name }),
  )
  return { employees, yesterday, statusOptions }
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
