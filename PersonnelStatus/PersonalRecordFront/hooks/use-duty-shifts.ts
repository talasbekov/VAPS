"use client";

// Смены дежурств: карточка, создание (с 409-обходом), отмена и линейный цикл
// ознакомление → заступление → завершение. Ресурсы формы создания — объекты
// на дату и кандидаты — тоже здесь.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  dutyShiftAcknowledgePath,
  dutyShiftCancelPath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
  dutyShiftDetailPath,
  DUTY_CANDIDATES_PATH,
  DUTY_PLAN_OBJECTS_PATH,
  DUTY_SHIFTS_PATH,
} from "@/entities/duty-shift";
import type {
  CancelDutyShiftRequest,
  CreateDutyShiftRequest,
  DutyShift,
  DutyShiftDetail,
  ListDutyCandidatesResponse,
  ListDutyPlanObjectsResponse,
} from "@/entities/duty-shift";

export function useDutyShiftDetail(id: string) {
  return useQuery<DutyShiftDetail, OpsApiFailure>({
    queryKey: ["ops-duty-shifts", "detail", id],
    queryFn: () => opsApiClient.get<DutyShiftDetail>(dutyShiftDetailPath(id)),
    enabled: id !== "",
  });
}

export function useDutyPlanObjects(date: string) {
  return useQuery<ListDutyPlanObjectsResponse, OpsApiFailure>({
    queryKey: ["ops-duty-plan-objects", date],
    queryFn: () =>
      opsApiClient.get<ListDutyPlanObjectsResponse>(
        `${DUTY_PLAN_OBJECTS_PATH}?date=${date}`
      ),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
}

export function useDutyCandidates(date: string) {
  return useQuery<ListDutyCandidatesResponse, OpsApiFailure>({
    queryKey: ["ops-duty-candidates", date],
    queryFn: () =>
      opsApiClient.get<ListDutyCandidatesResponse>(
        `${DUTY_CANDIDATES_PATH}?date=${date}`
      ),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
}

function useInvalidateDuties() {
  const queryClient = useQueryClient();
  return (shift: DutyShift) => {
    queryClient.setQueryData(
      ["ops-duty-shifts", "detail", shift.id],
      (prev: DutyShiftDetail | undefined) =>
        prev === undefined ? prev : { ...prev, shift }
    );
    void queryClient.invalidateQueries({ queryKey: ["ops-duty-plan"] });
    void queryClient.invalidateQueries({ queryKey: ["ops-duty-shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["ops-duty-candidates"] });
  };
}

export function useCreateDutyShift(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
  onSuccess?: (shift: DutyShift) => void;
}) {
  const invalidate = useInvalidateDuties();
  return useOpsMutation<DutyShift, CreateDutyShiftRequest>({
    mutationFn: (body) => opsApiClient.post<DutyShift>(DUTY_SHIFTS_PATH, body),
    onSuccess: (shift) => {
      invalidate(shift);
      options?.onSuccess?.(shift);
    },
    onFormError: options?.onFormError,
  });
}

export function useCancelDutyShift(id: string, options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const invalidate = useInvalidateDuties();
  return useOpsMutation<DutyShift, CancelDutyShiftRequest>({
    mutationFn: (body) =>
      opsApiClient.post<DutyShift>(dutyShiftCancelPath(id), body),
    onSuccess: invalidate,
    onFormError: options?.onFormError,
  });
}

export function useAcknowledgeDutyShift(id: string) {
  const invalidate = useInvalidateDuties();
  return useOpsMutation<DutyShift, Record<string, never>>({
    mutationFn: () => opsApiClient.post<DutyShift>(dutyShiftAcknowledgePath(id)),
    onSuccess: invalidate,
  });
}

export function useClockInDutyShift(id: string) {
  const invalidate = useInvalidateDuties();
  return useOpsMutation<DutyShift, Record<string, never>>({
    mutationFn: () => opsApiClient.post<DutyShift>(dutyShiftClockInPath(id)),
    onSuccess: invalidate,
  });
}

export function useClockOutDutyShift(id: string) {
  const invalidate = useInvalidateDuties();
  return useOpsMutation<DutyShift, Record<string, never>>({
    mutationFn: () => opsApiClient.post<DutyShift>(dutyShiftClockOutPath(id)),
    onSuccess: invalidate,
  });
}
