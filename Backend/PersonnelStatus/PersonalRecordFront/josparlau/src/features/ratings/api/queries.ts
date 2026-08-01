// Query hooks оперативного рейтинга (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import type { RegistryFilters } from '../lib/registry'
import {
  EVALUATION_REGISTRY_PATH,
  EVALUATION_WORKSPACE_PATH,
  RATING_AUDIT_PATH,
  RATING_NOTIFICATIONS_PATH,
  RATING_EMPLOYEE_DETAIL_PATH,
  evaluationCorrectPath,
  evaluationDetailPath,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
  RATING_EXPORTS_PATH,
  evaluationSubmitPath,
  ratingExportCancelPath,
  ratingExportDownloadPath,
} from './pending-contracts'
import type {
  CancelRatingExportResponse,
  CreateRatingExportRequest,
  CreateRatingExportResponse,
  DownloadRatingExportResponse,
  ListRatingExportsResponse,
  RatingAuditResponse,
  RatingNotificationsResponse,
  EvaluationRegistryResponse,
  RatingEmployeeDetailResponse,
  CorrectEvaluationRequest,
  CorrectEvaluationResponse,
  EvaluationWorkspaceResponse,
  SubmittedEvaluationDetailResponse,
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

/**
 * Карточка отправленной оценки (§19.17). Отдельный запрос, а не строка из
 * списка: §19.18 шаг 3 требует ПЕРЕЗАГРУЗИТЬ актуальную редакцию задания перед
 * исправлением. `enabled` — карточка читается только когда её открыли.
 */
export function useSubmittedEvaluationDetail(workItemId: string | null) {
  return useQuery<SubmittedEvaluationDetailResponse, ApiFailure>({
    queryKey: ['ratings', 'evaluation-detail', workItemId],
    queryFn: () =>
      apiClient.get<SubmittedEvaluationDetailResponse>(evaluationDetailPath(workItemId ?? '')),
    enabled: workItemId !== null,
    // Редакция задания — то, ради чего этот запрос и делается: отдать её из
    // кэша значило бы вернуть ровно ту устаревшую версию, от которой §19.18
    // защищается.
    staleTime: 0,
  })
}

/**
 * Исправление оценки (§19.18). Успех — только после commit: оптимистичного
 * обновления нет («не показывай исправление успешным до commit»), а агрегат
 * после ответа перечитывается сервером, а не пересчитывается на клиенте.
 */
export function useCorrectEvaluation(
  workItemId: string | null,
  onCorrected: (result: CorrectEvaluationResponse) => void,
) {
  const queryClient = useQueryClient()
  return useApiMutation<
    CorrectEvaluationResponse,
    CorrectEvaluationRequest & Record<string, unknown>
  >({
    mutationFn: (variables) =>
      apiClient.post<CorrectEvaluationResponse>(evaluationCorrectPath(workItemId ?? ''), variables),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['ratings'] })
      onCorrected(result)
    },
  })
}

/**
 * Реестр итоговых оценок (§19.15). Фильтры едут В ЗАПРОС и входят в ключ кэша:
 * иначе отфильтрованный ответ подменял бы собой полный реестр, а отбор пришлось
 * бы делать в браузере — то есть сначала привезти туда лишние строки.
 */
export function useEvaluationRegistry(filters: RegistryFilters) {
  const search = new URLSearchParams()
  if (filters.from !== null) search.set('from', filters.from)
  if (filters.to !== null) search.set('to', filters.to)
  if (filters.event !== null) search.set('event', filters.event)
  if (filters.unit !== null) search.set('unit', filters.unit)
  if (filters.employee !== null) search.set('employee', filters.employee)
  if (filters.direction !== null) search.set('direction', filters.direction)
  if (filters.method !== null) search.set('method', filters.method)
  if (filters.correctedOnly) search.set('corrected', 'true')
  if (filters.search !== '') search.set('search', filters.search)
  if (filters.page !== 1) search.set('page', String(filters.page))
  const query = search.toString()
  return useQuery<EvaluationRegistryResponse, ApiFailure>({
    queryKey: ['ratings', 'registry', query],
    queryFn: () =>
      apiClient.get<EvaluationRegistryResponse>(
        query === '' ? EVALUATION_REGISTRY_PATH : `${EVALUATION_REGISTRY_PATH}?${query}`,
      ),
  })
}

