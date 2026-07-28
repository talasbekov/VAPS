// Sensitive identity личного состава (§20.27 «Персональные данные», §20.28
// permissions, §20.33 audit). Чистая модель: ни React, ни apiClient —
// тестируется в env node.
//
// ⚠️ ГЛАВНОЕ СВОЙСТВО. §20.27 требует маскировать ИИН по умолчанию, а §20.29 —
// «list endpoint должен возвращать безопасную проекцию, а не полную карточку».
// Поэтому маска считается ЗДЕСЬ и вызывается из mock-repository (нашего
// «сервера»): в проекции личного состава полного ИИН нет ВООБЩЕ — ни в ответе,
// ни в кэше, ни в DOM. Маскирование в вёрстке маскированием не является:
// значение всё равно доехало бы до клиента и осталось бы в query cache у
// любого, кто открыл список.

/** Сколько последних цифр ИИН остаётся видимыми. Четыре — минимум, по которому
 * человек узнаёт «свою» строку, не раскрывая идентификатор. */
const VISIBLE_TAIL = 4

/**
 * Маска ИИН. Длина маскированной части НЕ повторяет длину значения дословно —
 * она фиксирована по формату ИИН (12 цифр), чтобы по маске нельзя было судить
 * о длине исходного значения у нестандартных записей.
 */
export function maskIin(iin: string): string {
  const digits = iin.trim()
  if (digits.length <= VISIBLE_TAIL) {
    // Значение короче хвоста — показывать нечего, кроме того, что оно есть.
    return '••••••••••••'
  }
  return `${'•'.repeat(12 - VISIBLE_TAIL)}${digits.slice(-VISIBLE_TAIL)}`
}

/** §20.27: раскрытие требует ЦЕЛИ. Пустая строка и «-» целью не являются —
 * иначе поле было бы формальностью, а аудит бессодержательным. */
export const MIN_PURPOSE_LENGTH = 10

export function isValidPurpose(purpose: string): boolean {
  return purpose.trim().length >= MIN_PURPOSE_LENGTH
}

/**
 * §20.27 «authority period» — раскрытие действует ограниченное время.
 *
 * Пятнадцать минут: раскрытие делается для КОНКРЕТНОГО действия, а не «на
 * сессию». Срок — свойство выданного полномочия, поэтому приходит в ответе
 * (`expiresAt`), а не считается на клиенте: клиентские часы к сроку доступа
 * отношения не имеют.
 */
export const DISCLOSURE_TTL_MINUTES = 15

export function disclosureExpiry(disclosedAtIso: string): string {
  return new Date(
    new Date(disclosedAtIso).getTime() + DISCLOSURE_TTL_MINUTES * 60_000,
  ).toISOString()
}

/** Раскрытие ещё действует. Сравнение моментов времени, не календарных дат —
 * `Date` здесь корректен (см. тот же приём в шапке месячного плана). */
export function isDisclosureActive(expiresAtIso: string, nowIso: string): boolean {
  return new Date(nowIso).getTime() < new Date(expiresAtIso).getTime()
}

/**
 * Сколько ДЛИТСЯ выданное полномочие.
 *
 * ⚠️ Почему клиент отсчитывает длительность, а не сравнивает `expiresAt` со
 * своими часами: время сервера и время клиента — разные шкалы. В demo-режиме
 * это видно невооружённым глазом (DemoClock живёт в сценарной дате, часы машины
 * — в сегодняшней, §8.8), и наивное сравнение объявляло бы только что выданное
 * полномечие истёкшим. Но и с настоящим backend расхождение часов существует —
 * просто меньше. Длительность инвариантна к сдвигу шкал: полномочие действует
 * N минут С МОМЕНТА ВЫДАЧИ, и этот момент клиент знает точно — это момент,
 * когда он получил ответ.
 *
 * Отрицательная длительность (сервер выдал уже истёкшее полномочие) —
 * законный исход: она означает «не действует», а не ошибку.
 */
export function disclosureDurationMs(disclosedAtIso: string, expiresAtIso: string): number {
  return new Date(expiresAtIso).getTime() - new Date(disclosedAtIso).getTime()
}

/**
 * §20.33 «не помещай чувствительные значения целиком в audit payload, если для
 * этого нет отдельного permission и policy».
 *
 * Запись журнала раскрытий НЕ содержит ИИН ни в каком виде — ни целиком, ни
 * хвостом: журнал отвечает на вопрос «кто, когда и зачем смотрел», а не «что
 * именно увидел». Отдельного permission на хранение значения в аудите проект
 * не заводит, поэтому и значения в записи нет.
 */
export interface IdentityDisclosureRecord {
  disclosureId: string
  employeeId: string
  actorUserId: string
  purpose: string
  disclosedAt: string
  expiresAt: string
}

/** Ответ на раскрытие: значение живёт ТОЛЬКО здесь и только пока действует
 * полномочие. В журнал (`IdentityDisclosureRecord`) оно не попадает. */
export interface IdentityDisclosure {
  disclosureId: string
  employeeId: string
  iin: string
  disclosedAt: string
  expiresAt: string
}
