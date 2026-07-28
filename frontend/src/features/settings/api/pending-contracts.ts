// Pending-контракты «Настройки» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { PolicySetting, SettingChangeEvent } from '../model/types'

export const SETTINGS_PATH = '/api/ops/settings/'
/**
 * Журнал вынесен в СВОЙ префикс, а не в `/api/ops/settings/change-log/`:
 * иначе path-to-regexp сматчил бы его маршрутом `settings/:settingCode/`
 * (`settingCode = "change-log"`) и запрос молча ушёл бы в чужой handler —
 * ровно тот дефект, что уже ловили на `acknowledgement/complete` (Этап 3).
 */
export const SETTING_CHANGES_PATH = '/api/ops/setting-changes/'

export function settingPath(settingCode: string): string {
  return `${SETTINGS_PATH}${encodeURIComponent(settingCode)}/`
}

export interface ListSettingsResponse {
  results: PolicySetting[]
  /** Действующая версия политики — она же попадает в снимок аналитики §22.11. */
  policyVersion: string
  /** Может ли АКТОР менять значения. Решает сервер, а не экран: кнопка,
   * выключенная только на клиенте, — не ограничение доступа. */
  canManage: boolean
}

export interface ListSettingChangeLogResponse {
  results: SettingChangeEvent[]
}

export interface UpdateSettingRequest extends Record<string, unknown> {
  value: number
  reason: string
}

export interface UpdateSettingResponse {
  setting: PolicySetting
  policyVersion: string
  event: SettingChangeEvent
}
