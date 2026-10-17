"use client";

// Query/mutation-хуки отчётного реестра (/security-ops/service-reports*).
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { assertOpsReadAuthority, hasCurrentOpsReadAuthority, hasOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import {
  REPORT_JOBS_PATH,
  REPORT_TYPES_PATH,
  reportArtifactDownloadPath,
  reportJobDetailPath,
  reportJobRerunPath,
  OPS_EVENT_DOCUMENTS_PATH,
  eventDocumentRenderPath,
  BulletinIssue,
  BulletinIssuesResponse,
  OPS_BULLETIN_ISSUES_PATH,
  bulletinIssueFilePath,
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
import type { OpsReadAccess } from "@/hooks/use-ops-protected-read";

function reportActionAvailable(client: QueryClient, access: OpsReadAccess, source: QueryKey | undefined,
  code: "DOWNLOAD" | RerunMode, target: { reportJobId?: string; artifactId?: string }, allowRefreshing = false): boolean {
  if (!source || !hasOpsReadAuthority(client, access, "ops-reports", source, allowRefreshing)) return false;
  const data = client.getQueryData<ListReportJobsResponse | ReportJobDetailResponse>(source);
  if (!data) return false;
  const artifacts = "results" in data ? data.artifacts : data.artifact ? [data.artifact] : [];
  const artifact = target.artifactId ? artifacts.find(row => row.artifactId === target.artifactId && row.available) : undefined;
  const id = target.reportJobId ?? artifact?.reportJobId;
  if (!id || (code === "DOWNLOAD" && !artifact)) return false;
  const job = "results" in data ? data.results.find(row => row.reportJobId === id) : data.job.reportJobId === id ? data.job : undefined;
  const actions = "results" in data ? data.actions.find(row => row.reportJobId === id)?.actions : data.actions;
  return job !== undefined && actions?.some(action => action.code === code && action.available) === true;
}

function requireReportAction(allowed: boolean): void {
  if (!allowed) throw new OpsApiError({ status: 403, errorCode: "REPORT_ACTION_UNAVAILABLE",
    message: "Действие недоступно. Обновите список отчётов.", details: {}, requestId: null });
}

function reportSourcesAvailable(client: QueryClient, access: OpsReadAccess, sources: readonly QueryKey[] | undefined, group = "ops-reports", allowRefreshing = false): boolean {
  return sources !== undefined && sources.length > 0 && sources.every(source => hasOpsReadAuthority(client, access, group, source, allowRefreshing));
}

export function useReportTypes() {
  const access = useOpsReadAccess("report.generate");
  return useOpsProtectedRead(["ops-reports", "types"], [], access,
    () => opsApiClient.get<ListReportTypesResponse>(REPORT_TYPES_PATH), { staleTime: 5 * 60_000 });
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
  const access = useOpsReadAccess("report.generate");
  return useOpsProtectedRead(["ops-reports", "jobs"], [filters.state ?? "ALL", filters.mine === true], access,
    () => opsApiClient.get<ListReportJobsResponse>(jobsPath(filters)), { poll: data => {
      if (data === undefined) return false;
      const running = data.results.some(
        (job) => job.state === "PENDING" || job.state === "PROCESSING"
      );
      return running ? REPORT_POLL_INTERVAL_MS : false;
    } });
}

/** §22.27 карточка работы: прямая ссылка на PENDING-работу доводит её до
 * конца сама — опрос по тому же правилу, что реестр. */
export function useReportJob(reportJobId: string) {
  const access = useOpsReadAccess("report.generate");
  return useOpsProtectedRead(["ops-reports", "job"], [reportJobId], access,
    () => opsApiClient.get<ReportJobDetailResponse>(reportJobDetailPath(reportJobId)), { enabled: reportJobId !== "", poll: data => {
      if (data === undefined) return false;
      const running =
        data.job.state === "PENDING" || data.job.state === "PROCESSING";
      return running ? REPORT_POLL_INTERVAL_MS : false;
    } });
}

export function useCreateReportJob(sources?: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("report.generate");
  return useOpsMutation<CreateReportJobResponse, CreateReportJobRequest>({
    mutationFn: async (body) => {
      requireReportAction(reportSourcesAvailable(queryClient, access, sources));
      return opsApiClient.post<CreateReportJobResponse>(REPORT_JOBS_PATH, body,
        () => requireReportAction(reportSourcesAvailable(queryClient, access, sources, "ops-reports", true)));
    },
    onSuccess: () => {
      if (!reportSourcesAvailable(queryClient, access, sources, "ops-reports", true)) return;
      void queryClient.invalidateQueries({ queryKey: ["ops-reports", "jobs"] });
    },
  });
}

/** §22.25 «Повторить»/«Новая revision». Тело ПУСТОЕ: параметры повтора сервер
 * берёт из исходной работы. */
export function useRerunReportJob(
  onDone: (result: RerunReportJobResponse) => void,
  source?: QueryKey,
) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("report.generate");
  return useOpsMutation<
    RerunReportJobResponse,
    { reportJobId: string; mode: RerunMode }
  >({
    mutationFn: async ({ reportJobId, mode }) => {
      requireReportAction(reportActionAvailable(queryClient, access, source, mode, { reportJobId }));
      return opsApiClient.post<RerunReportJobResponse>(
        reportJobRerunPath(reportJobId, mode),
        {},
        () => requireReportAction(reportActionAvailable(queryClient, access, source, mode, { reportJobId }, true)),
      );
    },
    onSuccess: (result) => {
      if (!hasOpsReadAuthority(queryClient, access, "ops-reports", source, true)) return;
      void queryClient.invalidateQueries({ queryKey: ["ops-reports", "jobs"] });
      onDone(result);
    },
  });
}

/** §22.23: скачивание — отдельная серверная операция; мутация, а не query —
 * содержимое файла не кэшируется в памяти вкладки. */
export function useDownloadArtifact(
  onDownloaded: (file: DownloadArtifactResponse) => void,
  source?: QueryKey,
) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("report.generate");
  return useOpsMutation<DownloadArtifactResponse, { artifactId: string }>({
    mutationFn: async ({ artifactId }) => {
      requireReportAction(reportActionAvailable(queryClient, access, source, "DOWNLOAD", { artifactId }));
      return opsApiClient.post<DownloadArtifactResponse>(
        reportArtifactDownloadPath(artifactId),
        {},
        () => requireReportAction(reportActionAvailable(queryClient, access, source, "DOWNLOAD", { artifactId }, true)),
      );
    },
    // Сохранение файла — в onSuccess, а не в эффекте по data: эффект сработал
    // бы повторно на ререндере и сохранил бы файл второй раз.
    onSuccess: (file, variables) => { if (reportActionAvailable(queryClient, access, source, "DOWNLOAD", variables, true)) onDownloaded(file); },
  });
}

