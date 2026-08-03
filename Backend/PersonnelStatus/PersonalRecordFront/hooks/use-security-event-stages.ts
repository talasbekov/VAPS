"use client";

// Мутации этапов карточки ОМ. Все идут через use-ops-mutation (каналы
// 400/409/5xx), после успеха кладут свежий ОМ в кэш детали и инвалидируют
// список. Один фабричный хелпер — девять операций не должны девять раз
// повторять onSuccess.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { UseOpsMutationResult } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  OPS_PERSONNEL_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementCompletePath,
  securityEventApprovalApprovePath,
  securityEventApprovalReturnPath,
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventDemandApprovePath,
  securityEventForceAllocationPath,
  securityEventForcesCompletePath,
  securityEventJournalPath,
  securityEventPlacementAssignPath,
  securityEventPlacementCompletePath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
} from "@/entities/security-event";
import type {
  AddJournalEntryRequest,
  AssignPlacementRequest,
  CloseSecurityEventRequest,
  ListPersonnelResponse,
  ReplaceAssignmentRequest,
  ReturnPlacementRequest,
  SecurityEvent,
  UpdateBulletinRequest,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from "@/entities/security-event";

interface StageMutationOptions {
  onFormError?: (details: Record<string, unknown>) => void;
}

function useEventMutation<TVariables extends Record<string, unknown>>(
  id: string,
  mutationFn: (variables: TVariables) => Promise<SecurityEvent>,
  options?: StageMutationOptions
): UseOpsMutationResult<SecurityEvent, TVariables> {
  const queryClient = useQueryClient();
  return useOpsMutation<SecurityEvent, TVariables>({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(["ops-security-events", "detail", id], data);
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
    onFormError: options?.onFormError,
  });
}

export function usePersonnelRoster() {
  return useQuery<ListPersonnelResponse, OpsApiFailure>({
    queryKey: ["ops-personnel"],
    queryFn: () => opsApiClient.get<ListPersonnelResponse>(OPS_PERSONNEL_PATH),
  });
}

// ── Бюллетень ────────────────────────────────────────────────────────────

export function useUpdateBulletin(id: string, options?: StageMutationOptions) {
  return useEventMutation<UpdateBulletinRequest>(
    id,
    (body) => opsApiClient.patch<SecurityEvent>(securityEventBulletinPath(id), body),
    options
  );
}

export function useCompleteBulletin(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventBulletinCompletePath(id))
  );
}

// ── Рекогносцировка ──────────────────────────────────────────────────────

export function useUpdateRecon(id: string, options?: StageMutationOptions) {
  return useEventMutation<UpdateReconRequest>(
    id,
    (body) => opsApiClient.patch<SecurityEvent>(securityEventReconPath(id), body),
    options
  );
}

export function useImportReconPosts(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventReconImportPath(id))
  );
}

export function useCompleteRecon(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventReconCompletePath(id))
  );
}

// ── Потребность и силы ───────────────────────────────────────────────────

export function useApproveDemand(id: string, options?: StageMutationOptions) {
  return useEventMutation<UpdateDemandRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventDemandApprovePath(id), body),
    options
  );
}

export function useUpdateForceAllocation(id: string, requestId: string) {
  return useEventMutation<UpdateForceAllocationRequest>(id, (body) =>
    opsApiClient.patch<SecurityEvent>(
      securityEventForceAllocationPath(id, requestId),
      body
    )
  );
}

export function useCompleteForces(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventForcesCompletePath(id))
  );
}

// ── Расстановка и согласование ───────────────────────────────────────────

export function useAssignPlacement(id: string) {
  return useEventMutation<AssignPlacementRequest>(id, (body) =>
    opsApiClient.post<SecurityEvent>(securityEventPlacementAssignPath(id), body)
  );
}

export function useUnassignPlacement(id: string) {
  return useEventMutation<{ assignmentId: string }>(id, ({ assignmentId }) =>
    opsApiClient.del<SecurityEvent>(
      securityEventPlacementUnassignPath(id, assignmentId)
    )
  );
}

export function useCompletePlacement(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventPlacementCompletePath(id))
  );
}

export function useApprovePlacement(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventApprovalApprovePath(id))
  );
}

export function useReturnPlacement(id: string, options?: StageMutationOptions) {
  return useEventMutation<ReturnPlacementRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventApprovalReturnPath(id), body),
    options
  );
}

// ── Ознакомление ─────────────────────────────────────────────────────────

export function useAcknowledgePlacement(id: string) {
  return useEventMutation<{ assignmentId: string }>(id, ({ assignmentId }) =>
    opsApiClient.post<SecurityEvent>(securityEventAcknowledgePath(id, assignmentId))
  );
}

export function useCompleteAcknowledgement(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventAcknowledgementCompletePath(id))
  );
}

// ── Проведение и закрытие ────────────────────────────────────────────────

export function useAddJournalEntry(id: string, options?: StageMutationOptions) {
  return useEventMutation<AddJournalEntryRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventJournalPath(id), body),
    options
  );
}

export function useReplaceAssignment(id: string, options?: StageMutationOptions) {
  return useEventMutation<ReplaceAssignmentRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(
        securityEventReplaceAssignmentPath(id),
        body
      ),
    options
  );
}

export function useCloseSecurityEvent(id: string, options?: StageMutationOptions) {
  return useEventMutation<CloseSecurityEventRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventClosePath(id), body),
    options
  );
}
