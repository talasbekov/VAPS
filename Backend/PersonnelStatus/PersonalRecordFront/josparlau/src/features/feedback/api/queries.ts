// Query/mutation hooks обратной связи (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  FEEDBACK_REQUESTS_PATH,
  feedbackClosePath,
  feedbackCommentsPath,
  feedbackDetailPath,
  feedbackSubmitPath,
  feedbackTriagePath,
} from './pending-contracts'
import type {
  AddFeedbackCommentRequest,
  CloseFeedbackRequest,
  CreateFeedbackRequest,
  FeedbackDetailResponse,
  FeedbackMutationResponse,
  TriageFeedbackRequest,
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

// ─── Карточка обращения (§28 detail, Этап 48) ────────────────────────────────

export function useFeedbackDetail(feedbackId: string) {
  return useQuery<FeedbackDetailResponse, ApiFailure>({
    queryKey: ['feedback', 'detail', feedbackId],
    queryFn: () => apiClient.get<FeedbackDetailResponse>(feedbackDetailPath(feedbackId)),
    // Отказ по видимости повторять нечем: ответ не изменится оттого, что мы
    // спросим трижды.
    retry: false,
  })
}

/** Общая инвалидация после любой мутации карточки: меняются и сама карточка,
 * и строка в реестре (статус, приоритет), и лента. */
function useCardMutation<TVariables extends Record<string, unknown>>(
  send: (variables: TVariables) => Promise<FeedbackMutationResponse>,
) {
  const queryClient = useQueryClient()
  return useApiMutation<FeedbackMutationResponse, TVariables>({
    mutationFn: send,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['feedback', 'detail', result.feedbackId] })
      void queryClient.invalidateQueries({ queryKey: ['feedback', 'requests'] })
    },
  })
}

export function useAddFeedbackComment() {
  return useCardMutation<AddFeedbackCommentRequest>(({ feedbackId, ...body }) =>
    apiClient.post<FeedbackMutationResponse>(feedbackCommentsPath(feedbackId), body),
  )
}

export function useTriageFeedback() {
  return useCardMutation<TriageFeedbackRequest>(({ feedbackId, ...body }) =>
    apiClient.post<FeedbackMutationResponse>(feedbackTriagePath(feedbackId), body),
  )
}

export function useCloseFeedback() {
  return useCardMutation<CloseFeedbackRequest>(({ feedbackId, ...body }) =>
    apiClient.post<FeedbackMutationResponse>(feedbackClosePath(feedbackId), body),
  )
}
