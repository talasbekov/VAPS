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

export function objectPassportVersionsPath(id: string): string {
  return `${OBJECTS_PATH}${id}/passport/versions/`
}

export interface ListObjectsResponse {
  results: SecurityObject[]
}

export interface UpdatePassportRequest extends Record<string, unknown> {
  sectors: ObjectSector[]
}

export type UpdatePassportResponse = SecurityObject

/**
 * §8.5 `publishPassportVersion`. Секторы в запросе НЕ передаются: снимок
 * repository берёт с действующей редакции объекта — иначе клиент мог бы
 * опубликовать не то, что показывает паспорт.
 */
export interface PublishPassportVersionRequest extends Record<string, unknown> {
  effectiveFrom: string
  note: string
}

export type PublishPassportVersionResponse = SecurityObject
