// Story 20.1c: хук над РЕАЛЬНЫМ /api/operations/security-events/{id}/readiness/
// (20.1b) — типы выведены из paths[...] сгенерированной схемы (ARCH-FE-011),
// прецедент duty-plans/api/queries.ts, НЕ pending-contracts.ts's hand-written
// типы. security-events/api/queries.ts целиком построен на фиктивном
// /api/ops/-пути (backend-contract-pending, docs/frontend/
// FRONTEND_MOCK_API_CONTRACT.md) — этот файл сознательно ОТДЕЛЬНЫЙ, не
// смешивает два источника истины.
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'
import { securityEventKeys } from './query-keys'

export type SecurityEventReadinessResponse =
  paths['/api/operations/security-events/{id}/readiness/']['get']['responses']['200']['content']['application/json']

export function useSecurityEventReadiness(eventId: string) {
  return useQuery<SecurityEventReadinessResponse, ApiFailure>({
    queryKey: securityEventKeys.readiness(eventId),
    queryFn: () =>
      apiClient.get<SecurityEventReadinessResponse>(
        `/api/operations/security-events/${eventId}/readiness/`,
      ),
  })
}
