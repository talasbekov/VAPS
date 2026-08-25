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
  opsPersonnelPagePath,
  OPS_PERSONNEL_ME_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementCompletePath,
  securityEventApprovalApprovePath,
  securityEventApprovalRoutePath,
  securityEventApproverPath,
  securityEventApproverDecidePath,
  securityEventApproverMovePath,
  securityEventApprovalSendPath,
  securityEventApprovalWithdrawPath,
  securityEventRemarkResolvePath,
  securityEventApprovalReturnPath,
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventDemandApprovePath,
  securityEventForceAllocationPath,
  securityEventForcesSplitPath,
  securityEventForcesNotifyPath,
  securityEventForcesCompletePath,
  securityEventJournalPath,
  securityEventPlacementAssignPath,
  securityEventPlacementCompletePath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
  securityEventStagePath,
} from "@/entities/security-event";
import type {
  AddJournalEntryRequest,
  AssignPlacementRequest,
  CloseSecurityEventRequest,
  PersonnelPageResponse,
  OverrideStageRequest,
  PersonnelSummarySnapshot,
  ReplaceAssignmentRequest,
  AddApproverRequest,
  DecideApproverRequest,
  MoveApproverRequest,
  ResolveRemarkRequest,
  ReturnPlacementRequest,
  SecurityEvent,
  SplitForceDemandRequest,
  UpdateBulletinRequest,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from "@/entities/security-event";

interface StageMutationOptions {
  onFormError?: (details: Record<string, unknown>) => void;
  /** Ответ мутации — форме этапа. Нужен там, где сервер меняет данные, которые
   * форма держит у себя (импорт постов), а пересборки формы больше нет. */
  onEvent?: (event: SecurityEvent) => void;
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
      options?.onEvent?.(data);
    },
    onFormError: options?.onFormError,
  });
}

/**
 * СТРАНИЦА кадрового списка с поиском на сервере («Реестр ОМ-35.3»).
 *
 * ЕДИНСТВЕННЫЙ способ прочитать кадры: хук «весь снимок целиком»
 * (`usePersonnelRoster`) снят вместе с безстраничной веткой ручки (Plane
 * №61). Пока он был, четыре экрана тянули всю кадровую базу одним ответом и
 * фильтровали её на клиенте — «поиск», который отвечает «никого не нашлось»,
 * имея в виду «нет в загруженном».
 *
 * `placeholderData` держит предыдущую страницу на экране, пока грузится
 * следующая: без него список мигает в пустоту на каждом нажатии «Дальше», и
 * человек теряет место в перечне.
 */
export function usePersonnelPage(params: {
  search: string;
  page: number;
  pageSize?: number;
  enabled?: boolean;
}) {
  const pageSize = params.pageSize ?? 20;
  return useQuery<PersonnelPageResponse, OpsApiFailure>({
    queryKey: ["ops-personnel", "page", params.search, params.page, pageSize],
    queryFn: () =>
      opsApiClient.get<PersonnelPageResponse>(
        opsPersonnelPagePath({
          search: params.search,
          page: params.page,
          pageSize,
        })
      ),
    enabled: params.enabled !== false,
    placeholderData: (previous) => previous,
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

export function useImportReconPosts(
  id: string,
  options?: StageMutationOptions
) {
  return useEventMutation<Record<string, never>>(
    id,
    () => opsApiClient.post<SecurityEvent>(securityEventReconImportPath(id)),
    options
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

/** Раскладка потребности по департаментам — весь список одним запросом.
 *
 * Своя мутация, а не повтор `useUpdateForceAllocation`: тот правит ЧИСЛО у
 * одной строки утверждённой потребности, эта — адресную раскладку штаба.
 */
export function useSplitForceDemand(id: string, options?: StageMutationOptions) {
  return useEventMutation<SplitForceDemandRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventForcesSplitPath(id), body),
    options
  );
}

/** «Оповестить управления» у заявки департаменту (Plane №73, шаг СС-2). */
export function useNotifyDirectorates(id: string, allocationId: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesNotifyPath(id, allocationId)
    )
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

/**
 * Перевод ОМ на выбранный этап в обход условий — только у права
 * `event.stage_override` (у остальных сервер ответит 403). Идёт тем же
 * каналом, что и остальные мутации этапа: ответ — ЦЕЛОЕ мероприятие, оно
 * ложится в кэш детали, и карточка перерисовывается от серверного факта, а
 * не от догадки клиента о новой стадии.
 */
export function useOverrideStage(id: string, options?: StageMutationOptions) {
  return useEventMutation<OverrideStageRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventStagePath(id), body),
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

/**
 * Своя кадровая запись. Ошибку не ретраим: 404 «не привязан» — это ответ, а
 * не сбой, и повторять его бессмысленно.
 */
export function usePersonnelMe(options: { enabled?: boolean } = {}) {
  return useQuery<PersonnelSummarySnapshot, OpsApiFailure>({
    queryKey: ["ops-personnel", "me"],
    queryFn: () =>
      opsApiClient.get<PersonnelSummarySnapshot>(OPS_PERSONNEL_ME_PATH),
    enabled: options.enabled ?? true,
    retry: false,
  });
}

/** Маршрут согласования: добавление, снятие и решение по строке. */
export function useAddApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<AddApproverRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventApprovalRoutePath(id), body),
    options
  );
}

export function useRemoveApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & Record<string, unknown>>(
    id,
    ({ approverId }) =>
      opsApiClient.del<SecurityEvent>(securityEventApproverPath(id, approverId)),
    options
  );
}

/** Отправить расстановку согласующим: до отправки маршрут — список людей, а
 * не процесс. Отправка фиксирует на сервере снимок состава. */
export function useSendForApproval(id: string, options?: StageMutationOptions) {
  return useEventMutation<Record<string, never>>(
    id,
    () => opsApiClient.post<SecurityEvent>(securityEventApprovalSendPath(id)),
    options
  );
}

export function useWithdrawApproval(id: string, options?: StageMutationOptions) {
  return useEventMutation<Record<string, never>>(
    id,
    () => opsApiClient.post<SecurityEvent>(securityEventApprovalWithdrawPath(id)),
    options
  );
}

export function useMoveApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & MoveApproverRequest>(
    id,
    ({ approverId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventApproverMovePath(id, approverId),
        body
      ),
    options
  );
}

export function useResolveRemark(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ remarkId: string } & ResolveRemarkRequest>(
    id,
    ({ remarkId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventRemarkResolvePath(id, remarkId),
        body
      ),
    options
  );
}

export function useDecideApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & DecideApproverRequest>(
    id,
    ({ approverId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventApproverDecidePath(id, approverId),
        body
      ),
    options
  );
}