/** Карточка агрегата сотрудника (§19.17, aggregate-only ветка). */
export function useRatingEmployeeDetail(employeeId: string | null) {
  return useQuery<RatingEmployeeDetailResponse, ApiFailure>({
    queryKey: ['ratings', 'employee-detail', employeeId],
    queryFn: () =>
      apiClient.get<RatingEmployeeDetailResponse>(
        `${RATING_EMPLOYEE_DETAIL_PATH}?employee=${encodeURIComponent(employeeId ?? '')}`,
      ),
    enabled: employeeId !== null,
  })
}

/**
 * Свои уведомления раздела (§19.28). Отдельного права нет: отбор по адресату и
 * есть право прочитать — чужие в ответ не попадают.
 */
export function useRatingNotifications() {
  return useQuery<RatingNotificationsResponse, ApiFailure>({
    queryKey: ['ratings', 'notifications'],
    queryFn: () => apiClient.get<RatingNotificationsResponse>(RATING_NOTIFICATIONS_PATH),
  })
}

/** Журнал оценивания (§19.27). Своё право — своё состояние отказа. */
export function useRatingAudit(page: number) {
  return useQuery<RatingAuditResponse, ApiFailure>({
    queryKey: ['ratings', 'audit', page],
    queryFn: () =>
      apiClient.get<RatingAuditResponse>(
        page === 1 ? RATING_AUDIT_PATH : `${RATING_AUDIT_PATH}?page=${page}`,
      ),
  })
}

/** Отчёт аналитики рейтинга (§22.16). Своё право — своё состояние ошибки. */
export function useRatingAnalytics() {
  return useQuery<RatingAnalyticsResponse, ApiFailure>({
    queryKey: ['ratings', 'analytics'],
    queryFn: () => apiClient.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH),
  })
}

/**
 * §19.29: пока есть незавершённые работы, список опрашивается. Опрос —
 * единственный честный способ узнать состояние без фонового исполнителя, и он
 * ОСТАНАВЛИВАЕТСЯ на терминальных состояниях: бесконечный поллинг готовой
 * выгрузки грузил бы сервер ради неизменного ответа.
 */
export const RATING_EXPORT_POLL_INTERVAL_MS = 700

export function useRatingExports() {
  return useQuery<ListRatingExportsResponse, ApiFailure>({
    queryKey: ['ratings', 'exports'],
    queryFn: () => apiClient.get<ListRatingExportsResponse>(RATING_EXPORTS_PATH),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data === undefined) return false
      const running = data.results.some(
        (job) => job.state === 'QUEUED' || job.state === 'GENERATING',
      )
      return running ? RATING_EXPORT_POLL_INTERVAL_MS : false
    },
  })
}

export function useCreateRatingExport() {
  const queryClient = useQueryClient()
  return useApiMutation<
    CreateRatingExportResponse,
    CreateRatingExportRequest & Record<string, unknown>
  >({
    mutationFn: (body) => apiClient.post<CreateRatingExportResponse>(RATING_EXPORTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ratings', 'exports'] })
    },
  })
}

/** §19.29 `CANCELLED`. Тело пустое: что именно отменяется, знает путь работы. */
export function useCancelRatingExport() {
  const queryClient = useQueryClient()
  return useApiMutation<CancelRatingExportResponse, { exportJobId: string }>({
    mutationFn: ({ exportJobId }) =>
      apiClient.post<CancelRatingExportResponse>(ratingExportCancelPath(exportJobId), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ratings', 'exports'] })
    },
  })
}

/**
 * §19.29 «Файл считается готовым только после ответа repository»: скачивание —
 * МУТАЦИЯ, а не query. У неё есть побочный эффект (audit-запись о выдаче на
 * сервере и сам факт выдачи), и кэшировать ответ значило бы держать содержимое
 * файла в памяти вкладки дольше, чем оно нужно.
 */
export function useDownloadRatingExport(onReady: (file: DownloadRatingExportResponse) => void) {
  return useApiMutation<DownloadRatingExportResponse, { artifactId: string }>({
    mutationFn: ({ artifactId }) =>
      apiClient.post<DownloadRatingExportResponse>(ratingExportDownloadPath(artifactId), {}),
    onSuccess: (file) => onReady(file),
  })
}
