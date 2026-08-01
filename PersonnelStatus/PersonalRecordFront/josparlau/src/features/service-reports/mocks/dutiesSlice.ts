// Чтение ЧУЖОГО слайса `duties` из общего demo-снапшота (§8.4).
//
// Зачем: «Расход личного состава» (§22.20) строится по сменам дежурств, но
// импорт из `features/duties` красный по ARCH-FE-013. Выборку делает СЕРВЕР —
// вот она: рукописная УЗКАЯ проекция соседнего слайса, третий случай того же
// приёма в проекте (A58 печатная форма, A62 привязка паспорта).
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Отчёт ничего не меняет в чужом агрегате — гвард
// стоит тестом (снимок слайса `duties` до и после генерации).
import type { ReportSourceRow } from '../lib/reporting'

export const DUTIES_SLICE_NAME = 'duties'

/** Ровно те поля смены, которые нужны отчёту. Узость проекции — не экономия:
 * широкая копия чужой модели протухла бы молча при её изменении. */
interface DutyShiftProjection {
  businessDate?: unknown
  employeeName?: unknown
  stateCode?: unknown
  note?: unknown
  overrideReason?: unknown
  target?: { safeLabel?: unknown }
  passportBinding?: { sectorName?: unknown; postName?: unknown } | null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Пустой массив, а не исключение, когда слайса нет: unit-тест сеет только свой
 * слайс — тогда отчёт честно выходит пустым, а не роняет генерацию.
 */
export function readReportSourceRows(
  slices: Readonly<Record<string, unknown>>,
): ReportSourceRow[] {
  const slice = slices[DUTIES_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return []
  const shifts = (slice as { shifts?: unknown }).shifts
  if (!Array.isArray(shifts)) return []

  return (shifts as DutyShiftProjection[]).map((shift) => {
    const binding = shift.passportBinding ?? null
    const sector = binding === null ? '' : asString(binding.sectorName)
    const post = binding === null ? '' : asString(binding.postName)
    return {
      businessDate: asString(shift.businessDate),
      employeeName: asString(shift.employeeName),
      objectLabel: asString(shift.target?.safeLabel),
      // Пост берётся из СНИМКА привязки, а не резолвится сейчас: отчёт обязан
      // показать то, что было зафиксировано при планировании (§9.6).
      postLabel: sector === '' && post === '' ? null : `${sector} · ${post}`,
      stateCode: asString(shift.stateCode),
      note: asNullableString(shift.note),
      overrideReason: asNullableString(shift.overrideReason),
    }
  })
}
