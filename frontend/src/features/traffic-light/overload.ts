// Story 20.3c — org-division-scoped дашборд перегрузки
// (`GET /api/operations/load/summary/`, 20.3b). Типы — из схемы
// (`OverloadSummaryResponse`/`OverloadSummaryEmployee`, ARCH-FE-011).
//
// Структурный образец: `expense.ts`'s `parseExpenseDashboard`/
// `describeExpenseDashboardFailure` (Story 20.2c) — тотальный разбор
// (невалидный конверт → `null`), классификация ошибок (400/422 видимы,
// 5xx/сеть/401 молчат — панель обогащение, не первичный сигнал экрана).
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'
import type { components } from '../../shared/api/schema'

export type OverloadSummaryEmployee = components['schemas']['OverloadSummaryEmployee']

export interface OverloadSummary {
  divisionId: string
  dateFrom: string
  dateTo: string
  employees: OverloadSummaryEmployee[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseOverloadEmployee(raw: unknown): OverloadSummaryEmployee | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.employee_id !== 'string') return null
  if (!Array.isArray(row.overload_days)) return null
  const overloadDays: string[] = []
  for (const day of row.overload_days) {
    if (typeof day === 'string') overloadDays.push(day)
  }
  return { employee_id: row.employee_id, overload_days: overloadDays }
}

/**
 * Тотальный разбор — невалидный конверт даёт `null` (панель показывает
 * честную ошибку загрузки, не пустой/фиктивный список). Мусорная строка
 * внутри `employees` отбрасывается построчно (тот же приём, что
 * `parseExpenseDashboard`), остальные строки не страдают.
 */
export function parseOverloadSummary(raw: unknown): OverloadSummary | null {
  const envelope = asRecord(raw)
  if (envelope === null) return null
  if (typeof envelope.division_id !== 'string') return null
  if (typeof envelope.date_from !== 'string') return null
  if (typeof envelope.date_to !== 'string') return null
  if (!Array.isArray(envelope.employees)) return null

  const employees: OverloadSummaryEmployee[] = []
  for (const item of envelope.employees) {
    const parsed = parseOverloadEmployee(item)
    if (parsed !== null) employees.push(parsed)
  }

  return {
    divisionId: envelope.division_id,
    dateFrom: envelope.date_from,
    dateTo: envelope.date_to,
    employees,
  }
}

/**
 * Русское склонение «день/дня/дней» (ревью 20.3c: `n === 1 ? 'день' : 'дней'`
 * даёт грамматически неверное «2 дней»/«3 дней»/«4 дней» — частый случай при
 * дефолтном 7-дневном окне). Стандартное правило: 11-14 всегда «дней»,
 * иначе последняя цифра решает (1→день, 2-4→дня, 0/5-9→дней).
 */
export function daysWord(n: number): string {
  const abs = Math.abs(n)
  const lastTwo = abs % 100
  const last = abs % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'дней'
  if (last === 1) return 'день'
  if (last >= 2 && last <= 4) return 'дня'
  return 'дней'
}

export type OverloadFailureKind = 'validation' | 'other' | 'silent'

export interface OverloadFailureDescription {
  kind: OverloadFailureKind
  /** Текст для инлайна; для `silent` — пустой. */
  message: string
}

/** Тот же класс, что `describeExpenseDashboardFailure` — 400/422 несут точный
 * серверный текст, 5xx/сеть/401 молчат (панель — обогащение, не первичный
 * сигнал экрана `/organization`, дерево остаётся основным). */
export function describeOverloadFailure(error: ApiFailure): OverloadFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 400 || error.status === 422) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}
