// Query/mutation hooks (§7.10, §5.4): apiClient — единственная точка транспорта;
// query keys — фабрика выше; мутация — ТОЛЬКО через useApiMutation (raw
// useMutation в features запрещён ARCH-FE-015).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import { securityEventKeys } from './query-keys'
import {
  BINDABLE_OBJECTS_PATH,
  PERSONNEL_PATH,
  SECURITY_EVENTS_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementCompletePath,
  securityEventApprovalApprovePath,
  securityEventApprovalReturnPath,
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventDemandApprovePath,
  securityEventDetailPath,
  securityEventForceAllocationPath,
  securityEventForcesCompletePath,
  securityEventJournalPath,
  securityEventPassportPath,
  securityEventPlacementAssignPath,
  securityEventPlacementCompletePath,
  securityEventPlacementRatingsPath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
} from './pending-contracts'
import type {
  CompleteBulletinResponse,
  AcknowledgePlacementResponse,
  AddJournalEntryRequest,
  AddJournalEntryResponse,
  ApprovePlacementResponse,
  ApproveDemandResponse,
  AssignPlacementRequest,
  AssignPlacementResponse,
  ListPlacementRatingsResponse,
  CloseSecurityEventRequest,
  CloseSecurityEventResponse,
  CompleteAcknowledgementResponse,
  CompleteForcesResponse,
  CompletePlacementResponse,
  CompleteReconResponse,
  CreateSecurityEventRequest,
  CreateSecurityEventResponse,
  ImportReconPostsResponse,
  ListBindableObjectsResponse,
  ListPersonnelResponse,
  ListSecurityEventsParams,
  ListSecurityEventsResponse,
  ReplaceAssignmentRequest,
  ReplaceAssignmentResponse,
  ReturnPlacementRequest,
  ReturnPlacementResponse,
  SecurityEventPassportView,
  UnassignPlacementResponse,
  UpdateBulletinRequest,
  UpdateBulletinResponse,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateForceAllocationResponse,
  UpdateReconRequest,
  UpdateReconResponse,
} from './pending-contracts'
import type { SecurityEvent } from '../model/types'

function toQueryString(params: ListSecurityEventsParams): string {
  const search = new URLSearchParams()
  if (params.search !== '') search.set('search', params.search)
  if (params.stage !== 'ALL') search.set('stage', params.stage)
  search.set('page', String(params.page))
  search.set('page_size', String(params.pageSize))
  return search.toString()
}

export function useSecurityEventsList(
  params: ListSecurityEventsParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery<ListSecurityEventsResponse, ApiFailure>({
    queryKey: securityEventKeys.list(params),
    queryFn: () =>
      apiClient.get<ListSecurityEventsResponse>(
        `${SECURITY_EVENTS_PATH}?${toQueryString(params)}`,
      ),
    enabled: options.enabled ?? true,
  })
}

export function useSecurityEvent(id: string) {
  return useQuery<SecurityEvent, ApiFailure>({
    queryKey: securityEventKeys.detail(id),
    queryFn: () => apiClient.get<SecurityEvent>(securityEventDetailPath(id)),
  })
}

export function useCreateSecurityEvent() {
  const queryClient = useQueryClient()
  return useApiMutation<CreateSecurityEventResponse, CreateSecurityEventRequest>({
    mutationFn: (body) =>
      apiClient.post<CreateSecurityEventResponse>(SECURITY_EVENTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

/** Список объектов для привязки нового ОМ (§9.6). */
export function useBindableObjects(options: { enabled?: boolean } = {}) {
  return useQuery<ListBindableObjectsResponse, ApiFailure>({
    queryKey: securityEventKeys.bindableObjects(),
    queryFn: () => apiClient.get<ListBindableObjectsResponse>(BINDABLE_OBJECTS_PATH),
    enabled: options.enabled ?? true,
  })
}

/** Привязка ОМ к версии паспорта: снимок + пересчитанное «что действует сейчас». */
export function useSecurityEventPassport(id: string, options: { enabled?: boolean } = {}) {
  return useQuery<SecurityEventPassportView, ApiFailure>({
    queryKey: securityEventKeys.passport(id),
    queryFn: () => apiClient.get<SecurityEventPassportView>(securityEventPassportPath(id)),
    enabled: options.enabled ?? true,
  })
}

export function useImportReconPostsFromPassport(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<ImportReconPostsResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<ImportReconPostsResponse>(securityEventReconImportPath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      // Счётчик «сколько ещё можно импортировать» живёт в passport-view —
      // без инвалидации кнопка осталась бы предлагать уже перенесённые посты.
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.passport(id) })
    },
  })
}

