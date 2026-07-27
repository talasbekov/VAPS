// Привязка дежурства к опубликованной версии паспорта объекта (§9.6
// L3767-3791: «дежурство или расстановка должны ссылаться минимум на
// objectId / passportVersionId / sectorId / postId»). Чистая модель: ни
// React, ни apiClient — тестируется в env node.
//
// ⚠️ ГРАНИЦА СЛОЁВ. Версии паспорта принадлежат `features/objects`, импорт
// оттуда красный по ARCH-FE-013 — поэтому здесь РУКОПИСНАЯ УЗКАЯ ПРОЕКЦИЯ
// чужой формы, тот же осознанный приём, что в
// `features/security-events/lib/passportBinding.ts` и в
// `features/print-forms/placementPrint.ts` (FRONTEND_DECISIONS A58).
//
// Почему НЕ переиспользован модуль security-events: кросс-фичевый импорт
// запрещён тем же ARCH-FE-013, а сама привязка у дежурства ДРУГАЯ — ОМ
// привязывается к объекту целиком (расчёт постов строит рекогносцировка),
// дежурство же заступает на КОНКРЕТНЫЙ пост, поэтому снимок несёт ещё
// sectorId/postId. Общий у двух модулей только выбор действующей версии;
// поднимать его в shared/ значило бы вынести доменное знание туда, где
// сейчас нет ни одного доменного модуля — цена выше выигрыша.
import type { DutyPassportBinding } from '../model/types'

export interface DutyPostProjection {
  id: string
  name: string
}

export interface DutySectorProjection {
  id: string
  name: string
  posts: DutyPostProjection[]
}

export interface DutyPassportVersionProjection {
  id: string
  versionNumber: number
  /** Дата, с которой версия действует (YYYY-MM-DD). */
  effectiveFrom: string
  sectors: DutySectorProjection[]
}

export interface DutyObjectProjection {
  id: string
  name: string
  code: string
  passportVersions: DutyPassportVersionProjection[]
}

/**
 * Версия, действующая на дату дежурства: последняя по номеру среди тех, чей
 * `effectiveFrom` не позже даты. `null` — §9.6 «отсутствие подходящей
 * опубликованной версии обрабатывается явно».
 *
 * Сравнение дат — лексикографическое по YYYY-MM-DD, БЕЗ `new Date()`:
 * businessDate дежурства и `effectiveFrom` — календарные даты, не моменты
 * времени, и разбор их в Date внёс бы зависимость от таймзоны машины
 * (см. feedback-vaps-date-guard-needs-negative-tz).
 */
export function resolveApplicableVersion(
  object: DutyObjectProjection,
  businessDate: string,
): DutyPassportVersionProjection | null {
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

/** Первый пост версии в порядке секторов — для demo-сида и дефолта формы. */
export function firstPostOfVersion(
  version: DutyPassportVersionProjection,
): { sector: DutySectorProjection; post: DutyPostProjection } | null {
  for (const sector of version.sectors) {
    const post = sector.posts[0]
    if (post !== undefined) {
      return { sector, post }
    }
  }
  return null
}

/**
 * Снимок привязки. `null` — когда пост не найден в этой версии: пост мог
 * исчезнуть при публикации новой редакции, и молча привязать дежурство к
 * «какому-нибудь» посту хуже, чем честно показать отсутствие привязки.
 */
export function bindDutyPost(
  object: DutyObjectProjection,
  version: DutyPassportVersionProjection,
  sectorId: string,
  postId: string,
  boundAt: string,
): DutyPassportBinding | null {
  const sector = version.sectors.find((candidate) => candidate.id === sectorId)
  const post = sector?.posts.find((candidate) => candidate.id === postId)
  if (sector === undefined || post === undefined) {
    return null
  }
  return {
    objectId: object.id,
    objectName: object.name,
    versionId: version.id,
    versionNumber: version.versionNumber,
    effectiveFrom: version.effectiveFrom,
    sectorId: sector.id,
    sectorName: sector.name,
    postId: post.id,
    postName: post.name,
    boundAt,
  }
}

/**
 * §9.6 «будущий черновик может получить предупреждение об устаревшей версии».
 * Устарела — когда на ту же дату действует версия НОВЕЕ привязанной. Это
 * предупреждение, а не ошибка: перепривязка — отдельное решение человека
 * (в этом срезе не реализована, см. FRONTEND_DECISIONS).
 */
export function isBindingStale(
  binding: DutyPassportBinding,
  applicable: DutyPassportVersionProjection | null,
): boolean {
  if (applicable === null) {
    return false
  }
  return applicable.versionNumber > binding.versionNumber
}

export const NO_REGISTRY_OBJECT_TEXT =
  'Объект дежурства не заведён в реестре объектов — версия паспорта не определена.'

export const NO_PUBLISHED_VERSION_TEXT =
  'На дату дежурства нет опубликованной версии паспорта объекта — пост назначен вне паспорта.'

export const NO_BINDABLE_POST_TEXT =
  'В действующей версии паспорта нет постов — привязать дежурство не к чему.'

export function stalePostBindingText(
  bindingVersion: number,
  applicableVersion: number,
): string {
  return `Действующая редакция паспорта — версия ${applicableVersion}, дежурство привязано к версии ${bindingVersion}. Пост не переназначается автоматически.`
}
