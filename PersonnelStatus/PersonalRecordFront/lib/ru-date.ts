// Русские подписи ISO-дат (YYYY-MM-DD). Разбор — строкой и в UTC, а не через
// локальный Date: в отрицательных зонах `new Date("2026-08-25")` даёт 24
// августа, и «дата начала» в карточке уехала бы на сутки.

import { DAYS, ruCount } from "./ru-plural";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcOf(isoDate: string): Date | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
}

/** «2026-08-25» → «25.08.2026»; null — строка не ISO-дата. */
export function ruDate(isoDate: string): string | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** «2026-08-25» → «вторник»; null — строка не ISO-дата. */
export function ruWeekdayName(isoDate: string): string | null {
  const utc = utcOf(isoDate);
  if (utc === null) return null;
  return utc.toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
}

/**
 * Продолжительность в днях ВКЛЮЧИТЕЛЬНО: 25.08 → 25.08 это один день, а не
 * ноль. null — не ISO-даты либо окончание раньше начала: такую пару считать
 * нечем, и подставлять вместо неё «1 день» значило бы выдумать факт.
 */
export function daySpanInclusive(
  startIso: string,
  endIso: string
): number | null {
  const start = utcOf(startIso);
  const end = utcOf(endIso);
  if (start === null || end === null) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days < 1 ? null : days;
}

/** «1 день» · «2 дня» · «5 дней».
 *
 * Имя и подпись оставлены, заменено ТЕЛО (Plane №783): правило склонения
 * живёт в `lib/ru-plural.ts` одно на портал, а здесь у функции своя работа —
 * она про дни и её зовут по имени из четырёх мест. Собственная копия правила
 * была верной, но копия верна ровно до первой правки оригинала. */
export function ruDaysLabel(days: number): string {
  return ruCount(days, DAYS);
}
