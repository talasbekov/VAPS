// Календарная арифметика «Календаря смен» (§21.4, третье представление того
// же набора данных). ЧИСТЫЕ функции над строками `YYYY-MM-DD` — без `new
// Date()` от локального времени и без таймзонных сдвигов: `Date.UTC` берёт
// компоненты дословно, поэтому результат одинаков в +05 и в -08 (машина в
// плюсовой зоне иначе прятала бы сдвиг суток — см. инциденты 10.5/10.7).

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = ISO_DATE_RE.exec(iso)
  if (match === null) {
    throw new Error(`calendar: ожидалась дата в формате ГГГГ-ММ-ДД, получено "${iso}"`)
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function formatIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function toEpochUtc(iso: string): number {
  const { y, m, d } = parseIsoDate(iso)
  return Date.UTC(y, m - 1, d)
}

/** Сдвиг календарной даты на N суток (знаковый), без часового пояса. */
export function addDaysIso(iso: string, days: number): string {
  return formatIsoDate(toEpochUtc(iso) + days * 86_400_000)
}

/** Понедельник недели, содержащей `iso` (неделя начинается с понедельника). */
export function startOfWeekIso(iso: string): string {
  const epoch = toEpochUtc(iso)
  const dayOfWeek = new Date(epoch).getUTCDay() // 0 = воскресенье
  const shift = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  return formatIsoDate(epoch + shift * 86_400_000)
}

/** Семь дат недели, начиная с `weekStart` (понедельник … воскресенье). */
export function weekDaysIso(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index))
}

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const

/** Короткая подпись дня недели («пн») — для шапки колонок календаря. */
export function weekdayShortLabel(iso: string): string {
  return WEEKDAY_SHORT[new Date(toEpochUtc(iso)).getUTCDay()]
}

/** Номер дня месяца без ведущего нуля («18») — вторая строка шапки колонки. */
export function dayOfMonthLabel(iso: string): string {
  return String(parseIsoDate(iso).d)
}

const MONTH_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

/** Подпись диапазона недели («14–20 июля 2026»), как в прототипе КалендарьСмен. */
export function weekRangeLabel(weekStart: string): string {
  const weekEnd = addDaysIso(weekStart, 6)
  const from = parseIsoDate(weekStart)
  const to = parseIsoDate(weekEnd)
  const head =
    from.m === to.m ? `${from.d}–${to.d}` : `${from.d} ${MONTH_GENITIVE[from.m - 1]} – ${to.d}`
  return `${head} ${MONTH_GENITIVE[to.m - 1]} ${to.y}`
}
