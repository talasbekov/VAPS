// Story 10.6b — контракт GET /daily-submissions/freshness/ на фронте.
//
// Типы — ИЗ схемы (`SummaryFreshnessResponse`, добавлена 10.6a), НЕ рукописное
// зеркало: в отличие от `amendment.ts` (где зеркало было вынужденным по
// историческим причинам той стори), здесь схема свежая и полная — ARCH-FE-011
// требует переиспользовать её без исключений.
//
// ⚠️ Свежесть — ОТДЕЛЬНАЯ ось от цвета светофора (5-11:97, sprint-status.yaml:420):
// этот модуль НЕ читает TrafficLightStatus ни в каком виде. Источник
// исключительно ответ `/freshness/`.
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { components } from '../../shared/api/schema'

export type SummaryFreshness = components['schemas']['SummaryFreshnessResponse']

const STATUS_VALUES = new Set(['FRESH', 'STALE', 'NOT_SUMMARY'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSupersededEntry(
  value: unknown,
): value is { division_id: string; pinned_version: number; current_version: number } {
  return (
    isRecord(value) &&
    typeof value.division_id === 'string' &&
    typeof value.pinned_version === 'number' &&
    typeof value.current_version === 'number'
  )
}

function isMissingEntry(
  value: unknown,
): value is { division_id: string; pinned_version: number } {
  return (
    isRecord(value) && typeof value.division_id === 'string' && typeof value.pinned_version === 'number'
  )
}

/**
 * Тотализирующий разбор (unknown → безопасный `null` при несовпадении формы,
 * НЕ throw) — зеркало `parseSubmissionList`/`parseTrafficLightTree`. Мусорный
 * `status` вне трёх литералов, неверно типизированные оси или нестроковый
 * элемент `unpinned` → `null` (панель просто ничего не покажет — enrichment,
 * не первичный сигнал).
 */
export function parseSummaryFreshness(raw: unknown): SummaryFreshness | null {
  if (!isRecord(raw)) return null
  if (typeof raw.status !== 'string' || !STATUS_VALUES.has(raw.status)) return null
  if (!Array.isArray(raw.superseded) || !raw.superseded.every(isSupersededEntry)) return null
  if (!Array.isArray(raw.missing) || !raw.missing.every(isMissingEntry)) return null
  if (!Array.isArray(raw.unpinned) || !raw.unpinned.every((v) => typeof v === 'string')) {
    return null
  }
  return {
    status: raw.status as SummaryFreshness['status'],
    superseded: raw.superseded,
    missing: raw.missing,
    unpinned: raw.unpinned,
  }
}

/** Родительный падеж числительного для «подразделение» (1/2-4/5+, зеркало РЯ-склонения). */
function divisionWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'подразделение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'подразделения'
  return 'подразделений'
}

/**
 * Человеческие строки по трём осям расхождения — НЕ JSON-дамп, НЕ имена
 * подразделений (у ответа `/freshness/` их нет; резолвить их сюда — вне
 * скоупа, это индикатор наличия расхождения, не детальный дифф).
 *
 * Пустой массив, если все три оси пусты — защита от вызова на не-STALE
 * (не доверяем инварианту бэка «STALE ⇒ хотя бы одна ось непуста» вслепую,
 * тот же принцип, что 10.3b Dev Notes про all-empty drift).
 */
export function describeStaleness(freshness: SummaryFreshness): string[] {
  const lines: string[] = []
  if (freshness.superseded.length > 0) {
    const n = freshness.superseded.length
    // Согласование числа сказуемого с подлежащим (Edge Case Hunter, 10.6b
    // ревью): «1 подразделение» — ед.ч., ср.р. ⇒ «пересдало», не «пересдали».
    const verb = divisionWord(n) === 'подразделение' ? 'пересдало' : 'пересдали'
    lines.push(`${n} ${divisionWord(n)} ${verb} после сборки сводки`)
  }
  if (freshness.missing.length > 0) {
    const n = freshness.missing.length
    lines.push(`${n} ${divisionWord(n)} без действующей сдачи`)
  }
  if (freshness.unpinned.length > 0) {
    const n = freshness.unpinned.length
    lines.push(`${n} нов${n === 1 ? 'ое' : 'ых'} ${divisionWord(n)} вне сводки`)
  }
  return lines
}
