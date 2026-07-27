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
  DUTY_SHIFT_LIST_PATH,
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
  dutyShiftUpdatePath,
  dutyShiftCancelPath,
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
  CancelDutyShiftRequest,
  CancelDutyShiftResponse,
  DutyShiftDetail,
  DutyShiftListScope,
  ListDutyShiftListResponse,
  UpdateDutyShiftRequest,
  UpdateDutyShiftResponse,
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

/** §21.30 «Список дежурств»/«История». */
export function useDutyShiftList(scope: DutyShiftListScope) {
  return useQuery<ListDutyShiftListResponse, ApiFailure>({
    queryKey: ['duties', 'shift-list', scope],
    queryFn: () =>
      apiClient.get<ListDutyShiftListResponse>(
        scope === 'HISTORY' ? `${DUTY_SHIFT_LIST_PATH}?scope=history` : DUTY_SHIFT_LIST_PATH,
      ),
    placeholderData: keepPreviousData,
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
      // Месячный план и список кандидатов зависят от того же набора смен:
      // новая смена меняет и сетку/KPI/конфликты, и «ближайшую занятость».
      void queryClient.invalidateQueries({ queryKey: ['duties', 'monthly-plan'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'candidates'] })
    },
  })
}

/**
 * §21.31, правка смены. Переменные — само тело (как у создания): повтор с
 * обходом дописывает `override`/`override_reason` в КОРЕНЬ переменных, и при
 * обёртке `{ body }` они уехали бы мимо тела (см. FRONTEND_DECISIONS A64).
 * `id` живёт в замыкании, а не в переменных, чтобы не попасть в тело запроса.
 */
export function useUpdateDutyShift(id: string) {
  const queryClient = useQueryClient()
  return useApiMutation<UpdateDutyShiftResponse, UpdateDutyShiftRequest>({
    mutationFn: (body) =>
      apiClient.post<UpdateDutyShiftResponse>(dutyShiftUpdatePath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'monthly-plan'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'candidates'] })
    },
  })
}

export function useCancelDutyShift() {
  const queryClient = useQueryClient()
  return useApiMutation<CancelDutyShiftResponse, { id: string; body: CancelDutyShiftRequest }>({
    mutationFn: ({ id, body }) =>
      apiClient.post<CancelDutyShiftResponse>(dutyShiftCancelPath(id), body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shifts'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
      // Отменённая смена выбывает из KPI и конфликтов месяца, и сотрудник
      // перестаёт быть занят — оба списка обязаны перечитаться.
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
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
      void queryClient.invalidateQueries({ queryKey: ['duties', 'shift-list'] })
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
