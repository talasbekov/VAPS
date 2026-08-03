// Story 16.8h1: query/mutation-хуки над /api/operations/assignment-versions/*
// и /placement-assignments/* (Epic 16 бэк, 16.8a-f). Реальная схема (не
// pending-contract) — все типы выведены из paths[...], буквальный образец
// duty-plans/api/queries.ts (14.11i). Мутации — ТОЛЬКО через useApiMutation
// (сырой useMutation в src/features/** забанен ARCH-FE-015-eslint'ом).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'

export type AssignmentVersionsListResponse =
  paths['/api/operations/assignment-versions/']['get']['responses']['200']['content']['application/json']
export type AssignmentVersionDetailResponse =
  paths['/api/operations/assignment-versions/{id}/']['get']['responses']['200']['content']['application/json']
export type AssignmentVersionConflictsResponse =
  paths['/api/operations/assignment-versions/{id}/conflicts/']['get']['responses']['200']['content']['application/json']
export type PlacementDraftResponse =
  paths['/api/operations/security-events/{id}/placement/draft/']['post']['responses']['201']['content']['application/json']
export type AssignmentVersionSubmitResponse =
  paths['/api/operations/assignment-versions/{id}/submit/']['post']['responses']['200']['content']['application/json']
export type AssignmentVersionReturnRequest =
  paths['/api/operations/assignment-versions/{id}/return/']['post']['requestBody']['content']['application/json']
export type AssignmentVersionReturnResponse =
  paths['/api/operations/assignment-versions/{id}/return/']['post']['responses']['200']['content']['application/json']
export type AssignmentVersionApproveRequest = NonNullable<
  paths['/api/operations/assignment-versions/{id}/approve/']['post']['requestBody']
>['content']['application/json']
export type AssignmentVersionApproveResponse =
  paths['/api/operations/assignment-versions/{id}/approve/']['post']['responses']['200']['content']['application/json']
export type PlacementAssignmentAcknowledgeResponse =
  paths['/api/operations/placement-assignments/{id}/acknowledge/']['post']['responses']['200']['content']['application/json']

export const assignmentVersionKeys = {
  all: ['assignment-versions'] as const,
  lists: () => [...assignmentVersionKeys.all, 'list'] as const,
  list: (eventId?: number) =>
    eventId === undefined
      ? assignmentVersionKeys.lists()
      : ([...assignmentVersionKeys.lists(), eventId] as const),
  detail: (versionId: string) => [...assignmentVersionKeys.all, 'detail', versionId] as const,
  conflicts: (versionId: string) =>
    [...assignmentVersionKeys.all, versionId, 'conflicts'] as const,
}

export function useAssignmentVersions(eventId?: number) {
  return useQuery<AssignmentVersionsListResponse, ApiFailure>({
    queryKey: assignmentVersionKeys.list(eventId),
    queryFn: () =>
      apiClient.get<AssignmentVersionsListResponse>(
        eventId === undefined
          ? '/api/operations/assignment-versions/'
          : `/api/operations/assignment-versions/?event=${eventId}`,
      ),
  })
}

export function useAssignmentVersion(versionId: string, options?: { enabled?: boolean }) {
  return useQuery<AssignmentVersionDetailResponse, ApiFailure>({
    queryKey: assignmentVersionKeys.detail(versionId),
    queryFn: () =>
      apiClient.get<AssignmentVersionDetailResponse>(
        `/api/operations/assignment-versions/${versionId}/`,
      ),
    enabled: options?.enabled ?? true,
  })
}

export function useAssignmentVersionConflicts(
  versionId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<AssignmentVersionConflictsResponse, ApiFailure>({
    queryKey: assignmentVersionKeys.conflicts(versionId),
    queryFn: () =>
      apiClient.get<AssignmentVersionConflictsResponse>(
        `/api/operations/assignment-versions/${versionId}/conflicts/`,
      ),
    enabled: options?.enabled ?? true,
  })
}

export function useCreatePlacementDraft(eventId: number) {
  const queryClient = useQueryClient()
  return useApiMutation<PlacementDraftResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<PlacementDraftResponse>(
        `/api/operations/security-events/${eventId}/placement/draft/`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.lists() })
    },
  })
}

export function useSubmitAssignmentVersion(versionId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AssignmentVersionSubmitResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<AssignmentVersionSubmitResponse>(
        `/api/operations/assignment-versions/${versionId}/submit/`,
        {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(assignmentVersionKeys.detail(versionId), data)
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.lists() })
    },
  })
}

export function useReturnAssignmentVersion(versionId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AssignmentVersionReturnResponse, AssignmentVersionReturnRequest>({
    mutationFn: (body) =>
      apiClient.post<AssignmentVersionReturnResponse>(
        `/api/operations/assignment-versions/${versionId}/return/`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(assignmentVersionKeys.detail(versionId), data)
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.lists() })
    },
  })
}

export function useApproveAssignmentVersion(versionId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<AssignmentVersionApproveResponse, AssignmentVersionApproveRequest>({
    mutationFn: (body) =>
      apiClient.post<AssignmentVersionApproveResponse>(
        `/api/operations/assignment-versions/${versionId}/approve/`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(assignmentVersionKeys.detail(versionId), data)
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.conflicts(versionId) })
    },
  })
}

export function useAcknowledgePlacementAssignment(assignmentId: string, versionId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<PlacementAssignmentAcknowledgeResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<PlacementAssignmentAcknowledgeResponse>(
        `/api/operations/placement-assignments/${assignmentId}/acknowledge/`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assignmentVersionKeys.detail(versionId) })
    },
  })
}
