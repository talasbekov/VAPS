// Pending-контракты «Объекты и паспорта» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { ObjectSector, SecurityObject } from '../model/types'

export const OBJECTS_PATH = '/api/ops/objects/'

export function objectDetailPath(id: string): string {
  return `${OBJECTS_PATH}${id}/`
}

export function objectPassportPath(id: string): string {
  return `${OBJECTS_PATH}${id}/passport/`
}

export interface ListObjectsResponse {
  results: SecurityObject[]
}

export interface UpdatePassportRequest extends Record<string, unknown> {
  sectors: ObjectSector[]
}

export type UpdatePassportResponse = SecurityObject
