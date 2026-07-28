// Query/mutation hooks (§7.10, §5.4).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  DUTY_DIRECTORY_PATH,
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
  CreateDutyShiftRequest,
  CreateDutyShiftResponse,
  ListDutyDirectoryResponse,
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

/** Справочник для формы назначения (§24.3): цели + доступный кадровый снимок. */
export function useDutyDirectory() {
  return useQuery<ListDutyDirectoryResponse, ApiFailure>({
    queryKey: ['duties', 'directory'],
    queryFn: () => apiClient.get<ListDutyDirectoryResponse>(DUTY_DIRECTORY_PATH),
    staleTime: 5 * 60_000,
  })
}

export function useDutyShifts() {
  return useQuery<ListDutyShiftsResponse, ApiFailure>({
    queryKey: ['duties', 'shifts'],
    queryFn: () => apiClient.get<ListDutyShiftsResponse>(DUTY_SHIFTS_PATH),
  })
}

/**
 * Назначение смены. Тип переменных включает `override`/`override_reason`:
 * `confirmOverride` кладёт их в КОРЕНЬ исходного тела (§36) — без этого повтор
 * с причиной не типизировался бы и уехал бы мимо контракта.
 */
export function useCreateDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<CreateDutyShiftResponse, CreateDutyShiftRequest & Record<string, unknown>>({
    mutationFn: (variables) =>
      apiClient.post<CreateDutyShiftResponse>(DUTY_SHIFTS_PATH, variables),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
    },
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
