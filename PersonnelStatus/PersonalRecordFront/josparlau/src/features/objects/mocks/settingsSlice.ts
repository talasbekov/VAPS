// Чтение ЧУЖОГО слайса `settings` из общего demo-снапшота (§8.4).
//
// Седьмой случай того же приёма в проекте: импорт из `features/settings`
// красный по ARCH-FE-013, поэтому выборку делает СЕРВЕР — рукописная УЗКАЯ
// проекция соседнего слайса.
//
// Зачем здесь: §21.7 запрещает фиксированный frontend-период («Паспорт старше
// 90 дней») и требует, чтобы срок приходил ОТ POLICY. Интервал лежал в данных с
// Этапа 37, но в слайсе САМИХ ОБЪЕКТОВ — то есть администрировать его было
// негде, а порог «скоро проверка» и вовсе оставался константой в коде рядом с
// настраиваемым интервалом. Владелец политики — раздел «Настройки» (§29).
//
// ⚠️ Правя имена полей ЗДЕСЬ или в слайсе-владельце, грепай их строкой: граница
// нетипизирована по построению, и расхождение компилируется зелёным
// (см. feedback-narrow-projection-silent-break).
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Реестр объектов политику не меняет.
import type { PassportFreshnessPolicy } from '../model/types'

export const SETTINGS_SLICE_NAME = 'settings'

export const VERIFICATION_INTERVAL_SETTING_CODE = 'PASSPORT.FRESHNESS.PARAMETER'
export const DUE_SOON_PERCENT_SETTING_CODE = 'PASSPORT.FRESHNESS.WARNING_FROM'

/**
 * Политика, применяемая когда раздел настроек не прочитан. Значения ТЕ ЖЕ, что
 * в сиде, но версия отдельная и говорит о себе вслух: пометить результат
 * действующей редакцией, не прочитав её, значило бы соврать о методике расчёта
 * (`freshnessPolicyVersion` §21.7 существует ровно для этой сверки).
 */
export const FALLBACK_FRESHNESS_POLICY: PassportFreshnessPolicy = {
  version: 'passport-freshness-unresolved',
  verificationIntervalDays: 120,
  dueSoonPercent: 20,
}

interface SettingProjection {
  settingCode?: unknown
  sectionCode?: unknown
  value?: unknown
}

function readNumber(
  records: readonly SettingProjection[],
  settingCode: string,
  fallback: number,
): number {
  const record = records.find(
    (item) => item.sectionCode === 'PASSPORT_FRESHNESS' && item.settingCode === settingCode,
  )
  // Нечисловое или неположительное значение не принимается: интервал в 0 дней
  // объявил бы просроченными ВСЕ паспорта разом.
  return typeof record?.value === 'number' && Number.isFinite(record.value) && record.value > 0
    ? record.value
    : fallback
}

export function readFreshnessPolicy(
  slices: Readonly<Record<string, unknown>>,
): PassportFreshnessPolicy {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') {
    return FALLBACK_FRESHNESS_POLICY
  }
  const raw = (slice as { settings?: unknown }).settings
  const versions = (slice as { sectionVersions?: unknown }).sectionVersions
  const version =
    versions !== null && typeof versions === 'object'
      ? (versions as Record<string, unknown>).PASSPORT_FRESHNESS
      : undefined
  if (!Array.isArray(raw) || typeof version !== 'string' || version === '') {
    return FALLBACK_FRESHNESS_POLICY
  }

  const records = raw as SettingProjection[]
  return {
    version,
    verificationIntervalDays: readNumber(
      records,
      VERIFICATION_INTERVAL_SETTING_CODE,
      FALLBACK_FRESHNESS_POLICY.verificationIntervalDays,
    ),
    dueSoonPercent: readNumber(
      records,
      DUE_SOON_PERCENT_SETTING_CODE,
      FALLBACK_FRESHNESS_POLICY.dueSoonPercent,
    ),
  }
}
