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
import type { OperationalRatingSummary, RatingPolicy } from '../model/types'

export const OPERATIONAL_RATINGS_PATH = '/api/ops/operational-ratings/'

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
