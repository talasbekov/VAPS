// Pending-контракты «Объекты и паспорта» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type {
  ObjectSector,
  PassportFreshness,
  PassportFreshnessPolicy,
  SecurityObject,
} from '../model/types'
import type { ObjectsRegistryKpi, UnavailableMetric } from '../lib/passportFreshness'

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

/**
 * §21.7: агрегаты и актуальность приходят С СЕРВЕРА вместе со списком, а не
 * считаются по отрисованной странице (прямой запрет §21.7) и не выводятся
 * фронтом из «90 дней» (там же).
 *
 * Одним ответом, а не двумя запросами: KPI, посчитанный по другому снимку
 * реестра, чем показанная таблица, хуже отсутствующего.
 */
export interface ListObjectsResponse {
  results: SecurityObject[]
  /** По одной записи на каждую строку `results`, тот же порядок. */
  freshness: PassportFreshness[]
  kpi: ObjectsRegistryKpi
  /** Действующая политика — экран показывает, ЧЕМ посчитан срок. */
  freshnessPolicy: PassportFreshnessPolicy
  /** §35: KPI §21.7, которых модель не даёт. */
  unavailableKpi: UnavailableMetric[]
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
