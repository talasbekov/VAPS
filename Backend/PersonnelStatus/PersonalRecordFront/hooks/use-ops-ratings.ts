"use client";

// Query-хуки оперативного рейтинга (/security-ops/ratings/*). Ключи кэша под
// общим префиксом ['ops-ratings']: успешная мутация инвалидирует всё дерево —
// новая оценка входит в агрегат, и оставить сводку прежней значило бы показать
// вчерашнее число как сегодняшнее.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsMockWorker } from "@/hooks/use-ops-mock-worker";
import { hasCurrentOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess, type OpsReadAccess } from "@/hooks/use-ops-protected-read";
import { currentOpsAuthorityStamp } from "@/lib/ops-write-authority";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError, type OpsApiFailure } from "@/lib/ops-errors";
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

// These aggregate sources share the same scope guard; other rating reads have independent access contracts.
const AGGREGATE_READ_FAMILY = ["operational", "dynamics", "employee-detail", "registry"] as const;

// options.enabled — для экранов, где агрегат показывается ПО ПРАВУ
// (`rating.view_aggregate`): без права запрос не уходит вовсе, иначе
// расстановка на каждом рендере получает с бэка 403.
export function useOperationalRatings(options: { enabled?: boolean } = {}) {
  const access = useOpsReadAccess("rating.view_aggregate");
  return useOpsProtectedRead<ListOperationalRatingsResponse>(["ops-ratings", "operational"], [], access,
    () => opsApiClient.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH),
    { enabled: options.enabled, staleTime: 60_000, denialFamily: AGGREGATE_READ_FAMILY });
}

