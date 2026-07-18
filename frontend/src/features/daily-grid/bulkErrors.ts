// Story 10.2 — мапперы отказа bulk-роута в то, что экран может показать.
// Чистые функции: ни React, ни apiClient (тестируются в env node).
//
// Форма построчных причин — из ЖИВОГО raise-сайта сервиса 3.8
// (Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py:219-238):
//   details.rows[] = [{index, employee_id, code, http_status, message}]
// Это НЕ details.conflicts[], который умеет рендерить общий ConflictList —
// ещё одна причина не звать ConflictDialog (Решение №4 стори).
import type { ApiFailure } from '../../shared/api/errors'

/** Одна отклонённая строка массового обновления (§36 details.rows[]). */
export interface BulkRowError {
  index: number
  employeeId: string
  code: string
  httpStatus: number
  message: string
}

/** Канал отображения отказа на экране (AC-10). */
export type BulkFailureKind = 'rows' | 'permission' | 'validation' | 'silent'

export interface BulkFailureDescription {
  kind: BulkFailureKind
  /** Текст для инлайна; для `silent` — пустой (экран ничего не рисует). */
  message: string
}

/** 403 на записи: гейт экрана — daily_report.mark_update, запись — status.manage. */
export const PERMISSION_MESSAGE =
  'Недостаточно прав на запись статусов. Требуется право status.manage.'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/**
 * `ApiError.details` типизирован `Record<string, unknown>` — читаем ЗАЩИТНО:
 * не массив / не объекты / отсутствующие ключи отбрасываются построчно, без
 * исключений. Пустой результат = «построчных причин нет» (панель покажет один
 * заголовок конверта), а не «ошибки не было».
 */
export function parseBulkRowErrors(error: unknown): BulkRowError[] {
  const details = asRecord(asRecord(error)?.details)
  if (details === null) return []
  const rows = details.rows
  if (!Array.isArray(rows)) return []
  const parsed: BulkRowError[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (row === null) continue
    // index/employee_id/message — несущие поля строки: без них строку нельзя ни
    // показать, ни привязать к сотруднику. code/http_status — необязательные.
    if (typeof row.index !== 'number') continue
    if (typeof row.employee_id !== 'string') continue
    if (typeof row.message !== 'string') continue
    parsed.push({
      index: row.index,
      employeeId: row.employee_id,
      code: typeof row.code === 'string' ? row.code : '',
      httpStatus: typeof row.http_status === 'number' ? row.http_status : 0,
      message: row.message,
    })
  }
  return parsed
}

/**
 * Канал отображения по ARCH-FE-015 — БЕЗ дублирования уже обслуженных каналов:
 * 5xx и обрыв сети уже показал общий тост useApiMutation, 401 уже увела цепь
 * logout в providers → `silent`, экран молчит.
 *
 * Ветвление по `kind` для сети и по `status` дальше — НЕ по `instanceof
 * ApiError`: NetworkError живёт ВНЕ иерархии ApiError (Ловушка 4 стори).
 * Функция тотальна: любой неучтённый статус попадает в `rows` (инлайн-панель с
 * текстом конверта) — молчаливой дыры «отказ был, экран пуст» нет.
 */
export function describeBulkFailure(error: ApiFailure): BulkFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) return { kind: 'permission', message: PERMISSION_MESSAGE }
  if (error.status === 400) return { kind: 'validation', message: error.message }
  return { kind: 'rows', message: error.message }
}

/**
 * 400 VALIDATION_ERROR: DRF-details по полям → плоские строки для инлайн-списка
 * (AC-10). Форма details у DRF разнородна (строка / массив строк / вложенный
 * объект) — читаем защитно, нечитаемое молча пропускаем.
 */
export function parseValidationDetails(error: unknown): string[] {
  const details = asRecord(asRecord(error)?.details)
  if (details === null) return []
  const lines: string[] = []
  for (const [field, value] of Object.entries(details)) {
    if (typeof value === 'string') {
      lines.push(`${field}: ${value}`)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') lines.push(`${field}: ${item}`)
      }
    }
  }
  return lines
}
