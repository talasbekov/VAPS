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
  /** Каждая запись несёт своё `action` — право и замок решает сервер, а не
   * экран: кнопка, выключенная только на клиенте, — не ограничение доступа. */
  results: PolicySetting[]
  /** Действующая версия политики наблюдений — она же попадает в снимок аналитики §22.11. */
  policyVersion: string
  /** Действующая версия правил конфликтов — она же попадает в каждый конфликт §21.34. */
  conflictPolicyVersion: string
}

export interface ListSettingChangeLogResponse {
  results: SettingChangeEvent[]
}

export interface UpdateSettingRequest extends Record<string, unknown> {
  /** Число для порога, код варианта для режима — какой из них законен, решает
   * вид записи на сервере. */
  value: number | string
  reason: string
}

export interface UpdateSettingResponse {
  setting: PolicySetting
  policyVersion: string
  conflictPolicyVersion: string
  event: SettingChangeEvent
}
