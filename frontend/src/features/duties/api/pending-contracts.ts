// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { DutyShift, DutyTypeDefinition } from '../model/types'

export const DUTY_TYPES_PATH = '/api/ops/duty-types/'
export const DUTY_SHIFTS_PATH = '/api/ops/duty-shifts/'

export function dutyShiftAcknowledgePath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/acknowledge/`
}
export function dutyShiftClockInPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-in/`
}
export function dutyShiftClockOutPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-out/`
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
