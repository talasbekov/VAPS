// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
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

export type AcknowledgeDutyShiftResponse = DutyShift
export type ClockInDutyShiftResponse = DutyShift
export type ClockOutDutyShiftResponse = DutyShift

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
