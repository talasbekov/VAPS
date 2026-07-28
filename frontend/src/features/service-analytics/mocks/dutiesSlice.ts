// Чтение ЧУЖОГО слайса `duties` из общего demo-снапшота (§8.4).
//
// Четвёртый случай того же приёма в проекте (A58 печатная форма, A62 привязка
// паспорта, отчётный реестр): импорт из `features/duties` красный по
// ARCH-FE-013, поэтому выборку делает СЕРВЕР — рукописная УЗКАЯ проекция
// соседнего слайса.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Аналитика ничего не меняет в чужом агрегате.
import type { AnalyticsSource } from '../lib/analytics'
import { readRestAfterDutyMode } from './settingsSlice'

export const DUTIES_SLICE_NAME = 'duties'

interface ShiftProjection {
  id?: unknown
  businessDate?: unknown
  employeeName?: unknown
  stateCode?: unknown
  dutyTypeCode?: unknown
  actualStart?: unknown
  actualEnd?: unknown
  updatedAt?: unknown
  target?: { safeLabel?: unknown }
}

interface TypeProjection {
  dutyTypeCode?: unknown
  restAfterMinutes?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * `null`, а НЕ пустой массив, когда слайса нет.
 *
 * Разница принципиальная и видна на экране: пустой массив означает «смен нет» и
 * даёт честный ноль, отсутствие источника означает «посчитать не удалось» и
 * обязано дать `UNKNOWN` (§22.4 запрещает заменять неизвестность зелёным, §35 —
 * подменять её нулём). В отчётном реестре тот же случай решён иначе
 * осознанно: там пустой отчёт — правда, здесь ноль конфликтов — ложь.
 */
export function readAnalyticsSource(
  slices: Readonly<Record<string, unknown>>,
): AnalyticsSource | null {
  const slice = slices[DUTIES_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const rawShifts = (slice as { shifts?: unknown }).shifts
  const rawTypes = (slice as { dutyTypes?: unknown }).dutyTypes
  if (!Array.isArray(rawShifts) || !Array.isArray(rawTypes)) return null

  const shifts = (rawShifts as ShiftProjection[]).map((shift) => ({
    id: asString(shift.id),
    businessDate: asString(shift.businessDate),
    employeeName: asString(shift.employeeName),
    objectLabel: asString(shift.target?.safeLabel),
    stateCode: asString(shift.stateCode),
    dutyTypeCode: asString(shift.dutyTypeCode),
    actualStart: asNullableString(shift.actualStart),
    actualEnd: asNullableString(shift.actualEnd),
    updatedAt: asString(shift.updatedAt),
  }))

  const dutyTypes = (rawTypes as TypeProjection[]).map((type) => ({
    dutyTypeCode: asString(type.dutyTypeCode),
    restAfterMinutes: typeof type.restAfterMinutes === 'number' ? type.restAfterMinutes : 0,
  }))

  // Режим отдыха приходит из ЧУЖОГО слайса настроек — аналитика и планирование
  // читают одну политику (§21.35), иначе один конфликт был бы жёстким на плане
  // и мягким в аналитике.
  return { shifts, dutyTypes, restMode: readRestAfterDutyMode(slices) }
}