// ── Документы ОМ в PDF (Plane №159, шаг ПД-3) ─────────────────────────────

/** Какие документы бывают. Список приходит С СЕРВЕРА, а не задан на экране:
 * свой список разошёлся бы с реестром сборщиков и предложил бы человеку
 * документ, которого ручка не соберёт. */
export function useEventDocumentKinds() {
  const access = useOpsReadAccess("event.view");
  return useOpsProtectedRead(["ops-event-documents", "kinds"], [], access,
    () => opsApiClient.get<EventDocumentKindsResponse>(OPS_EVENT_DOCUMENTS_PATH));
}

/** Собрать документ. Мутация, а не запрос: это ДЕЙСТВИЕ по нажатию, у него не
 * бывает кэша и его не переспрашивают при возврате на экран. */
export function useRenderEventDocument(
  onReady: (file: EventDocumentResponse) => void,
  source?: QueryKey,
) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("event.view");
  return useOpsMutation<
    EventDocumentResponse,
    {
      kind: string;
      eventCode?: string;
      format?: EventDocumentFormat;
      asOf?: string;
      visitObjectId?: string;
    }
  >({
    mutationFn: async (params) => {
      // Fixed-kind downloads on event/visit screens need no catalogue load.
      // Their GET still checks event visibility on the server each time.
      if (source) assertOpsReadAuthority(queryClient, access, "ops-event-documents", source);
      else requireReportAction(hasCurrentOpsReadAuthority(queryClient, access));
      return opsApiClient.get<EventDocumentResponse>(eventDocumentRenderPath(params),
        () => requireReportAction(source ? hasOpsReadAuthority(queryClient, access, "ops-event-documents", source, true)
          : hasCurrentOpsReadAuthority(queryClient, access)));
    },
    // Сохранение — в onSuccess, а не в эффекте по data: эффект сработал бы
    // повторно на ререндере и сохранил бы файл второй раз (та же причина, что
    // у скачивания артефакта).
    onSuccess: file => { if (source ? hasOpsReadAuthority(queryClient, access, "ops-event-documents", source, true) : hasCurrentOpsReadAuthority(queryClient, access)) onReady(file); },
  });
}

/** Выпуски бюллетеня, новые сверху (Plane №420). */
export function useBulletinIssues(enabled = true) {
  const access = useOpsReadAccess("event.view");
  return useOpsProtectedRead(["ops-event-documents", "bulletin-issues"], [], access,
    () => opsApiClient.get<BulletinIssuesResponse>(OPS_BULLETIN_ISSUES_PATH), { enabled });
}

/** Выпустить бюллетень на срез: сервер замораживает строки и PDF. */
export function useIssueBulletin(onIssued: (issue: BulletinIssue) => void, sources?: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("event.bulletin");
  return useOpsMutation<BulletinIssue, { asOf: string }>({
    mutationFn: async (params) => {
      requireReportAction(reportSourcesAvailable(queryClient, access, sources, "ops-event-documents"));
      return opsApiClient.post<BulletinIssue>(OPS_BULLETIN_ISSUES_PATH, params,
        () => requireReportAction(reportSourcesAvailable(queryClient, access, sources, "ops-event-documents", true)));
    },
    onSuccess: (issue) => {
      if (!reportSourcesAvailable(queryClient, access, sources, "ops-event-documents", true)) return;
      void queryClient.invalidateQueries({ queryKey: ["ops-event-documents", "bulletin-issues"] });
      onIssued(issue);
    },
  });
}

/** Файл выпуска — тем же конвертом, что и сборка на лету. */
export function useBulletinIssueFile(onReady: (file: EventDocumentResponse) => void, source?: QueryKey) {
  const queryClient = useQueryClient();
  const access = useOpsReadAccess("event.view");
  return useOpsMutation<EventDocumentResponse, { id: string }>({
    mutationFn: async (params) => {
      requireReportAction(source !== undefined);
      assertOpsReadAuthority(queryClient, access, "ops-event-documents", source);
      return opsApiClient.get<EventDocumentResponse>(bulletinIssueFilePath(params.id),
        () => requireReportAction(source !== undefined && hasOpsReadAuthority(queryClient, access, "ops-event-documents", source, true)));
    },
    onSuccess: file => { if (source && hasOpsReadAuthority(queryClient, access, "ops-event-documents", source, true)) onReady(file); },
  });
}
