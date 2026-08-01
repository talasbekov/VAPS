// Правила политики настроек (§29 «валидируются»). Чистая модель: ни React,
// ни apiClient — тестируется в env node.
import type { StoredSetting } from '../model/types'

/**
 * Следующая версия политики. Версия обязана меняться при КАЖДОМ принятом
 * изменении: снимок аналитики §22.11 несёт `policyVersion`, и если он не
 * сдвинулся, снимок утверждает, что считался по прежней методике — то есть
 * врёт о себе. Формат `<префикс>.<номер>`; растёт последний числовой сегмент.
 */
export function nextPolicyVersion(current: string): string {
  const match = /^(.*\.)(\d+)$/.exec(current)
  if (match === null) {
    // Без числового хвоста добавляем его, а не заменяем строку целиком:
    // префикс несёт дату методики и теряться не должен.
    return `${current}.2`
  }
  return `${match[1]}${Number(match[2]) + 1}`
}

/** Ошибки ФОРМЫ (400): по полям, канал RHF/details конверта §36. */
export function validateSettingValue(
  setting: StoredSetting,
  value: unknown,
): Record<string, string[]> {
  if (setting.kind === 'CHOICE') {
    // Вариант проверяется по списку, пришедшему с той же записью: принять код
    // вне списка значило бы завести режим, которого не знает ни один
    // потребитель политики.
    if (typeof value !== 'string' || !setting.options.some((option) => option.value === value)) {
      return { value: ['Выберите один из допустимых режимов.'] }
    }
    return {}
  }
  const errors: Record<string, string[]> = {}
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.value = ['Укажите числовое значение.']
    return errors
  }
  if (!Number.isInteger(value)) {
    errors.value = ['Значение задаётся целым числом.']
    return errors
  }
  if (value < setting.minValue || value > setting.maxValue) {
    errors.value = [
      `Допустимый диапазон — от ${setting.minValue} до ${setting.maxValue}.`,
    ]
  }
  return errors
}

/**
 * Подпись значения для журнала §29. Собирает СЕРВЕР — он владеет списком
 * вариантов; экран, собирающий её сам, держал бы второй словарь режимов и
 * рано или поздно разошёлся бы с первым.
 */
export function formatSettingValue(setting: StoredSetting, value: number | string): string {
  if (setting.kind === 'CHOICE') {
    const option = setting.options.find((item) => item.value === value)
    return option?.safeLabel ?? String(value)
  }
  return String(value)
}

export const REASON_MIN_LENGTH = 10
export const REASON_MAX_LENGTH = 500

/** Причина обязательна: §29 требует `reason` в записи журнала, а запись без
 * объяснения не отвечает на вопрос «почему порог другой». */
export function validateReason(reason: unknown): Record<string, string[]> {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (text.length < REASON_MIN_LENGTH) {
    return { reason: [`Опишите причину — не менее ${REASON_MIN_LENGTH} символов.`] }
  }
  if (text.length > REASON_MAX_LENGTH) {
    return { reason: [`Причина длиннее ${REASON_MAX_LENGTH} символов.`] }
  }
  return {}
}

/**
 * Согласованность ПАРЫ порогов одного детектора: «предупреждение» не может
 * начинаться позже «критично» — иначе критический уровень наступал бы раньше
 * предупреждения, и детектор объявлял бы критику там, где сам ещё не считает
 * ситуацию поводом предупредить. Проверка межполевая: значение по одному коду
 * законно само по себе и незаконно рядом с соседним.
 */
export function findThresholdOrderViolation(
  settings: readonly StoredSetting[],
  changedCode: string,
  nextValue: unknown,
): string | null {
  if (typeof nextValue !== 'number') return null
  const changed = settings.find((item) => item.settingCode === changedCode)
  if (changed === undefined) return null
  if (changed.field !== 'WARNING_FROM' && changed.field !== 'CRITICAL_FROM') return null

  const counterpartField = changed.field === 'WARNING_FROM' ? 'CRITICAL_FROM' : 'WARNING_FROM'
  const counterpart = settings.find(
    (item) =>
      item.groupCode === changed.groupCode &&
      item.field === counterpartField &&
      item.kind === 'NUMBER',
  )
  if (counterpart === undefined || counterpart.kind !== 'NUMBER') return null

  const warning = changed.field === 'WARNING_FROM' ? nextValue : counterpart.value
  const critical = changed.field === 'CRITICAL_FROM' ? nextValue : counterpart.value
  if (warning > critical) {
    return `Порог предупреждения (${warning}) не может быть выше критического (${critical}).`
  }
  return null
}
