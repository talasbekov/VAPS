// Чтение ЧУЖОГО слайса `settings` из общего demo-снапшота (§8.4).
//
// Тот же приём, что у аналитики, объектов, дежурств и отчётов: импорт из
// `features/settings` красный по ARCH-FE-013, поэтому выборку делает СЕРВЕР —
// рукописная УЗКАЯ проекция соседнего слайса. Согласованность формы с реальным
// сидом проверяет контрактный тест в `app/`.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Методику рейтинга задаёт раздел «Настройки»
// (§19.19 «период, минимальное количество оценок и правила включения приходят
// от policy»), а рейтинг её лишь применяет.
import type { RatingPolicy } from '../model/types'

export const SETTINGS_SLICE_NAME = 'settings'

const SECTION = 'RATING_POLICY'
const PERIOD_CODE = 'RATING.PERIOD.PARAMETER'
const MIN_EVALUATIONS_CODE = 'RATING.MIN_EVALUATIONS.PARAMETER'
const SUPPRESSION_CODE = 'RATING.SUPPRESSION_MIN_GROUP.PARAMETER'

interface SettingProjection {
  settingCode?: unknown
  value?: unknown
  sectionCode?: unknown
}

/**
 * `null` — методика не определена. Это ОТДЕЛЬНОЕ состояние, а не повод взять
 * значения по умолчанию: §19.19 требует показать «Методика расчёта не
 * определена», а подставленный период вернул бы ровно тот захардкоженный
 * «90 дней», который §19.1 называет ошибкой прототипа.
 *
 * Политика неполна (есть период, но нет минимума, или наоборот) — тоже `null`:
 * посчитать по половине методики и подписать её версией значило бы соврать о
 * том, как получено число.
 */
export function readRatingPolicy(slices: Readonly<Record<string, unknown>>): RatingPolicy | null {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const raw = (slice as { settings?: unknown }).settings
  const versions = (slice as { sectionVersions?: unknown }).sectionVersions
  const policyVersion =
    versions !== null && typeof versions === 'object'
      ? (versions as Record<string, unknown>)[SECTION]
      : undefined
  if (!Array.isArray(raw) || typeof policyVersion !== 'string' || policyVersion === '') return null

  let periodDays: number | null = null
  let minEvaluations: number | null = null
  for (const item of raw as SettingProjection[]) {
    if (item.sectionCode !== SECTION) continue
    if (typeof item.value !== 'number') continue
    if (item.settingCode === PERIOD_CODE) periodDays = item.value
    if (item.settingCode === MIN_EVALUATIONS_CODE) minEvaluations = item.value
  }
  if (periodDays === null || minEvaluations === null) return null
  return { periodDays, minEvaluations, policyVersion }
}

/**
 * Порог безопасной агрегации (§22.17 «privacy suppression приходят от policy»).
 *
 * Отдельная проекция, а не поле `RatingPolicy`: методика расчёта и правило
 * приватности отвечают на разные вопросы и отсутствуют порознь. Неполная
 * методика делает бессмысленным СЧЁТ, отсутствующий порог — ПУБЛИКАЦИЮ
 * отчёта; смешав их в один объект, пришлось бы гасить сводку из-за настройки,
 * которую она не читает.
 *
 * `null` — правило не задано. Подставить умолчание значило бы выбрать порог
 * приватности в коде экрана — ровно то, что §22.17 запрещает.
 */
export function readRatingSuppressionMinGroup(
  slices: Readonly<Record<string, unknown>>,
): number | null {
  const slice = slices[SETTINGS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const raw = (slice as { settings?: unknown }).settings
  if (!Array.isArray(raw)) return null
  for (const item of raw as SettingProjection[]) {
    if (item.sectionCode !== SECTION) continue
    if (item.settingCode !== SUPPRESSION_CODE) continue
    if (typeof item.value !== 'number') return null
    return item.value
  }
  return null
}
