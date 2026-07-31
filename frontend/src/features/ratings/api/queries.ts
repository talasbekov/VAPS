// Query hooks оперативного рейтинга (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  EVALUATION_WORKSPACE_PATH,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
  evaluationSubmitPath,
} from './pending-contracts'
import type {
  EvaluationWorkspaceResponse,
  ListOperationalRatingsResponse,
  RatingAnalyticsResponse,
  RatingDynamicsResponse,
  SubmitEvaluationRequest,
  SubmitEvaluationResponse,
} from './pending-contracts'

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

/**
 * Рабочее пространство оценивания (§19.14). Мероприятие входит в ключ кэша:
 * очередь по другому мероприятию — другие задания, и подменять их друг другом
 * нельзя.
 */
export function useEvaluationWorkspace(eventId: string | null) {
  return useQuery<EvaluationWorkspaceResponse, ApiFailure>({
    queryKey: ['ratings', 'workspace', eventId],
    queryFn: () =>
      apiClient.get<EvaluationWorkspaceResponse>(
        eventId === null
          ? EVALUATION_WORKSPACE_PATH
          : `${EVALUATION_WORKSPACE_PATH}?event=${encodeURIComponent(eventId)}`,
      ),
  })
}

/**
 * Отправка оценки (§19.9-19.10). Успешной она считается ТОЛЬКО после ответа
 * сервера: оптимистичного обновления здесь нет — §19.18 «не показывай
 * исправление успешным до commit» описывает ту же болезнь, и у первичной
 * отправки она ничем не легче.
 *
 * После commit инвалидируются и рейтинговые чтения: новая оценка входит в
 * агрегат, и оставить сводку прежней значило бы показать вчерашнее число как
 * сегодняшнее.
 */
export function useSubmitEvaluation(
  workItemId: string | null,
  onSubmitted: (result: SubmitEvaluationResponse) => void,
) {
  const queryClient = useQueryClient()
  return useApiMutation<SubmitEvaluationResponse, SubmitEvaluationRequest & Record<string, unknown>>(
    {
      mutationFn: (variables) =>
        apiClient.post<SubmitEvaluationResponse>(
          evaluationSubmitPath(workItemId ?? ''),
          variables,
        ),
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: ['ratings'] })
        onSubmitted(result)
      },
    },
  )
}

/** Отчёт аналитики рейтинга (§22.16). Своё право — своё состояние ошибки. */
export function useRatingAnalytics() {
  return useQuery<RatingAnalyticsResponse, ApiFailure>({
    queryKey: ['ratings', 'analytics'],
    queryFn: () => apiClient.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH),
  })
}
