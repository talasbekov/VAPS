// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { MonthlyDutyPlan, UnavailableMetric } from '../lib/monthlyPlan'
import type {
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  DutyRoute,
  DutyRouteCoverageMode,
  DutyShift,
  DutyTypeDefinition,
} from '../model/types'

export const DUTY_TYPES_PATH = '/api/ops/duty-types/'
export const DUTY_SHIFTS_PATH = '/api/ops/duty-shifts/'
export const COMBAT_DUTY_TYPES_PATH = '/api/ops/combat-duty-types/'
export const DUTY_ROUTES_PATH = '/api/ops/duty-routes/'
export const COMBAT_ROSTER_CANDIDATES_PATH = '/api/ops/combat-roster-candidates/'
export const COMBAT_DUTY_SHIFTS_PATH = '/api/ops/combat-duty-shifts/'
/** §21.27-21.30 — месячный план отдельным ресурсом, а не фильтром по сменам:
 * §21.29 требует СЕРВЕРНЫЕ KPI, а §21.34 — серверную severity конфликтов;
 * и то и другое приходит в этом ответе вместе с сеткой, чтобы страница не
 * могла посчитать итог «по отрисованной части». */
export const DUTY_MONTHLY_PLAN_PATH = '/api/ops/duty-monthly-plan/'
/** §21.31 «После выбора объекта загружай: активные виды дежурств, действующие
 * секторы, активные посты, требования, инструкции, readiness паспорта» —
 * отдельный ресурс формы, а не реестр объектов: он отдаёт объекты УЖЕ
 * разрешёнными на конкретную дату (действующая версия + её посты + причина
 * блокировки), потому что и выбор версии, и server policy §21.31 принадлежат
 * серверу, а не форме. */
export const DUTY_PLAN_OBJECTS_PATH = '/api/ops/duty-plan-objects/'
/** §21.33 «Подбор кандидатов». */
export const DUTY_CANDIDATES_PATH = '/api/ops/duty-candidates/'

export function dutyShiftAcknowledgePath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/acknowledge/`
}
export function dutyShiftClockInPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-in/`
}
export function dutyShiftClockOutPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-out/`
}
export function combatDutyShiftSubmitPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/submit/`
}
export function combatDutyShiftReviewPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/review/`
}
export function combatDutyShiftAcknowledgePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/acknowledge/`
}
export function combatDutyShiftCheckInPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/check-in/`
}
export function combatDutyShiftCompletePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/complete/`
}
export function combatDutyShiftReplacePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/replace/`
}
export function combatDutyShiftHandoverPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/handover/`
}

export interface ListDutyTypesResponse {
  results: DutyTypeDefinition[]
}

/**
 * §9.6, ПРОИЗВОДНЫЙ (не хранимый) взгляд на привязку дежурства: сам снимок
 * лежит в `DutyShift.passportBinding`, а «какая версия действует прямо
 * сейчас» пересчитывается на каждом чтении. Хранить `stale` было бы ошибкой —
 * публикация новой версии паспорта дежурства не трогает, и флаг молча
 * устарел бы.
 *
 * Отдельным блоком рядом с `results`, а не полем внутри `DutyShift`: так по
 * форме ответа видно, что хранимое и вычисленное — разные вещи (и наоборот,
 * отдельный endpoint на КАЖДУЮ строку таблицы плана был бы N+1).
 */
export interface DutyPassportStatus {
  shiftId: string
  /** Объект дежурства найден в реестре объектов. */
  objectKnown: boolean
  applicableVersionId: string | null
  applicableVersionNumber: number | null
  /** Действует версия НОВЕЕ привязанной — предупреждение, не ошибка. */
  stale: boolean
}

export interface ListDutyShiftsResponse {
  results: DutyShift[]
  /** По одной записи на каждую строку `results`, тот же порядок. */
  passportStatuses: DutyPassportStatus[]
}

/** §21.31: пост формы — из ЗАФИКСИРОВАННОЙ версии паспорта (§21.32 «Посты
 * загружай из зафиксированной версии паспорта, а не из текущего изменившегося
 * объекта»), поэтому сюда едут `task`/`requirements` того же снимка. */
export interface DutyPlanPostOption {
  postId: string
  postName: string
  task: string
  requirements: string
}

export interface DutyPlanSectorOption {
  sectorId: string
  sectorName: string
  posts: DutyPlanPostOption[]
}

/**
 * Объект в форме создания дежурства НА КОНКРЕТНУЮ ДАТУ. `blockReason !== null`
 * — объект показывается, но выбрать его нельзя, и причина видна сразу: §21.31
 * требует «состояние данных», а исчезнувший из списка объект читался бы как
 * «его не существует».
 */
export interface DutyPlanObjectOption {
  objectId: string
  objectName: string
  objectCode: string
  passportState: string
  /** Действующая на дату версия паспорта; `null` — её нет. */
  applicableVersionId: string | null
  applicableVersionNumber: number | null
  applicableVersionEffectiveFrom: string | null
  sectors: DutyPlanSectorOption[]
  /** `null` — объект доступен для планирования на эту дату. */
  blockReason: string | null
}

