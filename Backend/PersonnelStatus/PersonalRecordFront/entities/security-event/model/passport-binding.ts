// Привязка планирования ОМ к опубликованной версии паспорта объекта.
// Чистая модель без React/клиента. Для планирования используется конкретная
// опубликованная версия, действующая на дату операции; отсутствие подходящей
// версии обрабатывается ЯВНО, а не молчаливой подстановкой последней.
//
// Сравнение дат — лексикографическое по YYYY-MM-DD, БЕЗ new Date():
// бизнес-дата и effectiveFrom — календарные дни, разбор в Date внёс бы
// зависимость от таймзоны машины.
import type { PassportBinding } from "./types";

/** Узкая проекция версии паспорта — ровно то, из чего строится расчёт ОМ. */
export interface PassportPostProjection {
  id: string;
  name: string;
  task: string;
  requirements: string;
}

export interface PassportSectorProjection {
  id: string;
  name: string;
  posts: PassportPostProjection[];
}

export interface PassportVersionProjection {
  id: string;
  versionNumber: number;
  /** Дата, с которой версия действует (YYYY-MM-DD). */
  effectiveFrom: string;
  sectors: PassportSectorProjection[];
}

export interface SecurityObjectProjection {
  id: string;
  name: string;
  code: string;
  passportVersions: PassportVersionProjection[];
}

/**
 * Версия, действующая на дату операции: последняя по номеру среди тех, чей
 * effectiveFrom не позже даты; null — подходящей опубликованной версии нет.
 */
export function resolveApplicableVersion(
  object: SecurityObjectProjection,
  businessDate: string
): PassportVersionProjection | null {
  const applicable = object.passportVersions.filter(
    (version) => version.effectiveFrom <= businessDate
  );
  if (applicable.length === 0) {
    return null;
  }
  return applicable.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best
  );
}

export function bindPassportVersion(
  object: SecurityObjectProjection,
  version: PassportVersionProjection,
  boundAt: string
): PassportBinding {
  return {
    objectId: object.id,
    objectName: object.name,
    versionId: version.id,
    versionNumber: version.versionNumber,
    effectiveFrom: version.effectiveFrom,
    boundAt,
  };
}

/**
 * Привязка устарела, когда на ту же дату действует версия НОВЕЕ привязанной.
 * Это предупреждение, а не ошибка: перепривязка — отдельное решение человека.
 */
export function isBindingStale(
  binding: PassportBinding,
  applicable: PassportVersionProjection | null
): boolean {
  if (applicable === null) {
    return false;
  }
  return applicable.versionNumber > binding.versionNumber;
}

export const NO_PUBLISHED_VERSION_TEXT =
  "На дату мероприятия нет опубликованной версии паспорта объекта — расчёт постов ведётся вручную.";

export const NO_OBJECT_TEXT =
  "Мероприятие не привязано к объекту реестра — версия паспорта не определена.";

export function staleBindingText(
  bindingVersion: number,
  applicableVersion: number
): string {
  return `Действующая редакция паспорта — версия ${applicableVersion}, мероприятие привязано к версии ${bindingVersion}. Расстановка не переписывается автоматически.`;
}
