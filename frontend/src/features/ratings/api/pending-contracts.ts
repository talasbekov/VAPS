// Pending-контракты оперативного рейтинга (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
//
// ⚠️ Путь грепнут по всему `src` до заведения: коллизия путей в MSW
// разрешается молча в пользу первого handler'а (инцидент Этапа 39).
//
// В ответе НЕТ и не может появиться ни одного поля закрытых данных: ни score
// отдельной оценки, ни оценщика, ни комментария (§19.21 «закрытость должна
// обеспечиваться API, а не только скрытием колонок»). Это свойство ответа
// закреплено тестом по ВСЕМУ JSON, а не по знакомым именам полей.
import type {
  OperationalRatingSummary,
  RatingDynamicsPoint,
  RatingPolicy,
  RatingPolicyBoundary,
} from '../model/types'
import type { RatingAnalyticsFigures } from '../lib/analytics'

export const OPERATIONAL_RATINGS_PATH = '/api/ops/operational-ratings/'
/**
 * Динамика (§19.20) живёт на СВОЁМ пути, а не хвостом под путём сводки:
 * коллизия путей в MSW разрешается молча в пользу первого handler'а, поэтому
 * путь до заведения грепнут по всему `src` (инцидент Этапа 39).
 */
export const OPERATIONAL_RATING_DYNAMICS_PATH = '/api/ops/operational-rating-dynamics/'
/** Отчёт аналитики рейтинга §22.16 — свой путь и СВОЁ право (`ops.analytics.view`). */
export const RATING_ANALYTICS_PATH = '/api/ops/rating-analytics/'

/** §35: чего в расчёте нет и почему. Форма та же, что у блоков аналитики. */
export interface UnavailableRatingFactor {
  code: string
  label: string
  reason: string
}

export interface ListOperationalRatingsResponse {
  results: OperationalRatingSummary[]
  /** `null` — методика не определена (§19.19). Тогда у всех сводок
   * `dataState: POLICY_UNDEFINED`, а не нулевой рейтинг. */
  policy: RatingPolicy | null
  /** §19.3: состояние feature flags решает СЕРВЕР и называет их прямо. */
  capabilities: { operationalRatings: boolean; ratingConflicts: boolean }
  /** §35-блоки: факторы, не участвующие в расчёте, и нереализованные части §19. */
  unavailableFactors: UnavailableRatingFactor[]
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Отчёт аналитики рейтинга (§22.16-22.17).
 *
 * ⚠️ ОБЩЕГО СРЕДНЕГО В ОТВЕТЕ НЕТ И НЕ ДОЛЖНО ПОЯВИТЬСЯ: вместе с
 * опубликованными средними и размерами остальных групп оно восстанавливало бы
 * подавленное значение арифметикой в одну строку (§22.17 «Не пытайся
 * восстановить скрытое значение из других показателей»).
 */
export interface RatingAnalyticsResponse {
  /** `null` — методика не определена: считать отчёт не по чему (§19.19). */
  policy: RatingPolicy | null
  periodStartsAt: string | null
  periodEndsAt: string | null
  calculatedAt: string
  /** Порог безопасной агрегации из policy. `null` — правило не задано. */
  suppressionMinGroupSize: number | null
  /** `null`, когда отчёт не публикуется (выключена функция / нет методики /
   * не задан порог приватности). Причина приходит отдельным полем. */
  figures: RatingAnalyticsFigures | null
  unpublishedReason: 'FEATURE_DISABLED' | 'POLICY_UNDEFINED' | 'SUPPRESSION_UNDEFINED' | null
  capabilities: { operationalRatings: boolean }
  /** §35: чего в отчёте нет и почему. */
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Динамика одного сотрудника (§19.20). Точки — записанные агрегаты; отдельных
 * закрытых оценок в ответе нет ни одним полем, как и в сводке.
 */
export interface RatingDynamicsResponse {
  employeeId: string
  safeLabel: string
  /** По возрастанию периода. Порядок задаёт СЕРВЕР: ось времени — не сортировка вкуса. */
  points: RatingDynamicsPoint[]
  /** Границы смены методики — факт сервера, а не вывод экрана (§19.20). */
  boundaries: RatingPolicyBoundary[]
  /** Текущая редакция методики. `null` — методика не определена (§19.19). */
  currentPolicy: RatingPolicy | null
  /**
   * Закрывала ли ТЕКУЩАЯ редакция хоть один период. `false` — на графике её
   * точек нет и быть не может: пересчитывать прошлое под неё запрещено
   * (§19.20), и экран обязан сказать это словами, а не оставить читателя
   * думать, что линия построена по действующей методике.
   */
  currentPolicyHasClosedPeriods: boolean
  capabilities: { operationalRatings: boolean }
  /** Кого можно выбрать — тот же безопасный список, что в сводке. */
  employees: { employeeId: string; safeLabel: string }[]
}