export function useUpdateBulletin(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UpdateBulletinResponse, UpdateBulletinRequest>({
    mutationFn: (body) =>
      apiClient.patch<UpdateBulletinResponse>(securityEventBulletinPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

/** Этап 72: завершение бюллетеня — переход BULLETIN → RECON. */
export function useCompleteBulletin(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CompleteBulletinResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<CompleteBulletinResponse>(securityEventBulletinCompletePath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useUpdateRecon(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UpdateReconResponse, UpdateReconRequest>({
    mutationFn: (body) =>
      apiClient.patch<UpdateReconResponse>(securityEventReconPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
    },
  })
}

export function useCompleteRecon(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CompleteReconResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<CompleteReconResponse>(securityEventReconCompletePath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useApproveDemand(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<ApproveDemandResponse, UpdateDemandRequest>({
    mutationFn: (body) =>
      apiClient.post<ApproveDemandResponse>(securityEventDemandApprovePath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useUpdateForceAllocation(id: string, requestId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UpdateForceAllocationResponse, UpdateForceAllocationRequest>({
    mutationFn: (body) =>
      apiClient.patch<UpdateForceAllocationResponse>(
        securityEventForceAllocationPath(id, requestId),
        body,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
    },
  })
}

export function useCompleteForces(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CompleteForcesResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<CompleteForcesResponse>(securityEventForcesCompletePath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useAssignPlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AssignPlacementResponse, AssignPlacementRequest>({
    mutationFn: (body) =>
      apiClient.post<AssignPlacementResponse>(securityEventPlacementAssignPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      // §19.24: состав назначенных изменился — сводка рейтинга пересобирается.
      void queryClient.invalidateQueries({
        queryKey: securityEventKeys.placementRatings(id),
      })
    },
  })
}

export function useUnassignPlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UnassignPlacementResponse, { assignmentId: string }>({
    mutationFn: ({ assignmentId }) =>
      apiClient.del<UnassignPlacementResponse>(
        securityEventPlacementUnassignPath(id, assignmentId),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({
        queryKey: securityEventKeys.placementRatings(id),
      })
    },
  })
}

/** §19.24: разрешённая краткая сводка рейтинга назначенных. Свежесть держат
 * ЯВНЫЕ инвалидации assign/unassign — рефетч на каждый фокус окна гонял бы
 * серверный пересчёт без изменения данных (ревью Этапа 73). */
export function usePlacementRatings(id: string, enabled: boolean) {
  return useQuery<ListPlacementRatingsResponse, ApiFailure>({
    queryKey: securityEventKeys.placementRatings(id),
    queryFn: () =>
      apiClient.get<ListPlacementRatingsResponse>(securityEventPlacementRatingsPath(id)),
    enabled,
    staleTime: 60_000,
  })
}

export function useCompletePlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CompletePlacementResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<CompletePlacementResponse>(securityEventPlacementCompletePath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useApprovePlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<ApprovePlacementResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<ApprovePlacementResponse>(securityEventApprovalApprovePath(id), {}),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useReturnPlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<ReturnPlacementResponse, ReturnPlacementRequest>({
    mutationFn: (body) =>
      apiClient.post<ReturnPlacementResponse>(securityEventApprovalReturnPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

/** external-personnel-contract-pending: read-only справочник для подбора кандидатов (§8.9). Редко меняется — увеличенный staleTime (§5.4). */
export function usePersonnelRoster() {
  return useQuery<ListPersonnelResponse, ApiFailure>({
    queryKey: ['personnel-roster'],
    queryFn: () => apiClient.get<ListPersonnelResponse>(PERSONNEL_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useAcknowledgePlacement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AcknowledgePlacementResponse, { assignmentId: string }>({
    mutationFn: ({ assignmentId }) =>
      apiClient.post<AcknowledgePlacementResponse>(
        securityEventAcknowledgePath(id, assignmentId),
        {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
    },
  })
}

export function useCompleteAcknowledgement(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CompleteAcknowledgementResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<CompleteAcknowledgementResponse>(
        securityEventAcknowledgementCompletePath(id),
        {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}

export function useAddJournalEntry(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AddJournalEntryResponse, AddJournalEntryRequest>({
    mutationFn: (body) =>
      apiClient.post<AddJournalEntryResponse>(securityEventJournalPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
    },
  })
}

export function useReplaceAssignment(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<ReplaceAssignmentResponse, ReplaceAssignmentRequest>({
    mutationFn: (body) =>
      apiClient.post<ReplaceAssignmentResponse>(securityEventReplaceAssignmentPath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
    },
  })
}

export function useCloseSecurityEvent(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<CloseSecurityEventResponse, CloseSecurityEventRequest>({
    mutationFn: (body) =>
      apiClient.post<CloseSecurityEventResponse>(securityEventClosePath(id), body),
    onSuccess: (data) => {
      queryClient.setQueryData(securityEventKeys.detail(id), data)
      void queryClient.invalidateQueries({ queryKey: securityEventKeys.lists() })
    },
  })
}
