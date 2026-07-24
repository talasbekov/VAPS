// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  DUTY_ROUTES_PATH,
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
  combatDutyShiftReviewPath,
  combatDutyShiftSubmitPath,
  dutyShiftAcknowledgePath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
} from './pending-contracts'
import type {
  AcknowledgeDutyShiftResponse,
  ClockInDutyShiftResponse,
  ClockOutDutyShiftResponse,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
  ReviewCombatGroupRequest,
  ReviewCombatGroupResponse,
  SubmitCombatGroupRequest,
  SubmitCombatGroupResponse,
} from './pending-contracts'

export function useDutyTypes() {
  return useQuery<ListDutyTypesResponse, ApiFailure>({
    queryKey: ['duties', 'types'],
    queryFn: () => apiClient.get<ListDutyTypesResponse>(DUTY_TYPES_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useDutyShifts(options: { enabled?: boolean } = {}) {
  return useQuery<ListDutyShiftsResponse, ApiFailure>({
    queryKey: ['duties', 'shifts'],
    queryFn: () => apiClient.get<ListDutyShiftsResponse>(DUTY_SHIFTS_PATH),
    enabled: options.enabled ?? true,
  })
}

export function useAcknowledgeDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<AcknowledgeDutyShiftResponse, { id: string }>({
    mutationFn: ({ id }) =>
      apiClient.post<AcknowledgeDutyShiftResponse>(dutyShiftAcknowledgePath(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
    },
  })
}

export function useClockInDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<ClockInDutyShiftResponse, { id: string }>({
    mutationFn: ({ id }) => apiClient.post<ClockInDutyShiftResponse>(dutyShiftClockInPath(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
    },
  })
}

export function useClockOutDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<ClockOutDutyShiftResponse, { id: string }>({
    mutationFn: ({ id }) =>
      apiClient.post<ClockOutDutyShiftResponse>(dutyShiftClockOutPath(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
    },
  })
}

export function useCombatDutyTypes() {
  return useQuery<ListCombatDutyTypesResponse, ApiFailure>({
    queryKey: ['duties', 'combat-types'],
    queryFn: () => apiClient.get<ListCombatDutyTypesResponse>(COMBAT_DUTY_TYPES_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useDutyRoutes() {
  return useQuery<ListDutyRoutesResponse, ApiFailure>({
    queryKey: ['duties', 'routes'],
    queryFn: () => apiClient.get<ListDutyRoutesResponse>(DUTY_ROUTES_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useCombatRosterCandidates(options: { enabled?: boolean } = {}) {
  return useQuery<ListCombatRosterCandidatesResponse, ApiFailure>({
    queryKey: ['duties', 'combat-roster-candidates'],
    queryFn: () =>
      apiClient.get<ListCombatRosterCandidatesResponse>(COMBAT_ROSTER_CANDIDATES_PATH),
    enabled: options.enabled ?? true,
  })
}

export function useCombatDutyShifts() {
  return useQuery<ListCombatDutyShiftsResponse, ApiFailure>({
    queryKey: ['duties', 'combat-shifts'],
    queryFn: () => apiClient.get<ListCombatDutyShiftsResponse>(COMBAT_DUTY_SHIFTS_PATH),
  })
}

export function useSubmitCombatGroup() {
  const queryClient = useQueryClient()
  return useApiMutation<SubmitCombatGroupResponse, { id: string; body: SubmitCombatGroupRequest }>({
    mutationFn: ({ id, body }) =>
      apiClient.post<SubmitCombatGroupResponse>(combatDutyShiftSubmitPath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}

export function useReviewCombatGroup() {
  const queryClient = useQueryClient()
  return useApiMutation<ReviewCombatGroupResponse, { id: string; body: ReviewCombatGroupRequest }>({
    mutationFn: ({ id, body }) =>
      apiClient.post<ReviewCombatGroupResponse>(combatDutyShiftReviewPath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}
