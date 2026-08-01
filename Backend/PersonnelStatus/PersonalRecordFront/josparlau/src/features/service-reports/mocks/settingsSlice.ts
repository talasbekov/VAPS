// Чтение ЧУЖОГО слайса `settings` из общего demo-снапшота (§8.4).
//
// Тот же приём, что у аналитики, объектов и планирования дежурств: импорт из
// `features/settings` красный по ARCH-FE-013, поэтому выборку делает СЕРВЕР —
// рукописная УЗКАЯ проекция соседнего слайса.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Отчётный реестр — потребитель пределов §22.5, а не
// их владелец: предел периода и срок хранения ограничивают ровно того, кто
// выгружает, и принадлежать ему не могут.

export const SETTINGS_SLICE_NAME = 'settings'

const SECTION = 'REPORT_LIMITS'
const PERIOD_CODE_PREFIX = 'LIMITS.REPORT_PERIOD.'
const RETENTION_CODE = 'LIMITS.REPORT_RETENTION.PARAMETER'

interface SettingProjection {
  settingCode?: unknown
  groupCode?: unknown
  value?: unknown
  sectionCode?: unknown
}

export interface ReportLimits {
  /** Глубина периода ПО ТИПУ отчёта: ключ — код типа. Типа нет в карте —
   * значит про него политика молчит, и это не «без ограничения». */
  maxPeriodDaysByType: Map<string, number>
  /** `null` — срок хранения политикой не задан. Сборка файла в этом случае
   * невозможна: артефакт без срока жил бы вечно, а §22.22 требует `expiresAt`. */
  retentionDays: number | null
  policyVersion: string | null
}

/**
 * Пределы отчётности из «Настроек». Отсутствие слайса или раздела даёт ПУСТУЮ
 * карту и `null`, а не значения по умолчанию: подставить «привычные» 90 дней
 * значило бы вернуть тот самый хардкод, ради переноса которого политика и
 * заведена.
 */
export function readReportLimits(slices: Readonly<Record<string, unknown>>): ReportLimits {
  const empty: ReportLimits = {
    maxPeriodDaysByType: new Map(),
    retentionDays: null,
    policyVersion: null,
  }
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return empty
  const raw = (slice as { settings?: unknown }).settings
  const versions = (slice as { sectionVersions?: unknown }).sectionVersions
  const policyVersion =
    versions !== null && typeof versions === 'object'
      ? (versions as Record<string, unknown>)[SECTION]
      : undefined
  if (!Array.isArray(raw) || typeof policyVersion !== 'string' || policyVersion === '') return empty

  const maxPeriodDaysByType = new Map<string, number>()
  let retentionDays: number | null = null
  for (const item of raw as SettingProjection[]) {
    if (item.sectionCode !== SECTION) continue
    if (typeof item.value !== 'number') continue
    if (typeof item.settingCode === 'string' && item.settingCode.startsWith(PERIOD_CODE_PREFIX)) {
      // Тип отчёта назван ГРУППОЙ, а не хвостом кода: код — идентификатор
      // записи, и разбирать его строкой значило бы завести второе правило
      // именования, о котором владелец политики не знает.
      const typeCode = typeof item.groupCode === 'string' ? item.groupCode : ''
      if (typeCode !== '') maxPeriodDaysByType.set(typeCode, item.value)
    }
    if (item.settingCode === RETENTION_CODE) retentionDays = item.value
  }
  return { maxPeriodDaysByType, retentionDays, policyVersion }
}
