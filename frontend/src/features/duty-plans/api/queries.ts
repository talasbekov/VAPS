// Story 14.11i: query/mutation-хуки над /api/operations/duty-plans/* (Epic
// 14 бэк, 14.11a-g). Реальная схема (не pending-contract) — все типы выведены
// из paths[...], без ручного дублирования (прецедент: personnel/api/queries.ts,
// security-events/api/queries.ts). Мутации — ТОЛЬКО через useApiMutation (сырой
// useMutation в src/features/** забанен ARCH-FE-015-eslint'ом).
//
// НЕ путать с features/duties/ (Smart Josparlau, /api/ops/duty-shifts|
// duty-types — другой, несуществующий бэк) — отдельная фича, эта стори её не
// трогает (коллизия имён разрешена явным решением пользователя при
// create-story: новая папка duty-plans/, не переиспользование duties/).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'

export type DutyPlansListResponse =
  paths['/api/operations/duty-plans/']['get']['responses']['200']['content']['application/json']
export type DutyPlanCreateRequest =
  paths['/api/operations/duty-plans/']['post']['requestBody']['content']['application/json']
export type DutyPlanCreateResponse =
  paths['/api/operations/duty-plans/']['post']['responses']['201']['content']['application/json']
type DutyPlanApproveResponse =
  paths['/api/operations/duty-plans/{id}/approve/']['post']['responses']['200']['content']['application/json']
type DutyPlanConflictsResponse =
  paths['/api/operations/duty-plans/{id}/conflicts/']['get']['responses']['200']['content']['application/json']
type DutyPlanValidateResponse =
  paths['/api/operations/duty-plans/{id}/validate/']['post']['responses']['200']['content']['application/json']
export type DutyShiftsListResponse =
  paths['/api/operations/duty-plans/{id}/shifts/']['get']['responses']['200']['content']['application/json']
export type DutyShiftCreateRequest =
  paths['/api/operations/duty-plans/{id}/shifts/']['post']['requestBody']['content']['application/json']
type DutyShiftCreateResponse =
  paths['/api/operations/duty-plans/{id}/shifts/']['post']['responses']['201']['content']['application/json']
type DutyShiftCancelRequest =
  paths['/api/operations/duty-plans/{id}/shifts/{shift_id}/cancel/']['post']['requestBody']['content']['application/json']
type DutyShiftCancelResponse =
  paths['/api/operations/duty-plans/{id}/shifts/{shift_id}/cancel/']['post']['responses']['200']['content']['application/json']
type DutyShiftReplanRequest =
  paths['/api/operations/duty-plans/{id}/shifts/{shift_id}/replan/']['post']['requestBody']['content']['application/json']
type DutyShiftReplanResponse =
  paths['/api/operations/duty-plans/{id}/shifts/{shift_id}/replan/']['post']['responses']['201']['content']['application/json']

export const dutyPlanKeys = {
  all: ['duty-plans'] as const,
  lists: () => [...dutyPlanKeys.all, 'list'] as const,
  detail: (planId: string) => [...dutyPlanKeys.all, 'detail', planId] as const,
  shifts: (planId: string) => [...dutyPlanKeys.all, planId, 'shifts'] as const,
  conflicts: (planId: string) => [...dutyPlanKeys.all, planId, 'conflicts'] as const,
}

export function useDutyPlans(objectId?: number) {
  return useQuery<DutyPlansListResponse, ApiFailure>({
    queryKey: objectId === undefined ? dutyPlanKeys.lists() : [...dutyPlanKeys.lists(), objectId],
    queryFn: () =>
      apiClient.get<DutyPlansListResponse>(
        objectId === undefined
          ? '/api/operations/duty-plans/'
          : `/api/operations/duty-plans/?object=${objectId}`,
      ),
  })
}

export function useCreateDutyPlan() {
  const queryClient = useQueryClient()
  return useApiMutation<DutyPlanCreateResponse, DutyPlanCreateRequest>({
    mutationFn: (body) =>
      apiClient.post<DutyPlanCreateResponse>('/api/operations/duty-plans/', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.lists() })
    },
  })
}

export function useDutyShifts(planId: string, options?: { enabled?: boolean }) {
  return useQuery<DutyShiftsListResponse, ApiFailure>({
    queryKey: dutyPlanKeys.shifts(planId),
    queryFn: () =>
      apiClient.get<DutyShiftsListResponse>(`/api/operations/duty-plans/${planId}/shifts/`),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateDutyShift(planId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<DutyShiftCreateResponse, DutyShiftCreateRequest>({
    mutationFn: (body) =>
      apiClient.post<DutyShiftCreateResponse>(
        `/api/operations/duty-plans/${planId}/shifts/`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.shifts(planId) })
    },
  })
}

export function useApproveDutyPlan(planId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<DutyPlanApproveResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<DutyPlanApproveResponse>(
        `/api/operations/duty-plans/${planId}/approve/`,
        {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(dutyPlanKeys.detail(planId), data)
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.shifts(planId) })
    },
  })
}

export function useCancelDutyShift(planId: string, shiftId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<DutyShiftCancelResponse, DutyShiftCancelRequest>({
    mutationFn: (body) =>
      apiClient.post<DutyShiftCancelResponse>(
        `/api/operations/duty-plans/${planId}/shifts/${shiftId}/cancel/`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.shifts(planId) })
    },
  })
}

export function useReplanDutyShift(planId: string, shiftId: string) {
  const queryClient = useQueryClient()
  return useApiMutation<DutyShiftReplanResponse, DutyShiftReplanRequest>({
    mutationFn: (body) =>
      apiClient.post<DutyShiftReplanResponse>(
        `/api/operations/duty-plans/${planId}/shifts/${shiftId}/replan/`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dutyPlanKeys.shifts(planId) })
    },
  })
}

export function useValidateDutyPlan(planId: string) {
  return useApiMutation<DutyPlanValidateResponse, Record<string, never>>({
    mutationFn: () =>
      apiClient.post<DutyPlanValidateResponse>(
        `/api/operations/duty-plans/${planId}/validate/`,
        {},
      ),
  })
}

export function useDutyPlanConflicts(planId: string) {
  return useQuery<DutyPlanConflictsResponse, ApiFailure>({
    queryKey: dutyPlanKeys.conflicts(planId),
    queryFn: () =>
      apiClient.get<DutyPlanConflictsResponse>(`/api/operations/duty-plans/${planId}/conflicts/`),
  })
}
