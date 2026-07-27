// Query/mutation hooks (§7.10, §5.4).
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  DUTY_MONTHLY_PLAN_PATH,
  DUTY_ROUTES_PATH,
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
  combatDutyShiftAcknowledgePath,
  combatDutyShiftCheckInPath,
  combatDutyShiftCompletePath,
  combatDutyShiftHandoverPath,
  combatDutyShiftReplacePath,
  combatDutyShiftReviewPath,
  combatDutyShiftSubmitPath,
  dutyShiftAcknowledgePath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
} from './pending-contracts'
import type {
  AcknowledgeCombatDutyRequest,
  AcknowledgeCombatDutyResponse,
  AcknowledgeDutyShiftResponse,
  CheckInCombatDutyResponse,
  ClockInDutyShiftResponse,
  ClockOutDutyShiftResponse,
  CompleteCombatDutyRequest,
  CompleteCombatDutyResponse,
  CreateCombatDutyShiftRequest,
  CreateCombatDutyShiftResponse,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
  MonthlyDutyPlanResponse,
  RequestCombatDutyReplacementRequest,
  RequestCombatDutyReplacementResponse,
  ReviewCombatGroupRequest,
  ReviewCombatGroupResponse,
  SubmitCombatDutyHandoverRequest,
  SubmitCombatDutyHandoverResponse,
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

/**
 * §21.27-21.30 «месячный план». `placeholderData: keepPreviousData` — прямое
 * требование §19.х мастер-промпта: «при смене месяца не очищай весь экран до
 * белого состояния, сохраняй предыдущие данные до получения нового ответа с
 * явным индикатором обновления». Индикатор рисует страница по
 * `isPlaceholderData`.
 */
export function useMonthlyDutyPlan(month: string, options: { enabled?: boolean } = {}) {
  return useQuery<MonthlyDutyPlanResponse, ApiFailure>({
    queryKey: ['duties', 'monthly-plan', month],
    queryFn: () =>
      apiClient.get<MonthlyDutyPlanResponse>(
        `${DUTY_MONTHLY_PLAN_PATH}?month=${encodeURIComponent(month)}`,
      ),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
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

export function useCombatDutyShifts(options: { enabled?: boolean } = {}) {
  return useQuery<ListCombatDutyShiftsResponse, ApiFailure>({
    queryKey: ['duties', 'combat-shifts'],
    queryFn: () => apiClient.get<ListCombatDutyShiftsResponse>(COMBAT_DUTY_SHIFTS_PATH),
    enabled: options.enabled ?? true,
  })
}

export function useCreateCombatDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<CreateCombatDutyShiftResponse, { body: CreateCombatDutyShiftRequest }>({
    mutationFn: ({ body }) =>
      apiClient.post<CreateCombatDutyShiftResponse>(COMBAT_DUTY_SHIFTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
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

export function useAcknowledgeCombatDuty() {
  const queryClient = useQueryClient()
  return useApiMutation<
    AcknowledgeCombatDutyResponse,
    { id: string; body: AcknowledgeCombatDutyRequest }
  >({
    mutationFn: ({ id, body }) =>
      apiClient.post<AcknowledgeCombatDutyResponse>(combatDutyShiftAcknowledgePath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}

export function useCheckInCombatDuty() {
  const queryClient = useQueryClient()
  return useApiMutation<CheckInCombatDutyResponse, { id: string }>({
    mutationFn: ({ id }) =>
      apiClient.post<CheckInCombatDutyResponse>(combatDutyShiftCheckInPath(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}

export function useCompleteCombatDuty() {
  const queryClient = useQueryClient()
  return useApiMutation<CompleteCombatDutyResponse, { id: string; body: CompleteCombatDutyRequest }>({
    mutationFn: ({ id, body }) =>
      apiClient.post<CompleteCombatDutyResponse>(combatDutyShiftCompletePath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}

export function useSubmitCombatDutyHandover() {
  const queryClient = useQueryClient()
  return useApiMutation<
    SubmitCombatDutyHandoverResponse,
    { id: string; body: SubmitCombatDutyHandoverRequest }
  >({
    mutationFn: ({ id, body }) =>
      apiClient.post<SubmitCombatDutyHandoverResponse>(combatDutyShiftHandoverPath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}

export function useRequestCombatDutyReplacement() {
  const queryClient = useQueryClient()
  return useApiMutation<
    RequestCombatDutyReplacementResponse,
    { id: string; body: RequestCombatDutyReplacementRequest }
  >({
    mutationFn: ({ id, body }) =>
      apiClient.post<RequestCombatDutyReplacementResponse>(combatDutyShiftReplacePath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'combat-shifts'] })
    },
  })
}
