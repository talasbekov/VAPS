// Query/mutation hooks обратной связи (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import { FEEDBACK_REQUESTS_PATH, feedbackSubmitPath } from './pending-contracts'
import type {
  CreateFeedbackRequest,
  CreateFeedbackResponse,
  ListFeedbackFilters,
  ListFeedbackResponse,
  SubmitFeedbackResponse,
} from './pending-contracts'

/**
 * Фильтры едут В ЗАПРОС и входят в ключ кэша: иначе отфильтрованный ответ
 * подменял бы собой полный реестр — и, что важнее, закрытые строки пришлось
 * бы резать на клиенте, то есть сначала привезти их в браузер.
 */
function feedbackPath(filters: ListFeedbackFilters): string {
  const params = new URLSearchParams()
  if (filters.search !== undefined && filters.search !== '') params.set('search', filters.search)
  if (filters.typeCode !== undefined) params.set('type', filters.typeCode)
  if (filters.statusCode !== undefined) params.set('status', filters.statusCode)
  if (filters.moduleCode !== undefined) params.set('module', filters.moduleCode)
  if (filters.page !== undefined && filters.page !== 1) params.set('page', String(filters.page))
  if (filters.mine === true) params.set('mine', 'true')
  const query = params.toString()
  return query === '' ? FEEDBACK_REQUESTS_PATH : `${FEEDBACK_REQUESTS_PATH}?${query}`
}

export function useFeedbackRequests(filters: ListFeedbackFilters = {}) {
  return useQuery<ListFeedbackResponse, ApiFailure>({
    queryKey: [
      'feedback',
      'requests',
      filters.search ?? '',
      filters.typeCode ?? 'ALL',
      filters.statusCode ?? 'ALL',
      filters.moduleCode ?? 'ALL',
      filters.page ?? 1,
      filters.mine === true,
    ],
    queryFn: () => apiClient.get<ListFeedbackResponse>(feedbackPath(filters)),
  })
}

export function useCreateFeedback(onCreated: (created: CreateFeedbackResponse) => void) {
  const queryClient = useQueryClient()
  return useApiMutation<CreateFeedbackResponse, CreateFeedbackRequest>({
    mutationFn: (body) => apiClient.post<CreateFeedbackResponse>(FEEDBACK_REQUESTS_PATH, body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['feedback', 'requests'] })
      onCreated(created)
    },
  })
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient()
  return useApiMutation<SubmitFeedbackResponse, { feedbackId: string }>({
    mutationFn: ({ feedbackId }) =>
      apiClient.post<SubmitFeedbackResponse>(feedbackSubmitPath(feedbackId), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feedback', 'requests'] })
    },
  })
}