/** Динамика (§19.20): выбранный сотрудник — часть ключа кэша. */
export function useRatingDynamics(employeeId: string | null) {
  const access = useOpsReadAccess("rating.view_aggregate");
  return useOpsProtectedRead<RatingDynamicsResponse>(["ops-ratings", "dynamics"], [employeeId], access, () =>
      opsApiClient.get<RatingDynamicsResponse>(
        employeeId === null
          ? OPERATIONAL_RATING_DYNAMICS_PATH
          : `${OPERATIONAL_RATING_DYNAMICS_PATH}?employee=${encodeURIComponent(employeeId)}`
      ), { staleTime: 60_000, denialFamily: AGGREGATE_READ_FAMILY });
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
export function useEvaluationRegistry(filters: RegistryFilters, options: { enabled?: boolean } = {}) {
  const access = useOpsReadAccess("rating.view_aggregate");
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
  return useOpsProtectedRead<EvaluationRegistryResponse>(["ops-ratings", "registry"], [query], access, () =>
      opsApiClient.get<EvaluationRegistryResponse>(
        query === ""
          ? EVALUATION_REGISTRY_PATH
          : `${EVALUATION_REGISTRY_PATH}?${query}`
      ), { enabled: options.enabled, staleTime: 60_000, denialFamily: AGGREGATE_READ_FAMILY });
}

/**
 * ВСЕ оценки одного сотрудника — страницами до конца (`[ПРФ-06]`, Plane №660).
 *
 * 🔴 ОДНОЙ СТРАНИЦЫ НЕ ХВАТАЕТ, И ОБРЕЗКА БЫЛА НЕВИДИМА. Профиль звал
 * `useEvaluationRegistry` и читал только `results` первой страницы, а реестр
 * отдаёт по десять строк (`REGISTRY_PAGE_SIZE`) и `pageCount` в ответе,
 * который никто не смотрел. У сотрудника с одиннадцатью и более оценёнными
 * мероприятиями старшие получали в истории «не оценивалось», а «из N
 * мероприятий» в шапке было занижено — и признака обрезки на экране не было
 * ни одного.
 *
 * Ручка страницу по размеру не настраивает (`page_size` она не принимает),
 * поэтому страницы забираются подряд. Их немного: список уже сужен ОДНИМ
 * сотрудником, и десятки строк — это единицы запросов, один раз на открытие
 * профиля.
 *
 * Потолок в `MAX_PAGES` — не оптимизация, а предохранитель: сервер, который
 * почему-либо всегда отвечает `pageCount` больше текущего, не должен
 * превращать открытие профиля в бесконечный цикл запросов.
 */
const MAX_EVALUATION_PAGES = 50;

export function useAllEvaluationsOf(employeeId: string, options: { enabled?: boolean } = {}) {
  const access = useOpsReadAccess("rating.view_aggregate");
  return useOpsProtectedRead<EvaluationRegistryResponse>(["ops-ratings", "registry"], ["all-of", employeeId], access, async () => {
      const pageOf = (page: number) =>
        opsApiClient.get<EvaluationRegistryResponse>(
          `${EVALUATION_REGISTRY_PATH}?employee=${encodeURIComponent(employeeId)}` +
            (page === 1 ? "" : `&page=${page}`)
        );
      const first = await pageOf(1);
      const results = [...first.results];
      const pages = Math.min(first.pageCount, MAX_EVALUATION_PAGES);
      for (let page = 2; page <= pages; page += 1) {
        const next = await pageOf(page);
        results.push(...next.results);
      }
      // Ответ отдаётся в форме страницы, чтобы читателям не заводить второй
      // тип: `results` полон, `page`/`pageCount` говорят «одна страница»,
      // потому что для читателя она и есть одна.
      return { ...first, results, page: 1, pageCount: 1 };
    }, { enabled: employeeId !== "" && (options.enabled ?? true), staleTime: 60_000, denialFamily: AGGREGATE_READ_FAMILY });
}

export function useRatingEmployeeDetail(employeeId: string | null) {
  const access = useOpsReadAccess("rating.view_aggregate");
  return useOpsProtectedRead<RatingEmployeeDetailResponse>(["ops-ratings", "employee-detail"], [employeeId], access, () =>
      opsApiClient.get<RatingEmployeeDetailResponse>(
        `${RATING_EMPLOYEE_DETAIL_PATH}?employee=${encodeURIComponent(employeeId ?? "")}`
      ), { enabled: employeeId !== null, staleTime: 60_000, denialFamily: AGGREGATE_READ_FAMILY });
}

export function useRatingNotifications() {
  // This is personal authenticated data; no rating or analytics grant is required.
  const client = useQueryClient();
  const permissions = useOpsPermissions();
  const ready = useOpsMockWorker();
  const { data: session, status } = useSession();
  const actor = (session?.user as { id?: string } | undefined)?.id ?? session?.user?.email ?? "";
  const scope = currentOpsAuthorityStamp(client, actor);
  const access: OpsReadAccess = {
    actor, scope: scope ?? JSON.stringify([actor, "unavailable"]),
    allowed: ready && status === "authenticated" && (session as { error?: string } | null)?.error === undefined &&
      !permissions.isLoading && !permissions.error && scope !== null,
  };
  const query = useOpsProtectedRead<RatingNotificationsResponse>(["ops-ratings", "notifications"], [], access,
    () => {
      if (!hasCurrentOpsReadAuthority(client, access)) throw new OpsApiError({ status: 403,
        errorCode: "PERSONAL_NOTIFICATIONS_AUTHORITY_UNAVAILABLE", message: "Дождитесь проверки доступа к личной ленте.",
        details: {}, requestId: null });
      return opsApiClient.get<RatingNotificationsResponse>(RATING_NOTIFICATIONS_PATH);
    }, { staleTime: 30_000, denialFamily: [] });
  return { ...query, authorityError: permissions.error,
    retryNotifications: () => permissions.error
      ? client.resetQueries({ queryKey: ["ops-me"], exact: true }) : query.refetch() };
}

export function useRatingAudit(page: number) {
  const access = useOpsReadAccess("rating.view_audit");
  return useOpsProtectedRead<RatingAuditResponse>(["ops-ratings", "audit"], [page], access, () =>
      opsApiClient.get<RatingAuditResponse>(
        page === 1 ? RATING_AUDIT_PATH : `${RATING_AUDIT_PATH}?page=${page}`
      ), { staleTime: 60_000, denialFamily: [] });
}

export function useRatingAnalytics() {
  const access = useOpsReadAccess("analytics.view");
  return useOpsProtectedRead<RatingAnalyticsResponse>(["ops-ratings", "analytics"], [], access,
    () => opsApiClient.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH), { denialFamily: [] });
}

/** §19.29: список опрашивается, пока есть незавершённые работы, и опрос
 * останавливается на терминальных состояниях. */
export const RATING_EXPORT_POLL_INTERVAL_MS = 700;

export function useRatingExports() {
  const access = useOpsReadAccess("rating.export");
  return useOpsProtectedRead<ListRatingExportsResponse>(["ops-ratings", "exports"], [], access,
    () => opsApiClient.get<ListRatingExportsResponse>(RATING_EXPORTS_PATH), { staleTime: 60_000, denialFamily: [], poll: data => {
      if (data === undefined) return false;
      const running = data.results.some(
        (job) => job.state === "QUEUED" || job.state === "GENERATING"
      );
      return running ? RATING_EXPORT_POLL_INTERVAL_MS : false;
    } });
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
