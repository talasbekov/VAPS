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

/**
 * Метка времени сервера («2026-08-21T17:50:06.992336+00:00») → «21.08.2026,
 * 22:50» в местной зоне.
 *
 * В отличие от даты без времени, тут разбор часового пояса НУЖЕН: сервер
 * присылает момент, и показать его следует по часам того, кто смотрит.
 * Сырая ISO-строка в интерфейсе — не «точность», а непрочитанное значение:
 * микросекунды и «+00:00» человек всё равно отбрасывает глазом.
 */
export function formatIsoDateTime(value: string, fallback = "—"): string {
  if (value === "") return fallback;
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return fallback;
  return moment.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
