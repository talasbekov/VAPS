// Query hooks оперативного рейтинга (§7.10, §5.4).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import { OPERATIONAL_RATINGS_PATH, OPERATIONAL_RATING_DYNAMICS_PATH } from './pending-contracts'
import type { ListOperationalRatingsResponse, RatingDynamicsResponse } from './pending-contracts'

export function useOperationalRatings() {
  return useQuery<ListOperationalRatingsResponse, ApiFailure>({
    queryKey: ['ratings', 'operational'],
    queryFn: () => apiClient.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH),
  })
}

/**
 * Динамика (§19.20). Выбранный сотрудник — часть ключа кэша: ряды разных
 * сотрудников не должны подменять друг друга при переключении.
 */
export function useRatingDynamics(employeeId: string | null) {
  return useQuery<RatingDynamicsResponse, ApiFailure>({
    queryKey: ['ratings', 'dynamics', employeeId],
    queryFn: () =>
      apiClient.get<RatingDynamicsResponse>(
        employeeId === null
          ? OPERATIONAL_RATING_DYNAMICS_PATH
          : `${OPERATIONAL_RATING_DYNAMICS_PATH}?employee=${encodeURIComponent(employeeId)}`,
      ),
  })
}
