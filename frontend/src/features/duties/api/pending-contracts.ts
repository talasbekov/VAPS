// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type {
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  DutyRoute,
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

export interface ListDutyTypesResponse {
  results: DutyTypeDefinition[]
}

export interface ListDutyShiftsResponse {
  results: DutyShift[]
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
