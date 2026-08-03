"use client";

// Query-хуки оперативного рейтинга (/security-ops/ratings/*). Ключи кэша под
// общим префиксом ['ops-ratings']: успешная мутация инвалидирует всё дерево —
// новая оценка входит в агрегат, и оставить сводку прежней значило бы показать
// вчерашнее число как сегодняшнее.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  EVALUATION_REGISTRY_PATH,
  EVALUATION_WORKSPACE_PATH,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
  RATING_AUDIT_PATH,
  RATING_EMPLOYEE_DETAIL_PATH,
  RATING_EXPORTS_PATH,
  RATING_NOTIFICATIONS_PATH,
  evaluationCorrectPath,
  evaluationDetailPath,
  evaluationSubmitPath,
  ratingExportCancelPath,
  ratingExportDownloadPath,
} from "@/entities/operational-rating";
import type {
  CancelRatingExportResponse,
  CorrectEvaluationRequest,
  CorrectEvaluationResponse,
  CreateRatingExportRequest,
  CreateRatingExportResponse,
  DownloadRatingExportResponse,
  EvaluationRegistryResponse,
  EvaluationWorkspaceResponse,
  ListOperationalRatingsResponse,
  ListRatingExportsResponse,
  RatingAnalyticsResponse,
  RatingAuditResponse,
  RatingDynamicsResponse,
  RatingEmployeeDetailResponse,
  RatingNotificationsResponse,
  RegistryFilters,
  SubmitEvaluationRequest,
  SubmitEvaluationResponse,
  SubmittedEvaluationDetailResponse,
} from "@/entities/operational-rating";

export function useOperationalRatings() {
  return useQuery<ListOperationalRatingsResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "operational"],
    queryFn: () =>
      opsApiClient.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH),
  });
}

/** Динамика (§19.20): выбранный сотрудник — часть ключа кэша. */
export function useRatingDynamics(employeeId: string | null) {
  return useQuery<RatingDynamicsResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "dynamics", employeeId],
    queryFn: () =>
      opsApiClient.get<RatingDynamicsResponse>(
        employeeId === null
          ? OPERATIONAL_RATING_DYNAMICS_PATH
          : `${OPERATIONAL_RATING_DYNAMICS_PATH}?employee=${encodeURIComponent(employeeId)}`
      ),
  });
}

/** Рабочее пространство (§19.14): мероприятие входит в ключ кэша. */
export function useEvaluationWorkspace(eventId: string | null) {
  return useQuery<EvaluationWorkspaceResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "workspace", eventId],
    queryFn: () =>
      opsApiClient.get<EvaluationWorkspaceResponse>(
        eventId === null
          ? EVALUATION_WORKSPACE_PATH
          : `${EVALUATION_WORKSPACE_PATH}?event=${encodeURIComponent(eventId)}`
      ),
  });
}

/**
 * Отправка оценки (§19.9-19.10). Успешной считается ТОЛЬКО после ответа
 * сервера — оптимистичного обновления нет.
 */
export function useSubmitEvaluation(
  workItemId: string | null,
  onSubmitted: (result: SubmitEvaluationResponse) => void
) {
  const queryClient = useQueryClient();
  return useOpsMutation<
    SubmitEvaluationResponse,
    SubmitEvaluationRequest & Record<string, unknown>
  >({
    mutationFn: (variables) =>
      opsApiClient.post<SubmitEvaluationResponse>(
        evaluationSubmitPath(workItemId ?? ""),
        variables
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ops-ratings"] });
      onSubmitted(result);
    },
  });
}

/**
 * Карточка отправленной оценки (§19.17): отдельный запрос — §19.18 шаг 3
 * требует перезагрузить актуальную редакцию перед исправлением; staleTime 0.
 */
export function useSubmittedEvaluationDetail(workItemId: string | null) {
  return useQuery<SubmittedEvaluationDetailResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "evaluation-detail", workItemId],
    queryFn: () =>
      opsApiClient.get<SubmittedEvaluationDetailResponse>(
        evaluationDetailPath(workItemId ?? "")
      ),
    enabled: workItemId !== null,
    staleTime: 0,
  });
}

export function useCorrectEvaluation(
  workItemId: string | null,
  onCorrected: (result: CorrectEvaluationResponse) => void
) {
  const queryClient = useQueryClient();
  return useOpsMutation<
    CorrectEvaluationResponse,
    CorrectEvaluationRequest & Record<string, unknown>
  >({
    mutationFn: (variables) =>
      opsApiClient.post<CorrectEvaluationResponse>(
        evaluationCorrectPath(workItemId ?? ""),
        variables
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["ops-ratings"] });
      onCorrected(result);
    },
  });
}

