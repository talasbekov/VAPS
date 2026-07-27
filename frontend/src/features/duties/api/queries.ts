// Query/mutation hooks (§7.10, §5.4).
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { useApiMutation } from '../../../shared/api/useApiMutation'
import type { ApiFailure } from '../../../shared/api/errors'
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  DUTY_CANDIDATES_PATH,
  DUTY_MONTHLY_PLAN_PATH,
  DUTY_PLAN_OBJECTS_PATH,
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
  dutyShiftDetailPath,
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
  DutyShiftDetail,
  CompleteCombatDutyRequest,
  CompleteCombatDutyResponse,
  CreateCombatDutyShiftRequest,
  CreateCombatDutyShiftResponse,
  CreateDutyShiftRequest,
  CreateDutyShiftResponse,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyCandidatesResponse,
  ListDutyPlanObjectsResponse,
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
/** §21.32 «Карточка дежурства» — согласованный срез одним запросом. */
export function useDutyShiftDetail(id: string) {
  return useQuery<DutyShiftDetail, ApiFailure>({
    queryKey: ['duties', 'shift-detail', id],
    queryFn: () => apiClient.get<DutyShiftDetail>(dutyShiftDetailPath(id)),
    enabled: id !== '',
  })
}

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

/**
 * §21.31 «После выбора объекта загружай…» — но грузим НЕ после выбора объекта,
 * а после выбора даты и вида: именно от них зависит, какие объекты вообще
 * доступны и какая версия паспорта действует. Запрос выключен, пока вид не
 * выбран (`enabled`), иначе форма дёрнула бы сервер с пустым видом и получила
 * 422 на каждое открытие.
 */
export function useDutyPlanObjects(
  businessDate: string,
  dutyTypeCode: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery<ListDutyPlanObjectsResponse, ApiFailure>({
    queryKey: ['duties', 'plan-objects', businessDate, dutyTypeCode],
    queryFn: () =>
      apiClient.get<ListDutyPlanObjectsResponse>(
        `${DUTY_PLAN_OBJECTS_PATH}?business_date=${encodeURIComponent(businessDate)}&duty_type_code=${encodeURIComponent(dutyTypeCode)}`,
      ),
    enabled: (options.enabled ?? true) && businessDate !== '' && dutyTypeCode !== '',
    placeholderData: keepPreviousData,
  })
}

/** §21.33 «Подбор кандидатов» — занятость считается на запрошенную дату. */
export function useDutyCandidates(businessDate: string, options: { enabled?: boolean } = {}) {
  return useQuery<ListDutyCandidatesResponse, ApiFailure>({
    queryKey: ['duties', 'candidates', businessDate],
    queryFn: () =>
      apiClient.get<ListDutyCandidatesResponse>(
        `${DUTY_CANDIDATES_PATH}?business_date=${encodeURIComponent(businessDate)}`,
      ),
    enabled: (options.enabled ?? true) && businessDate !== '',
    placeholderData: keepPreviousData,
  })
}

/**
 * §21.31 создание + §21.34 обход soft-конфликта.
 *
 * Переменные мутации — САМО ТЕЛО запроса, а не `{ body }`, как у остальных
 * мутаций фичи. Это не разнобой: `confirmOverride` дописывает
 * `override`/`override_reason` в КОРЕНЬ переменных, и при обёртке `{ body }`
 * они уехали бы рядом с телом, а не в него — сервер их бы не увидел.
 */
export function useCreateDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<CreateDutyShiftResponse, CreateDutyShiftRequest>({
    mutationFn: (body) => apiClient.post<CreateDutyShiftResponse>(DUTY_SHIFTS_PATH, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
      // Месячный план и список кандидатов зависят от того же набора смен:
      // новая смена меняет и сетку/KPI/конфликты, и «ближайшую занятость».
      void queryClient.invalidateQueries({ queryKey: ['duties', 'monthly-plan'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'candidates'] })
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-detail'] })
    },
  })
}

export function useClockInDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<ClockInDutyShiftResponse, { id: string }>({
    mutationFn: ({ id }) => apiClient.post<ClockInDutyShiftResponse>(dutyShiftClockInPath(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-detail'] })
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-detail'] })
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