export interface ListDutyPlanObjectsResponse {
  businessDate: string
  results: DutyPlanObjectOption[]
}

/** §21.33: кандидат + ЕДИНСТВЕННЫЙ выводимый из модели признак занятости —
 * ближайшее уже запланированное дежурство. */
export interface DutyCandidateOption {
  employeeName: string
  unitName: string
  positionName: string
  /** Ближайшее дежурство не раньше запрошенной даты; `null` — таких нет. */
  nearestDutyDate: string | null
  /** Дежурство ровно на запрошенную дату — пересечение (§21.34 HARD). */
  busyOnRequestedDate: boolean
}

export interface ListDutyCandidatesResponse {
  businessDate: string
  results: DutyCandidateOption[]
  /** §35: признаки, которые §21.33 называет, а модель не выдаёт. */
  unavailableAttributes: UnavailableMetric[]
}

/**
 * §21.31 «Создание дежурства». Время начала и продолжительность в запрос НЕ
 * входят: модель проекта — «одна смена = один календарный день» (A55), а
 * продолжительность берётся у вида дежурства (`defaultDurationMinutes`) и
 * потому не дублируется в данных смены.
 *
 * `override`/`override_reason` (snake_case, вопреки остальному телу) — НЕ
 * произвол, а канон протокола 409 платформы: `useApiMutation.confirmOverride`
 * повторяет ИСХОДНОЕ тело плюс ровно эти два ключа. Тип — `type`, а не
 * `interface`, потому что переменные мутации обязаны быть присваиваемы к
 * `Record<string, unknown>` (у интерфейсов нет неявной индексной сигнатуры).
 */
export type CreateDutyShiftRequest = {
  businessDate: string
  dutyTypeCode: string
  objectId: string
  sectorId: string
  postId: string
  employeeName: string
  note: string | null
  /** §21.34 «Soft conflict → 409»; повтор с обходом — только через
   * `confirmOverride`, руками эти поля форма не заполняет. */
  override?: boolean
  override_reason?: string
}

export type CreateDutyShiftResponse = DutyShift

export type AcknowledgeDutyShiftResponse = DutyShift
export type ClockInDutyShiftResponse = DutyShift
export type ClockOutDutyShiftResponse = DutyShift

/** §21.28-21.30 — весь месячный план одним ответом: сетка «объект × день»,
 * серверные KPI (§21.29), конфликты с серверной severity (§21.34) и явный
 * список показателей, которых у модели нет (§35). */
export type MonthlyDutyPlanResponse = MonthlyDutyPlan

export interface ListCombatDutyTypesResponse {
  results: CombatDutyTypeDefinition[]
}

export interface ListDutyRoutesResponse {
  results: DutyRoute[]
}

export interface ListCombatRosterCandidatesResponse {
  results: CombatRosterCandidate[]
}

export interface ListCombatDutyShiftsResponse {
  results: CombatDutyShift[]
}

export interface SubmitCombatGroupRequest {
  groupLeaderEmployeeName: string
  memberEmployeeNames: string[]
  reserveEmployeeNames: string[]
}

export type SubmitCombatGroupResponse = CombatDutyShift

export interface ReviewCombatGroupRequest {
  decision: 'ACCEPT' | 'RETURN'
  returnReason: string | null
}

export type ReviewCombatGroupResponse = CombatDutyShift

export interface AcknowledgeCombatDutyRequest {
  employeeName: string
}

export type AcknowledgeCombatDutyResponse = CombatDutyShift

export type CheckInCombatDutyResponse = CombatDutyShift

export interface CompleteCombatDutyRequest {
  actualMemberNames: string[]
}

export type CompleteCombatDutyResponse = CombatDutyShift

export interface RequestCombatDutyReplacementRequest {
  outgoingEmployeeName: string
  incomingEmployeeName: string
  reasonCode: string
  safeComment: string | null
}

export type RequestCombatDutyReplacementResponse = CombatDutyShift

/** §24.1 «формирование потребности на период» — заводит новую смену со
 * `submission: null` (сразу попадает в очередь «Требует подачи»). */
export interface CreateCombatDutyShiftRequest {
  businessDate: string
  dutyTypeCode: string
  routeIds: string[]
  coverageMode: DutyRouteCoverageMode
  requiredEmployees: number
}

export type CreateCombatDutyShiftResponse = CombatDutyShift

/** §24.22 «Передача и завершение смены», сокращённая до checkpoint'а сдачи
 * (см. FRONTEND_DECISIONS A55) — обязательна ДО `completeCombatDuty`. */
export interface SubmitCombatDutyHandoverRequest {
  unresolvedIncidents: string
  remarks: string
  confirmedByEmployeeName: string
}

export type SubmitCombatDutyHandoverResponse = CombatDutyShift
