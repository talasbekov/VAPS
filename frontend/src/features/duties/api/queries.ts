// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  DUTY_SHIFTS_PATH,
  DUTY_TYPES_PATH,
  dutyShiftAcknowledgePath,
  dutyShiftClockInPath,
  dutyShiftClockOutPath,
} from './pending-contracts'
import type {
  AcknowledgeDutyShiftResponse,
  ClockInDutyShiftResponse,
  ClockOutDutyShiftResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
} from './pending-contracts'

export function useDutyTypes() {
  return useQuery<ListDutyTypesResponse, ApiFailure>({
    queryKey: ['duties', 'types'],
    queryFn: () => apiClient.get<ListDutyTypesResponse>(DUTY_TYPES_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useDutyShifts() {
  return useQuery<ListDutyShiftsResponse, ApiFailure>({
    queryKey: ['duties', 'shifts'],
    queryFn: () => apiClient.get<ListDutyShiftsResponse>(DUTY_SHIFTS_PATH),
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
