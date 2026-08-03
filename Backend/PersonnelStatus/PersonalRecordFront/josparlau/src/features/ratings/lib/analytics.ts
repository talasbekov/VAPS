// Аналитика рейтинга (§22.16-22.17). Чистая модель: ни React, ни apiClient —
// тестируется в env node.
//
// ⚠️ Исполняется ТОЛЬКО на стороне mock-сервера. §22.16 «полностью наследуй
// правила пункта 19»: экран аналитики не считает даже «стандартную» восьмёрку
// (§22.17), поэтому всё, что ниже, — серверная работа.
//
// §22.17 требует УДАЛИТЬ логику прототипа целиком: «Авто-оценок 7»,
// «Стандартных оценок 7», «Последние 90 дней», «Оценок ниже 6», «Руководители с
// необычной долей ручных оценок». Ни одного из этих показателей здесь нет и
// быть не может: три первых — выдуманные константы, а два последних §22.16
// прямо перечисляет среди ЗАПРЕЩЁННЫХ в общем отчёте.
import type { OperationalRatingSummary } from '../model/types'

/**
 * Полосы распределения. Границы ПОЛУОТКРЫТЫЕ (`[from, toExclusive)`), потому
 * что агрегат — дробный: полосы «7–8» и «8–9» с включёнными концами оставили
 * бы 8,6 без полосы вовсе, а 8,0 — сразу в двух.
 *
 * Восьмёрка начинает собственную полосу: §19.1/§22.17 называют её стандартным
 * выполнением, и слив её в «7–9» скрыл бы, сколько людей получили именно норму.
 */
export const DISTRIBUTION_BANDS: readonly {
  code: string
  label: string
  from: number
  toExclusive: number
}[] = [
  { code: 'BAND_BELOW_5', label: 'ниже 5', from: 1, toExclusive: 5 },
  { code: 'BAND_5_7', label: '5,0–6,9', from: 5, toExclusive: 7 },
  { code: 'BAND_7_8', label: '7,0–7,9', from: 7, toExclusive: 8 },
  { code: 'BAND_8_9', label: '8,0–8,9 (стандартное выполнение — 8)', from: 8, toExclusive: 9 },
  // Верхняя полоса замкнута: 10 — конец шкалы, и полуоткрытость оставила бы
  // максимальный балл без полосы.
  { code: 'BAND_9_10', label: '9,0–10', from: 9, toExclusive: 10.0001 },
]

/** Состояние группы в отчёте. `SUPPRESSED` — формулировка §22.17. */
export type RatingGroupState = 'READY' | 'SUPPRESSED' | 'NO_AGGREGATE'

export interface RatingGroupAggregate {
  groupCode: string
  safeLabel: string
  state: RatingGroupState
  /** `null` во всех состояниях, кроме `READY`. Ноль тут запрещён (§19.19). */
  aggregateRating: number | null
  /** Сколько участников группы имеют рассчитанный агрегат. */
  ratedCount: number
  memberCount: number
}

export interface RatingAnalyticsFigures {
  /** §22.16 «количество участников с рассчитанным aggregate». */
  ratedParticipants: number
  /** §22.16 «покрытие оцениванием»: у скольких из участников есть хоть одна
   * учтённая оценка — это НЕ то же, что готовый агрегат. */
  coveredParticipants: number
  totalParticipants: number
  /** §22.16 «количество завершённых процессов без готового aggregate». */
  withoutAggregate: number
  /** §22.16 «количество исправленных оценок в агрегированном виде». */
  correctedEvaluations: number
  distribution: { code: string; label: string; count: number }[]
  groups: RatingGroupAggregate[]
}

function roundAggregate(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Сборка отчёта. `minGroupSize` приходит от policy (§22.17 «privacy
 * suppression приходят от policy»), а не из кода.
 *
 * ПОЧЕМУ В ОТЧЁТЕ НЕТ ОБЩЕГО СРЕДНЕГО ПО ВСЕМ. §22.17: «Не пытайся
 * восстановить скрытое значение из других показателей». Общее среднее вместе
 * с опубликованными средними и размерами остальных групп даёт скрытое
 * значение арифметикой в одну строку — подавление стало бы декорацией. §22.16
 * общего среднего и не требует: в его списке распределение, покрытие и
 * количества, но не одно число «по управлению».
 */
export function buildRatingAnalytics(input: {
  summaries: readonly OperationalRatingSummary[]
  /** Принадлежность участника к группе. Группы — из того же bounded context. */
  groups: readonly { groupCode: string; safeLabel: string; members: readonly string[] }[]
  minGroupSize: number
  correctedEvaluations: number
}): RatingAnalyticsFigures {
  const ready = input.summaries.filter((item) => item.dataState === 'READY')

  const distribution = DISTRIBUTION_BANDS.map((band) => ({
    code: band.code,
    label: band.label,
    count: ready.filter(
      (item) =>
        item.aggregateRating !== null &&
        item.aggregateRating >= band.from &&
        item.aggregateRating < band.toExclusive,
    ).length,
  }))

  const groups = input.groups.map<RatingGroupAggregate>((group) => {
    const members = input.summaries.filter((item) => group.members.includes(item.employeeId))
    const rated = members.filter((item) => item.aggregateRating !== null)
    if (rated.length === 0) {
      // Отдельное состояние: в группе некому считать агрегат — это НЕ
      // «скрыто ради приватности» и тем более не ноль (§19.2).
      return {
        groupCode: group.groupCode,
        safeLabel: group.safeLabel,
        state: 'NO_AGGREGATE',
        aggregateRating: null,
        ratedCount: 0,
        memberCount: members.length,
      }
    }
    if (rated.length < input.minGroupSize) {
      // §22.17: группа мала для безопасной агрегации. Значение не считается
      // вовсе — «посчитать и не показать» оставило бы его в ответе API.
      return {
        groupCode: group.groupCode,
        safeLabel: group.safeLabel,
        state: 'SUPPRESSED',
        aggregateRating: null,
        ratedCount: rated.length,
        memberCount: members.length,
      }
    }
    const sum = rated.reduce((acc, item) => acc + (item.aggregateRating ?? 0), 0)
    return {
      groupCode: group.groupCode,
      safeLabel: group.safeLabel,
      state: 'READY',
      aggregateRating: roundAggregate(sum / rated.length),
      ratedCount: rated.length,
      memberCount: members.length,
    }
  })

  // Порядок групп задаётся по ПОДПИСИ, а не по значению агрегата: список
  // групп, отсортированный по среднему, и есть «место подразделения», прямо
  // запрещённое §22.16.
  groups.sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, 'ru'))

  return {
    ratedParticipants: ready.length,
    coveredParticipants: input.summaries.filter((item) => item.evaluationsCount > 0).length,
    totalParticipants: input.summaries.length,
    withoutAggregate: input.summaries.filter((item) => item.dataState !== 'READY').length,
    correctedEvaluations: input.correctedEvaluations,
    distribution,
    groups,
  }
}
