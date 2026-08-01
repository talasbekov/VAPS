// Query/mutation hooks отчётного реестра (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
  reportJobPath,
  reportJobRerunPath,
} from './pending-contracts'
import type {
  CreateReportJobRequest,
  CreateReportJobResponse,
  DownloadArtifactResponse,
  ListReportJobsFilters,
  ListReportJobsResponse,
  ListReportTypesResponse,
  ReportJobDetailResponse,
  RerunMode,
  RerunReportJobResponse,
} from './pending-contracts'

export function useReportTypes() {
  return useQuery<ListReportTypesResponse, ApiFailure>({
    queryKey: ['service-reports', 'types'],
    queryFn: () => apiClient.get<ListReportTypesResponse>(REPORT_TYPES_PATH),
    staleTime: 5 * 60_000,
  })
}

/**
 * §22.21: пока есть незавершённые работы, реестр опрашивается. Опрос —
 * единственный честный способ узнать состояние без фонового исполнителя, и
 * он ОСТАНАВЛИВАЕТСЯ на терминальных состояниях: бесконечный поллинг готового
 * отчёта грузил бы сервер ради неизменного ответа.
 */
export const REPORT_POLL_INTERVAL_MS = 700

/** §22.25: фильтры едут В ЗАПРОС и входят в ключ кэша — иначе отфильтрованный
 * ответ подменял бы собой полный реестр на соседнем экране. */
function jobsPath(filters: ListReportJobsFilters): string {
  const params = new URLSearchParams()
  if (filters.state !== undefined) params.set('state', filters.state)
  if (filters.mine === true) params.set('mine', 'true')
  const query = params.toString()
  return query === '' ? REPORT_JOBS_PATH : `${REPORT_JOBS_PATH}?${query}`
}

export function useReportJobs(filters: ListReportJobsFilters = {}) {
  return useQuery<ListReportJobsResponse, ApiFailure>({
    queryKey: ['service-reports', 'jobs', filters.state ?? 'ALL', filters.mine === true],
    queryFn: () => apiClient.get<ListReportJobsResponse>(jobsPath(filters)),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data === undefined) return false
      const running = data.results.some(
        (job) => job.state === 'PENDING' || job.state === 'PROCESSING',
      )
      return running ? REPORT_POLL_INTERVAL_MS : false
    },
  })
}

/**
 * §22.27 карточка работы. Опрос — по ТОМУ ЖЕ правилу, что реестр: пока работа
 * не в терминальном состоянии, и ни секунды после. Прямая ссылка на PENDING-
 * работу обязана довести её до конца сама — человек, пришедший по ссылке, не
 * должен открывать реестр, чтобы «подтолкнуть» свою выгрузку.
 */
export function useReportJob(reportJobId: string) {
  return useQuery<ReportJobDetailResponse, ApiFailure>({
    queryKey: ['service-reports', 'job', reportJobId],
    queryFn: () => apiClient.get<ReportJobDetailResponse>(reportJobPath(reportJobId)),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data === undefined) return false
      const running = data.job.state === 'PENDING' || data.job.state === 'PROCESSING'
      return running ? REPORT_POLL_INTERVAL_MS : false
    },
    // Отказ по праву/видимости повторять нечем: ответ не изменится оттого, что
    // мы спросим трижды (§22.27 — доступ перепроверяет сервер, не настойчивость).
    retry: false,
  })
}

export function useCreateReportJob() {
  const queryClient = useQueryClient()
  return useApiMutation<CreateReportJobResponse, CreateReportJobRequest>({
    mutationFn: (body) => apiClient.post<CreateReportJobResponse>(REPORT_JOBS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-reports', 'jobs'] })
    },
  })
}

/**
 * §22.25 «Повторить» / «Сформировать новую revision». Тело запроса ПУСТОЕ:
 * параметры повтора сервер берёт из исходной работы, и передавать их отсюда
 * значило бы позволить экрану подменить «те же параметры».
 */
export function useRerunReportJob(onDone: (result: RerunReportJobResponse) => void) {
  const queryClient = useQueryClient()
  return useApiMutation<RerunReportJobResponse, { reportJobId: string; mode: RerunMode }>({
    mutationFn: ({ reportJobId, mode }) =>
      apiClient.post<RerunReportJobResponse>(reportJobRerunPath(reportJobId, mode), {}),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['service-reports', 'jobs'] })
      onDone(result)
    },
  })
}

/**
 * §22.23: скачивание — ОТДЕЛЬНАЯ серверная операция, повторно проверяющая
 * право и состояние. Мутация, а не query: у неё есть побочный эффект (аудит на
 * стороне сервера и сам факт выдачи), и кэшировать её ответ — значит хранить
 * содержимое файла в памяти вкладки дольше, чем оно нужно.
 */
export function useDownloadArtifact(onDownloaded: (file: DownloadArtifactResponse) => void) {
  return useApiMutation<DownloadArtifactResponse, { artifactId: string }>({
    mutationFn: ({ artifactId }) =>
      apiClient.post<DownloadArtifactResponse>(reportArtifactDownloadPath(artifactId), {}),
    // Сохранение файла — в `onSuccess`, а не в эффекте по `data`: эффект
    // сработал бы повторно на любом ререндере с тем же ответом и сохранил бы
    // файл второй раз.
    onSuccess: onDownloaded,
  })
}
