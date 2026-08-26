"use client";

// Query/mutation-хуки отчётного реестра (/security-ops/service-reports*).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
  reportJobDetailPath,
  reportJobRerunPath,
  OPS_EVENT_DOCUMENTS_PATH,
  eventDocumentRenderPath,
} from "@/entities/service-report";
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
  EventDocumentFormat,
  EventDocumentKindsResponse,
  EventDocumentResponse,
} from "@/entities/service-report";

export function useReportTypes() {
  return useQuery<ListReportTypesResponse, OpsApiFailure>({
    queryKey: ["ops-reports", "types"],
    queryFn: () => opsApiClient.get<ListReportTypesResponse>(REPORT_TYPES_PATH),
    staleTime: 5 * 60_000,
  });
}

/** §22.21: пока есть незавершённые работы, реестр опрашивается; опрос
 * останавливается на терминальных состояниях. */
export const REPORT_POLL_INTERVAL_MS = 700;

/** §22.25: фильтры едут В ЗАПРОС и входят в ключ кэша. */
function jobsPath(filters: ListReportJobsFilters): string {
  const params = new URLSearchParams();
  if (filters.state !== undefined) params.set("state", filters.state);
  if (filters.mine === true) params.set("mine", "true");
  const query = params.toString();
  return query === "" ? REPORT_JOBS_PATH : `${REPORT_JOBS_PATH}?${query}`;
}

export function useReportJobs(filters: ListReportJobsFilters = {}) {
  return useQuery<ListReportJobsResponse, OpsApiFailure>({
    queryKey: ["ops-reports", "jobs", filters.state ?? "ALL", filters.mine === true],
    queryFn: () => opsApiClient.get<ListReportJobsResponse>(jobsPath(filters)),
    // Опрос не идёт на скрытой вкладке: ~85 запросов в минуту ожидания
    // уходили в фон, где результат всё равно никто не видит.
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return false;
      const running = data.results.some(
        (job) => job.state === "PENDING" || job.state === "PROCESSING"
      );
      return running ? REPORT_POLL_INTERVAL_MS : false;
    },
  });
}

/** §22.27 карточка работы: прямая ссылка на PENDING-работу доводит её до
 * конца сама — опрос по тому же правилу, что реестр. */
export function useReportJob(reportJobId: string) {
  return useQuery<ReportJobDetailResponse, OpsApiFailure>({
    queryKey: ["ops-reports", "job", reportJobId],
    queryFn: () =>
      opsApiClient.get<ReportJobDetailResponse>(reportJobDetailPath(reportJobId)),
    // Опрос не идёт на скрытой вкладке: ~85 запросов в минуту ожидания
    // уходили в фон, где результат всё равно никто не видит.
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return false;
      const running =
        data.job.state === "PENDING" || data.job.state === "PROCESSING";
      return running ? REPORT_POLL_INTERVAL_MS : false;
    },
    // Отказ по видимости повторять нечем.
    retry: false,
  });
}

export function useCreateReportJob() {
  const queryClient = useQueryClient();
  return useOpsMutation<CreateReportJobResponse, CreateReportJobRequest>({
    mutationFn: (body) =>
      opsApiClient.post<CreateReportJobResponse>(REPORT_JOBS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-reports", "jobs"] });
    },
  });
}

/** §22.25 «Повторить»/«Новая revision». Тело ПУСТОЕ: параметры повтора сервер
 * берёт из исходной работы. */
export function useRerunReportJob(
  onDone: (result: RerunReportJobResponse) => void
) {
  const queryClient = useQueryClient();
  return useOpsMutation<
    RerunReportJobResponse,
    { reportJobId: string; mode: RerunMode }
  >({
    mutationFn: ({ reportJobId, mode }) =>
      opsApiClient.post<RerunReportJobResponse>(
        reportJobRerunPath(reportJobId, mode),
        {}
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ops-reports", "jobs"] });
      onDone(result);
    },
  });
}

/** §22.23: скачивание — отдельная серверная операция; мутация, а не query —
 * содержимое файла не кэшируется в памяти вкладки. */
export function useDownloadArtifact(
  onDownloaded: (file: DownloadArtifactResponse) => void
) {
  return useOpsMutation<DownloadArtifactResponse, { artifactId: string }>({
    mutationFn: ({ artifactId }) =>
      opsApiClient.post<DownloadArtifactResponse>(
        reportArtifactDownloadPath(artifactId),
        {}
      ),
    // Сохранение файла — в onSuccess, а не в эффекте по data: эффект сработал
    // бы повторно на ререндере и сохранил бы файл второй раз.
    onSuccess: onDownloaded,
  });
}

// ── Документы ОМ в PDF (Plane №159, шаг ПД-3) ─────────────────────────────

/** Какие документы бывают. Список приходит С СЕРВЕРА, а не задан на экране:
 * свой список разошёлся бы с реестром сборщиков и предложил бы человеку
 * документ, которого ручка не соберёт. */
export function useEventDocumentKinds() {
  return useQuery<EventDocumentKindsResponse, OpsApiFailure>({
    queryKey: ["ops-event-documents", "kinds"],
    queryFn: () =>
      opsApiClient.get<EventDocumentKindsResponse>(OPS_EVENT_DOCUMENTS_PATH),
  });
}

/** Собрать документ. Мутация, а не запрос: это ДЕЙСТВИЕ по нажатию, у него не
 * бывает кэша и его не переспрашивают при возврате на экран. */
export function useRenderEventDocument(
  onReady: (file: EventDocumentResponse) => void
) {
  return useOpsMutation<
    EventDocumentResponse,
    { kind: string; eventCode?: string; format?: EventDocumentFormat }
  >({
    mutationFn: (params) =>
      opsApiClient.get<EventDocumentResponse>(eventDocumentRenderPath(params)),
    // Сохранение — в onSuccess, а не в эффекте по data: эффект сработал бы
    // повторно на ререндере и сохранил бы файл второй раз (та же причина, что
    // у скачивания артефакта).
    onSuccess: onReady,
  });
}
