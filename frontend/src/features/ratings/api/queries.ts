// Query hooks оперативного рейтинга (§7.10, §5.4).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import { OPERATIONAL_RATINGS_PATH } from './pending-contracts'
import type { ListOperationalRatingsResponse } from './pending-contracts'

export function useOperationalRatings() {
  return useQuery<ListOperationalRatingsResponse, ApiFailure>({
    queryKey: ['ratings', 'operational'],
    queryFn: () => apiClient.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH),
  })
}
