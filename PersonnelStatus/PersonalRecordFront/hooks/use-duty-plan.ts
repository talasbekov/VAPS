"use client";

// Месячный план дежурств: чтение одним ответом + действия lifecycle.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  dutyPlanApprovePath,
  dutyPlanCheckPath,
  dutyPlanDraftPath,
  dutyPlanReopenPath,
  DUTY_MONTHLY_PLAN_PATH,
  DUTY_TYPES_PATH,
} from "@/entities/duty-shift";
import type {
  ListDutyTypesResponse,
  MonthlyDutyPlanResponse,
  MonthlyPlanActionRequest,
  MonthlyPlanRecord,
} from "@/entities/duty-shift";

export function useDutyTypes() {
  return useQuery<ListDutyTypesResponse, OpsApiFailure>({
    queryKey: ["ops-duty-types"],
    queryFn: () => opsApiClient.get<ListDutyTypesResponse>(DUTY_TYPES_PATH),
  });
}

export function useMonthlyDutyPlan(month: string) {
  return useQuery<MonthlyDutyPlanResponse, OpsApiFailure>({
    queryKey: ["ops-duty-plan", month],
    queryFn: () =>
      opsApiClient.get<MonthlyDutyPlanResponse>(
        `${DUTY_MONTHLY_PLAN_PATH}?month=${month}`
      ),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

function usePlanAction(path: string) {
  const queryClient = useQueryClient();
  return useOpsMutation<MonthlyPlanRecord, MonthlyPlanActionRequest>({
    mutationFn: (body) => opsApiClient.post<MonthlyPlanRecord>(path, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-duty-plan"] });
    },
  });
}

export function useCreatePlanDraft() {
  return usePlanAction(dutyPlanDraftPath());
}
export function useCheckPlanConflicts() {
  return usePlanAction(dutyPlanCheckPath());
}
export function useApprovePlan() {
  return usePlanAction(dutyPlanApprovePath());
}
export function useReopenPlan() {
  return usePlanAction(dutyPlanReopenPath());
}
