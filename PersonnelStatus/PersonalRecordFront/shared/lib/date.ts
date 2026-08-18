// Показ дат, приходящих с бэка строкой «ГГГГ-ММ-ДД».
//
// 🔴 Зачем не `new Date(value)`. Строку без времени движок читает как
// UTC-полночь, а печатает в местной зоне: в любой МИНУСОВОЙ зоне «2026-08-14»
// превращается в 13.08.2026. Машины разработчиков стоят в +05, поэтому дефект
// не виден вовсе — та же яма уже ловилась в проекте дважды.
//
// Здесь строка разбирается по частям и собирается в местную дату, минуя
// разбор часового пояса.

/** Разобрать «ГГГГ-ММ-ДД» в местную дату. `null` — строка не дата. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * «ГГГГ-ММ-ДД» → «14.08.2026». Пустая строка и мусор дают `fallback`: подпись
 * поля с пустым значением читается как «не заполнено», а это разные вещи.
 */
export function formatIsoDate(value: string, fallback = "—"): string {
  const date = parseIsoDate(value);
  return date === null ? fallback : date.toLocaleDateString("ru-RU");
}

/** То же словами: «14 августа 2026 г.» — для карточек, а не для таблиц. */
export function formatIsoDateLong(value: string, fallback = "—"): string {
  const date = parseIsoDate(value);
  return date === null
    ? fallback
    : date.toLocaleDateString("ru-RU", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}
