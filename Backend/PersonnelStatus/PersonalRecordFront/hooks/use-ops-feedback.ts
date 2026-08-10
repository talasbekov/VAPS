"use client";

// Query/mutation-хуки обратной связи (/security-ops/feedback*).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  FEEDBACK_REQUESTS_PATH,
  feedbackClosePath,
  feedbackCommentsPath,
  feedbackDetailPath,
  feedbackSubmitPath,
  feedbackTriagePath,
} from "@/entities/ops-feedback";
import type {
  AddFeedbackCommentRequest,
  CloseFeedbackRequest,
  CreateFeedbackRequest,
  CreateFeedbackResponse,
  FeedbackDetailResponse,
  FeedbackMutationResponse,
  ListFeedbackFilters,
  ListFeedbackResponse,
  SubmitFeedbackResponse,
} from "@/entities/ops-feedback";

/** Фильтры едут В ЗАПРОС и входят в ключ кэша. */
function listPath(filters: ListFeedbackFilters): string {
  const params = new URLSearchParams();
  if (filters.search !== undefined && filters.search !== "")
    params.set("search", filters.search);
  if (filters.typeCode !== undefined) params.set("type", filters.typeCode);
  if (filters.statusCode !== undefined) params.set("status", filters.statusCode);
  if (filters.moduleCode !== undefined) params.set("module", filters.moduleCode);
  if (filters.page !== undefined && filters.page !== 1)
    params.set("page", String(filters.page));
  if (filters.mine === true) params.set("mine", "true");
  const query = params.toString();
  return query === "" ? FEEDBACK_REQUESTS_PATH : `${FEEDBACK_REQUESTS_PATH}?${query}`;
}

export function useFeedbackRequests(filters: ListFeedbackFilters = {}) {
  return useQuery<ListFeedbackResponse, OpsApiFailure>({
    queryKey: [
      "ops-feedback",
      "list",
      filters.search ?? "",
      filters.typeCode ?? "",
      filters.statusCode ?? "",
      filters.moduleCode ?? "",
      filters.page ?? 1,
      filters.mine === true,
    ],
    queryFn: () => opsApiClient.get<ListFeedbackResponse>(listPath(filters)),
  });
}

export function useFeedbackDetail(feedbackId: string) {
  return useQuery<FeedbackDetailResponse, OpsApiFailure>({
    queryKey: ["ops-feedback", "detail", feedbackId],
    queryFn: () =>
      opsApiClient.get<FeedbackDetailResponse>(feedbackDetailPath(feedbackId)),
    // Отказ по видимости повторять нечем.
    retry: false,
  });
}

export function useCreateFeedback(onCreated: () => void) {
  const queryClient = useQueryClient();
  return useOpsMutation<CreateFeedbackResponse, CreateFeedbackRequest>({
    mutationFn: (body) =>
      opsApiClient.post<CreateFeedbackResponse>(FEEDBACK_REQUESTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-feedback"] });
      onCreated();
    },
  });
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  return useOpsMutation<SubmitFeedbackResponse, { feedbackId: string }>({
    mutationFn: ({ feedbackId }) =>
      opsApiClient.post<SubmitFeedbackResponse>(feedbackSubmitPath(feedbackId), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-feedback"] });
    },
  });
}

export function useAddFeedbackComment() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    FeedbackMutationResponse,
    AddFeedbackCommentRequest & Record<string, unknown>
  >({
    mutationFn: (body) =>
      opsApiClient.post<FeedbackMutationResponse>(
        feedbackCommentsPath(body.feedbackId),
        body
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-feedback"] });
    },
  });
}

export function useTriageFeedback() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    FeedbackMutationResponse,
    TriageBody & Record<string, unknown>
  >({
    mutationFn: (body) =>
      opsApiClient.post<FeedbackMutationResponse>(
        feedbackTriagePath(body.feedbackId),
        body
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-feedback"] });
    },
  });
}

interface TriageBody {
  feedbackId: string;
  assigneeUserId?: string | null;
  workingPriorityCode?: string | null;
  statusCode?: string;
}

export function useCloseFeedback() {
  const queryClient = useQueryClient();
  return useOpsMutation<
    FeedbackMutationResponse,
    CloseFeedbackRequest & Record<string, unknown>
  >({
    mutationFn: (body) =>
      opsApiClient.post<FeedbackMutationResponse>(
        feedbackClosePath(body.feedbackId),
        body
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-feedback"] });
    },
  });
}
