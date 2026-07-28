// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { DutyRosterEntry, DutyShift, DutyTarget, DutyTypeDefinition } from '../model/types'

export const DUTY_TYPES_PATH = '/api/ops/duty-types/'
export const DUTY_SHIFTS_PATH = '/api/ops/duty-shifts/'
/** Справочник назначения смены (§24.3): цели дежурств + доступный кадровый снимок. */
export const DUTY_DIRECTORY_PATH = '/api/ops/duty-directory/'

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

export interface ListDutyDirectoryResponse {
  targets: DutyTarget[]
  roster: DutyRosterEntry[]
}

export interface ListDutyShiftsResponse {
  results: DutyShift[]
  /**
   * Текущая бизнес-дата ПО СЕРВЕРУ (demo-часы сценария). Календарь открывается
   * на неделе этой даты, а не по `new Date()` браузера: сценарные данные живут
   * в своём времени, и «сегодня» клиента показало бы пустую неделю.
   */
  businessDate: string
}

/**
 * Назначение смены (§24). `override`/`override_reason` — общий протокол
 * 409-обхода (§36): useApiMutation.confirmOverride кладёт их в КОРЕНЬ тела,
 * не во вложенный объект.
 */
export interface CreateDutyShiftRequest {
  businessDate: string
  employeeId: string
  dutyTypeCode: string
  objectId: string
  override?: boolean
  override_reason?: string
}

export type CreateDutyShiftResponse = DutyShift
export type AcknowledgeDutyShiftResponse = DutyShift
export type ClockInDutyShiftResponse = DutyShift
export type ClockOutDutyShiftResponse = DutyShift