/** Реестр (§19.15): фильтры едут в запрос и входят в ключ кэша. */
export function useEvaluationRegistry(filters: RegistryFilters) {
  const search = new URLSearchParams();
  if (filters.from !== null) search.set("from", filters.from);
  if (filters.to !== null) search.set("to", filters.to);
  if (filters.event !== null) search.set("event", filters.event);
  if (filters.unit !== null) search.set("unit", filters.unit);
  if (filters.employee !== null) search.set("employee", filters.employee);
  if (filters.direction !== null) search.set("direction", filters.direction);
  if (filters.method !== null) search.set("method", filters.method);
  if (filters.correctedOnly) search.set("corrected", "true");
  if (filters.search !== "") search.set("search", filters.search);
  if (filters.page !== 1) search.set("page", String(filters.page));
  const query = search.toString();
  return useQuery<EvaluationRegistryResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "registry", query],
    queryFn: () =>
      opsApiClient.get<EvaluationRegistryResponse>(
        query === ""
          ? EVALUATION_REGISTRY_PATH
          : `${EVALUATION_REGISTRY_PATH}?${query}`
      ),
  });
}

export function useRatingEmployeeDetail(employeeId: string | null) {
  return useQuery<RatingEmployeeDetailResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "employee-detail", employeeId],
    queryFn: () =>
      opsApiClient.get<RatingEmployeeDetailResponse>(
        `${RATING_EMPLOYEE_DETAIL_PATH}?employee=${encodeURIComponent(employeeId ?? "")}`
      ),
    enabled: employeeId !== null,
  });
}

export function useRatingNotifications() {
  return useQuery<RatingNotificationsResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "notifications"],
    queryFn: () =>
      opsApiClient.get<RatingNotificationsResponse>(RATING_NOTIFICATIONS_PATH),
  });
}

export function useRatingAudit(page: number) {
  return useQuery<RatingAuditResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "audit", page],
    queryFn: () =>
      opsApiClient.get<RatingAuditResponse>(
        page === 1 ? RATING_AUDIT_PATH : `${RATING_AUDIT_PATH}?page=${page}`
      ),
  });
}

export function useRatingAnalytics() {
  return useQuery<RatingAnalyticsResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "analytics"],
    queryFn: () =>
      opsApiClient.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH),
  });
}

/** §19.29: список опрашивается, пока есть незавершённые работы, и опрос
 * останавливается на терминальных состояниях. */
export const RATING_EXPORT_POLL_INTERVAL_MS = 700;

export function useRatingExports() {
  return useQuery<ListRatingExportsResponse, OpsApiFailure>({
    queryKey: ["ops-ratings", "exports"],
    queryFn: () =>
      opsApiClient.get<ListRatingExportsResponse>(RATING_EXPORTS_PATH),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return false;
      const running = data.results.some(
        (job) => job.state === "QUEUED" || job.state === "GENERATING"
      );
      return running ? RATING_EXPORT_POLL_INTERVAL_MS : false;
    },
  });
}

export function useCreateRatingExport() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    CreateRatingExportResponse,
    CreateRatingExportRequest & Record<string, unknown>
  >({
    mutationFn: (body) =>
      opsApiClient.post<CreateRatingExportResponse>(RATING_EXPORTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-ratings", "exports"] });
    },
  });
}

export function useCancelRatingExport() {
  const queryClient = useQueryClient();
  return useOpsMutation<CancelRatingExportResponse, { exportJobId: string }>({
    mutationFn: ({ exportJobId }) =>
      opsApiClient.post<CancelRatingExportResponse>(
        ratingExportCancelPath(exportJobId),
        {}
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-ratings", "exports"] });
    },
  });
}

/** Скачивание — МУТАЦИЯ, а не query: у него побочный эффект (audit-запись о
 * выдаче), и кэшировать содержимое файла незачем. */
export function useDownloadRatingExport(
  onReady: (file: DownloadRatingExportResponse) => void
) {
  return useOpsMutation<DownloadRatingExportResponse, { artifactId: string }>({
    mutationFn: ({ artifactId }) =>
      opsApiClient.post<DownloadRatingExportResponse>(
        ratingExportDownloadPath(artifactId),
        {}
      ),
    onSuccess: (file) => onReady(file),
  });
}
