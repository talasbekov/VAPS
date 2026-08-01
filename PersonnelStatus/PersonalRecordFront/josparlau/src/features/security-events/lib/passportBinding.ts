// Привязка планирования к опубликованной версии паспорта объекта
// (мастер-промпт §9.6 L3767-3791). Чистая модель: ни React, ни apiClient —
// тестируется в env node.
//
// §9.6 дословно: «Для планирования используется конкретная опубликованная
// версия паспорта, действующая на дату операции», а «дежурство или расстановка
// должны ссылаться минимум на objectId / passportVersionId / sectorId / postId».
//
// ⚠️ ГРАНИЦА СЛОЁВ. Версии паспорта принадлежат `features/objects`, а импорт
// оттуда красный по ARCH-FE-013. Поэтому здесь — РУКОПИСНАЯ УЗКАЯ ПРОЕКЦИЯ
// чужих данных (`PassportVersionProjection`), тот же осознанный приём, что в
// `features/print-forms/placementPrint.ts` (FRONTEND_DECISIONS A58). Проекция
// нарочно уже реального `PassportVersion`: `publishedBy`/`note`/`publishedAt`
// планированию не нужны, а чем уже зеркало — тем меньше поверхность дрейфа.
//
// Сам снимок привязки (`PassportBinding`) живёт в `model/types.ts` — это часть
// модели ОМ, а не внешних данных: его хранит и отдаёт repository.
import type { PassportBinding } from '../model/types'

/** Пост внутри снимка версии паспорта — ровно то, из чего строится расчёт ОМ. */
export interface PassportPostProjection {
  id: string
  name: string
  task: string
  requirements: string
}

export interface PassportSectorProjection {
  id: string
  name: string
  posts: PassportPostProjection[]
}

export interface PassportVersionProjection {
  id: string
  versionNumber: number
  /** Дата, с которой версия действует (YYYY-MM-DD). */
  effectiveFrom: string
  sectors: PassportSectorProjection[]
}

export interface SecurityObjectProjection {
  id: string
  name: string
  code: string
  passportVersions: PassportVersionProjection[]
}

/**
 * Версия, действующая на дату операции: последняя по номеру среди тех, чей
 * `effectiveFrom` не позже даты. `null` — §9.6 «отсутствие подходящей
 * опубликованной версии обрабатывается явно» (вызывающий обязан показать
 * причину, а не молча подставить последнюю попавшуюся).
 *
 * Сравнение дат — лексикографическое по YYYY-MM-DD, БЕЗ `new Date()`:
 * бизнес-дата ОМ и `effectiveFrom` — календарные, не моменты времени, и
 * разбор их в Date внёс бы зависимость от таймзоны машины
 * (см. feedback-vaps-date-guard-needs-negative-tz).
 */
export function resolveApplicableVersion(
  object: SecurityObjectProjection,
  businessDate: string,
): PassportVersionProjection | null {
  const applicable = object.passportVersions.filter(
    (version) => version.effectiveFrom <= businessDate,
  )
  if (applicable.length === 0) {
    return null
  }
  return applicable.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best,
  )
}

export function bindPassportVersion(
  object: SecurityObjectProjection,
  version: PassportVersionProjection,
  boundAt: string,
): PassportBinding {
  return {
    objectId: object.id,
    objectName: object.name,
    versionId: version.id,
    versionNumber: version.versionNumber,
    effectiveFrom: version.effectiveFrom,
    boundAt,
  }
}

/**
 * §9.6 «будущий черновик может получить предупреждение об устаревшей версии».
 * Устарела — когда на ту же дату сейчас действует версия НОВЕЕ привязанной.
 * Это предупреждение, а не ошибка: перепривязка — отдельное решение человека.
 */
export function isBindingStale(
  binding: PassportBinding,
  applicable: PassportVersionProjection | null,
): boolean {
  if (applicable === null) {
    return false
  }
  return applicable.versionNumber > binding.versionNumber
}

export const NO_PUBLISHED_VERSION_TEXT =
  'На дату мероприятия нет опубликованной версии паспорта объекта — расчёт постов ведётся вручную.'

export const NO_OBJECT_TEXT =
  'Мероприятие не привязано к объекту реестра — версия паспорта не определена.'

export function staleBindingText(bindingVersion: number, applicableVersion: number): string {
  return `Действующая редакция паспорта — версия ${applicableVersion}, мероприятие привязано к версии ${bindingVersion}. Расстановка не переписывается автоматически.`
}
