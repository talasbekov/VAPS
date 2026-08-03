// §21.7 «KPI реестра объектов». Чистая модель: ни React, ни apiClient —
// тестируется в env node.
//
// ⚠️ ГЛАВНОЕ ТРЕБОВАНИЕ §21.7: «Не используй фиксированный frontend-период
// („Паспорт старше 90 дней“). Срок актуальности должен приходить от policy:
// verificationDueAt / freshnessState / freshnessPolicyVersion». Поэтому:
//   • интервал живёт в ДАННЫХ (`PassportFreshnessPolicy`), а не константой;
//   • и срок, и состояние считаются ЗДЕСЬ, то есть на «сервере», и приходят
//     на экран готовыми — страница их не выводит и не сравнивает даты сама;
//   • ответ несёт версию политики, по которой он посчитан.
//
// Второе требование §21.7 — «Не считай KPI по текущей странице таблицы»:
// агрегаты считаются по ВСЕМУ реестру здесь же, а не по отрисованным строкам.
//
// Арифметика дат — только через `Date.UTC`, без локального `new Date(строка)`:
// это календарные дни, и разбор их в локальной зоне сдвигал бы день на машинах
// в минусовых таймзонах (см. feedback-vaps-date-guard-needs-negative-tz).
import type {
  PassportFreshness,
  PassportFreshnessPolicy,
  PassportFreshnessState,
  SecurityObject,
} from '../model/types'

/**
 * §35: показатель, который прототип называет, а модель не выдаёт. Форма та же,
 * что у `UnavailableMetric` в features/duties, и это СОЗНАТЕЛЬНЫЙ дубль: импорт
 * между фичами красный по ARCH-FE-013, а поднимать три строки в shared/ значило
 * бы вынести туда доменное понятие ради экономии трёх строк (тот же выбор, что
 * A58/A62 для узких проекций).
 */
export interface UnavailableMetric {
  code: string
  label: string
  reason: string
}

export function addDays(date: string, amount: number): string {
  const year = Number(date.slice(0, 4))
  const monthIndex = Number(date.slice(5, 7)) - 1
  const day = Number(date.slice(8, 10))
  return new Date(Date.UTC(year, monthIndex, day + amount)).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/** Последняя по номеру опубликованная версия; `null` — публикаций не было. */
function latestVersion(object: SecurityObject) {
  if (object.passportVersions.length === 0) return null
  return object.passportVersions.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best,
  )
}

/**
 * §21.7. Срок проверки отсчитывается от `effectiveFrom` ПОСЛЕДНЕЙ публикации:
 * актуальность паспорта задаёт то, когда его в последний раз утвердили, а не
 * когда правили черновик (правка черновика — ещё не проверка).
 */
export function resolveFreshness(
  object: SecurityObject,
  policy: PassportFreshnessPolicy,
  businessDate: string,
): PassportFreshness {
  const version = latestVersion(object)
  if (version === null) {
    return {
      objectId: object.id,
      state: 'NO_PUBLISHED_VERSION',
      verificationDueAt: null,
      freshnessPolicyVersion: policy.version,
    }
  }
  const verificationDueAt = addDays(version.effectiveFrom, policy.verificationIntervalDays)
  const daysLeft = daysBetween(businessDate, verificationDueAt)
  // Порог «скоро» тоже ПРИХОДИТ ОТ POLICY: доля интервала была константой в
  // этом файле, то есть вторым захардкоженным числом периода рядом с
  // настраиваемым первым (§21.7 запрещает именно это).
  const dueSoonThreshold = Math.ceil(
    (policy.verificationIntervalDays * policy.dueSoonPercent) / 100,
  )
  const state: PassportFreshnessState =
    daysLeft < 0 ? 'OVERDUE' : daysLeft <= dueSoonThreshold ? 'DUE_SOON' : 'FRESH'
  return {
    objectId: object.id,
    state,
    verificationDueAt,
    freshnessPolicyVersion: policy.version,
  }
}

/** §21.7, серверные агрегаты. Считаются по ВСЕМУ переданному реестру —
 * вызывающий обязан передать его целиком, а не отрисованную страницу. */
export interface ObjectsRegistryKpi {
  total: number
  passportGreen: number
  passportYellow: number
  passportRed: number
  /** Срок проверки прошёл (по действующей политике). */
  verificationOverdue: number
  /** Паспорт ни разу не публиковали. */
  neverPublished: number
}

export function buildObjectsKpi(
  objects: readonly SecurityObject[],
  freshness: readonly PassportFreshness[],
): ObjectsRegistryKpi {
  const stateById = new Map(freshness.map((item) => [item.objectId, item.state]))
  return {
    total: objects.length,
    passportGreen: objects.filter((object) => object.passportState === 'GREEN').length,
    passportYellow: objects.filter((object) => object.passportState === 'YELLOW').length,
    passportRed: objects.filter((object) => object.passportState === 'RED').length,
    verificationOverdue: objects.filter((object) => stateById.get(object.id) === 'OVERDUE').length,
    neverPublished: objects.filter(
      (object) => stateById.get(object.id) === 'NO_PUBLISHED_VERSION',
    ).length,
  }
}

/**
 * §21.5 «состояние паспорта и актуальность — РАЗНЫЕ поля, не один бейдж».
 * Подписи обязаны отличаться и НА СЛОВАХ: `PassportState.GREEN` уже называется
 * «Актуален», и одноимённое состояние срока давало в таблице два одинаковых
 * слова в соседних колонках (поймано e2e).
 */
export const FRESHNESS_LABEL: Record<PassportFreshnessState, string> = {
  FRESH: 'Срок соблюдён',
  DUE_SOON: 'Скоро проверка',
  OVERDUE: 'Проверка просрочена',
  NO_PUBLISHED_VERSION: 'Не публиковался',
}
