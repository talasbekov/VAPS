// Чтение ЧУЖОГО слайса `ratings` из общего demo-снапшота (§8.4) — узкая
// проекция, тот же приём, что у аналитики, объектов, дежурств и отчётов:
// импорт из `features/ratings` красный по ARCH-FE-013, поэтому выборку делает
// СЕРВЕР расстановки.
//
// ⚠️ ЧИТАЕТСЯ ТОЛЬКО ЗАПИСАННЫЙ АГРЕГАТ. Проекция не касается поля
// `evaluations` ни одной строкой: §19.24 разрешает расстановке видеть лишь
// краткую сводку, а §19.21 закрывает оценки, оценщиков и комментарии. Даже
// «посчитать среднее самому» здесь запрещено дважды — §19.19 отдаёт расчёт
// агрегата репозиторию рейтинга, и второй расчёт в другой фиче разошёлся бы
// с первым молча.
//
// Поэтому источник сводки — ТОЧКИ ДИНАМИКИ (§19.20): записанные сервером
// агрегаты закрытых периодов. Берётся последний закрытый период: у него уже
// есть значение, версия методики и время фиксации — ровно тот набор, который
// §19.24 разрешает показать при расстановке.

export const RATINGS_SLICE_NAME = 'ratings'

/**
 * Состояние сводки при расстановке.
 *
 * `NOT_RECORDED` отделено от `INSUFFICIENT_DATA` намеренно: «точку не считали
 * вовсе» и «посчитали, но оценок не хватило» — разные факты, и §19.2 запрещает
 * сводить оба к нулю. `CONFLICTS_DISABLED` — не состояние данных, а честный
 * ответ «требование поста сейчас не проверяется» (§19.3
 * `ENABLE_RATING_CONFLICTS=false`).
 */
export type PlacementRatingState =
  | 'READY'
  | 'INSUFFICIENT_DATA'
  | 'NOT_RECORDED'
  | 'FEATURE_DISABLED'

export interface PlacementRatingProjection {
  employeeId: string
  aggregateRating: number | null
  evaluationsCount: number
  /** Версия методики ТОЙ точки, по которой сложилось значение (§19.24). */
  policyVersion: string | null
  /** Когда сервер зафиксировал агрегат. `null` — фиксации не было. */
  calculatedAt: string | null
  /** Период записанного агрегата (напр. `2026-06`). */
  period: string | null
  state: PlacementRatingState
}

export interface RatingCapabilitiesProjection {
  operationalRatings: boolean
  ratingConflicts: boolean
}

interface PointProjection {
  employeeId?: unknown
  period?: unknown
  aggregateRating?: unknown
  evaluationsCount?: unknown
  policyVersion?: unknown
  recordedAt?: unknown
}

function readRawSlice(slices: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const slice = slices[RATINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  return slice as Record<string, unknown>
}

/**
 * Флаги §19.3. Отсутствие слайса — ВЫКЛЮЧЕНО, а не «включено по умолчанию»:
 * молча включённая проверка требовала бы обоснования обхода там, где рейтинга
 * в сборке нет вовсе.
 */
export function readRatingCapabilities(
  slices: Readonly<Record<string, unknown>>,
): RatingCapabilitiesProjection {
  const slice = readRawSlice(slices)
  const raw = slice === null ? null : slice.capabilities
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { operationalRatings: false, ratingConflicts: false }
  }
  const capabilities = raw as Record<string, unknown>
  return {
    operationalRatings: capabilities.operationalRatings === true,
    ratingConflicts: capabilities.ratingConflicts === true,
  }
}

/**
 * Сводка по одному сотруднику. Ни одно поле оценки сюда не попадает — в
 * проекции их неоткуда взять.
 */
export function readPlacementRating(
  slices: Readonly<Record<string, unknown>>,
  employeeId: string,
): PlacementRatingProjection {
  const capabilities = readRatingCapabilities(slices)
  const empty = (state: PlacementRatingState): PlacementRatingProjection => ({
    employeeId,
    aggregateRating: null,
    evaluationsCount: 0,
    policyVersion: null,
    calculatedAt: null,
    period: null,
    state,
  })
  // Выключенная функция не превращает рейтинг в отсутствующий: это разные
  // причины, и §19.3 требует называть именно её («не отображается как 0»).
  if (!capabilities.operationalRatings) return empty('FEATURE_DISABLED')

  const slice = readRawSlice(slices)
  const points = slice === null ? null : slice.dynamicsPoints
  if (!Array.isArray(points)) return empty('NOT_RECORDED')

  let latest: PointProjection | null = null
  for (const item of points as PointProjection[]) {
    if (item.employeeId !== employeeId) continue
    if (typeof item.period !== 'string') continue
    if (latest === null || item.period > (latest.period as string)) latest = item
  }
  if (latest === null) return empty('NOT_RECORDED')

  const count = typeof latest.evaluationsCount === 'number' ? latest.evaluationsCount : 0
  const policyVersion = typeof latest.policyVersion === 'string' ? latest.policyVersion : null
  const calculatedAt = typeof latest.recordedAt === 'string' ? latest.recordedAt : null
  const period = latest.period as string
  if (typeof latest.aggregateRating !== 'number') {
    return {
      employeeId,
      aggregateRating: null,
      evaluationsCount: count,
      policyVersion,
      calculatedAt,
      period,
      state: 'INSUFFICIENT_DATA',
    }
  }
  return {
    employeeId,
    aggregateRating: latest.aggregateRating,
    evaluationsCount: count,
    policyVersion,
    calculatedAt,
    period,
    state: 'READY',
  }
}
