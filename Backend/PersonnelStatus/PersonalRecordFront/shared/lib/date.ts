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

/**
 * День и время БЕЗ ГОДА — формат журнала штаба (Plane №730).
 *
 * Отдельная функция, а не параметр у `formatIsoDateTime`: там год есть и
 * нужен (документы, архив), здесь его намеренно нет — записи журнала
 * читаются в пределах мероприятия, и год в каждой строке был бы шумом.
 *
 * 🔴 ПРОВЕРКА НА NaN — И ЕСТЬ ПРЕДМЕТ. `new Date(...)` от неразбираемой
 * строки даёт `Invalid Date`, и `toLocaleString` печатает её БУКВАЛЬНО. Поле
 * `occurredAt` приходит из JSON мероприятия как есть, поэтому клиент,
 * приславший `"10:15"`, заставлял панель нарисовать «Invalid Date» человеку.
 * Соседний вид (`ClosedView`) уже был защищён `formatIsoDateTime`, и два
 * вида на одни данные расходились.
 */
export function formatIsoDayTime(value: string, fallback = "—"): string {
  if (value === "") return fallback;
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return fallback;
  return moment.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BULLETIN_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;
const BULLETIN_WEEKDAYS = ["пн.", "вт.", "ср.", "чт.", "пт.", "сб.", "вс."] as const;

/**
 * Период мероприятия в формате бюллетеня (`[МД-10]`, Plane №438): без года,
 * с днями недели — «20-23 апреля (пн.-чт.)», «24 апреля (пт.)»,
 * «30 апреля - 2 мая (чт.-сб.)». Зеркало `documents_bulletin.format_period`
 * сервера: превью в окне создания обязано показывать то, что напечатает
 * документ. Пустое начало — пусто.
 */
export function formatBulletinPeriod(startIso: string, endIso: string | null): string {
  const start = parseIsoDate(startIso);
  if (start === null) return "";
  const end = endIso === null || endIso === "" ? null : parseIsoDate(endIso);
  const wd = (d: Date) => BULLETIN_WEEKDAYS[(d.getDay() + 6) % 7];
  const month = (d: Date) => BULLETIN_MONTHS[d.getMonth()];
  if (end === null || end.getTime() === start.getTime()) {
    return `${start.getDate()} ${month(start)} (${wd(start)})`;
  }
  const days =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
      ? `${start.getDate()}-${end.getDate()} ${month(start)}`
      : `${start.getDate()} ${month(start)} - ${end.getDate()} ${month(end)}`;
  return `${days} (${wd(start)}-${wd(end)})`;
}
