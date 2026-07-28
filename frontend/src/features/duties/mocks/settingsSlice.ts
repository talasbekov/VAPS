// Чтение ЧУЖОГО слайса `settings` из общего demo-снапшота (§8.4).
//
// Шестой случай того же приёма в проекте (печатная форма, привязка паспорта,
// отчётный реестр, источник смен, пороги аналитики): импорт из
// `features/settings` красный по ARCH-FE-013, поэтому выборку делает СЕРВЕР —
// рукописная УЗКАЯ проекция соседнего слайса.
//
// Зачем именно здесь: §21.35 разделяет владение обязательным отдыхом надвое —
// СРОК остаётся свойством вида дежурства (`restAfterMinutes`), а РЕЖИМ
// (`REST_AFTER_DUTY_POLICY`) назван глобальной серверной политикой, которую
// frontend обязан ЧИТАТЬ и никогда не выводить сам (§21.34 «frontend не
// определяет severity самостоятельно»). Владелец режима — раздел «Настройки»
// (§29 `conflict rules`).
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Планирование дежурств политику не меняет.
import type { ConflictPolicy, DutyRestPolicy } from '../model/types'

export const SETTINGS_SLICE_NAME = 'settings'

export const REST_AFTER_DUTY_SETTING_CODE = 'CONFLICT.REST_AFTER_DUTY.MODE'

/**
 * §21.35: «по умолчанию применяй серверную политику
 * REST_AFTER_DUTY_POLICY=HARD_BLOCK». Дефолт отвечает на вопрос «что делать,
 * когда действующего значения нет вовсе», и он СТРОГИЙ: молча ослабить запрет
 * из-за недоступности политики значило бы пропустить назначение, которое
 * действующая политика могла бы отвергнуть.
 */
export const DEFAULT_REST_AFTER_DUTY_MODE: DutyRestPolicy = 'HARD_BLOCK'

/**
 * Версия `null`, когда политика не прочитана: конфликт, помеченный чужой или
 * выдуманной версией, утверждал бы о себе неправду. Отсутствие версии —
 * отдельное состояние, и экран называет его вслух.
 */
export const FALLBACK_CONFLICT_POLICY: ConflictPolicy = {
  restAfterDutyMode: DEFAULT_REST_AFTER_DUTY_MODE,
  conflictPolicyVersion: null,
}

interface SettingProjection {
  settingCode?: unknown
  sectionCode?: unknown
  value?: unknown
}

/**
 * Действующие правила конфликтов. Значение вне списка режимов игнорируется —
 * применяется строгий дефолт: непонятый режим не должен превращаться в
 * «ограничений нет».
 */
export function readConflictPolicy(
  slices: Readonly<Record<string, unknown>>,
): ConflictPolicy {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') {
    return FALLBACK_CONFLICT_POLICY
  }
  const raw = (slice as { settings?: unknown }).settings
  const version = (slice as { conflictPolicyVersion?: unknown }).conflictPolicyVersion
  if (!Array.isArray(raw) || typeof version !== 'string' || version === '') {
    return FALLBACK_CONFLICT_POLICY
  }

  const record = (raw as SettingProjection[]).find(
    (item) =>
      item.sectionCode === 'CONFLICT_RULES' &&
      item.settingCode === REST_AFTER_DUTY_SETTING_CODE,
  )
  const mode: DutyRestPolicy =
    record?.value === 'SOFT_OVERRIDE' || record?.value === 'HARD_BLOCK'
      ? record.value
      : DEFAULT_REST_AFTER_DUTY_MODE

  return { restAfterDutyMode: mode, conflictPolicyVersion: version }
}
