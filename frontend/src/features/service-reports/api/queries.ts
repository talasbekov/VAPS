// Query/mutation hooks отчётного реестра (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
} from './pending-contracts'
import type {
  CreateReportJobRequest,
  CreateReportJobResponse,
  DownloadArtifactResponse,
  ListReportJobsResponse,
  ListReportTypesResponse,
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

export function useReportJobs() {
  return useQuery<ListReportJobsResponse, ApiFailure>({
    queryKey: ['service-reports', 'jobs'],
    queryFn: () => apiClient.get<ListReportJobsResponse>(REPORT_JOBS_PATH),
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
