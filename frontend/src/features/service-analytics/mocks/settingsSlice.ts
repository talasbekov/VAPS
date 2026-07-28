// Чтение ЧУЖОГО слайса `settings` из общего demo-снапшота (§8.4).
//
// Пятый случай того же приёма в проекте (A58 печатная форма, A62 привязка
// паспорта, отчётный реестр, источник смен): импорт из `features/settings`
// красный по ARCH-FE-013, поэтому выборку делает СЕРВЕР — рукописная УЗКАЯ
// проекция соседнего слайса.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Аналитика ничего не меняет в политике; она её
// потребитель, а владелец — раздел «Настройки» (§29).
import type { AnalyticsRestMode } from '../lib/analytics'

export const SETTINGS_SLICE_NAME = 'settings'

/** Значения политики наблюдений, разложенные по детекторам и полям. */
export interface AttentionPolicyOverrides {
  policyVersion: string
  byDetector: Map<string, { parameter?: number; warningFrom?: number; criticalFrom?: number }>
}

interface SettingProjection {
  settingCode?: unknown
  groupCode?: unknown
  field?: unknown
  value?: unknown
  sectionCode?: unknown
}

/**
 * `null`, а НЕ пустая политика, когда слайса нет: пустая политика означала бы
 * «порогов не задано» и молча превратила бы все меры в бинарные. Отсутствие
 * источника политики — отдельное состояние, и вызывающий обязан решить его
 * сам (в §22.11 это «политика не загружена», а не «замечаний нет»).
 */
export function readAttentionPolicy(
  slices: Readonly<Record<string, unknown>>,
): AttentionPolicyOverrides | null {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const raw = (slice as { settings?: unknown }).settings
  const versions = (slice as { sectionVersions?: unknown }).sectionVersions
  const policyVersion =
    versions !== null && typeof versions === 'object'
      ? (versions as Record<string, unknown>).ATTENTION_POLICY
      : undefined
  if (!Array.isArray(raw) || typeof policyVersion !== 'string' || policyVersion === '') return null

  const byDetector = new Map<
    string,
    { parameter?: number; warningFrom?: number; criticalFrom?: number }
  >()
  for (const item of raw as SettingProjection[]) {
    if (item.sectionCode !== 'ATTENTION_POLICY') continue
    const detectorCode = typeof item.groupCode === 'string' ? item.groupCode : ''
    const value = typeof item.value === 'number' ? item.value : null
    if (detectorCode === '' || value === null) continue
    const bucket = byDetector.get(detectorCode) ?? {}
    if (item.field === 'PARAMETER') bucket.parameter = value
    if (item.field === 'WARNING_FROM') bucket.warningFrom = value
    if (item.field === 'CRITICAL_FROM') bucket.criticalFrom = value
    byDetector.set(detectorCode, bucket)
  }

  return { policyVersion, byDetector }
}

/**
 * Режим нарушения обязательного отдыха §21.35 — из ТОГО ЖЕ раздела правил
 * конфликтов, который читает планирование дежурств. Дефолт строгий: §21.35
 * называет `HARD_BLOCK` серверным значением по умолчанию, и молча ослабить
 * запрет из-за непрочитанной политики значило бы объявить жёсткое нарушение
 * мягким.
 */
export function readRestAfterDutyMode(
  slices: Readonly<Record<string, unknown>>,
): AnalyticsRestMode {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return 'HARD_BLOCK'
  const raw = (slice as { settings?: unknown }).settings
  if (!Array.isArray(raw)) return 'HARD_BLOCK'
  const record = (raw as SettingProjection[]).find(
    (item) =>
      item.sectionCode === 'CONFLICT_RULES' &&
      item.settingCode === 'CONFLICT.REST_AFTER_DUTY.MODE',
  )
  return record?.value === 'SOFT_OVERRIDE' ? 'SOFT_OVERRIDE' : 'HARD_BLOCK'
}
