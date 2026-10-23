import type { DutyInterval, DutyPlacement } from "@/entities/duty-assignment";

export const DUTY_TIME_ZONE = "Asia/Almaty";
export const MAX_DUTY_INTERVALS = 256;
export interface DutyIntervalDraft {
  start: string; end: string;
  /** Retain the exact fold of a saved timestamp when historic clocks repeat. */
  original?: DutyInterval;
}
export interface DutyIntervalIssue { index?: number; field?: "start" | "end"; message: string }

const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: DUTY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23",
});
function localDateTime(milliseconds: number): string {
  const parts = Object.fromEntries(clock.formatToParts(new Date(milliseconds)).map(part => [part.type, part.value]));
  const fraction = parts.fractionalSecond !== "000" ? `.${parts.fractionalSecond}` : "";
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${fraction}`;
}
function normalizedCivil(value: string): string {
  const [whole, fraction] = value.split(".");
  const seconds = whole.length === 16 ? `${whole}:00` : whole;
  return fraction && Number(fraction) !== 0 ? `${seconds}.${fraction.padEnd(3, "0")}` : seconds;
}
function civilMilliseconds(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return NaN;
  const full = normalizedCivil(value);
  const milliseconds = Date.parse(`${full}Z`);
  return Number.isFinite(milliseconds) && full.slice(0, 4) !== "0000" && normalizedCivil(new Date(milliseconds).toISOString().slice(0, 23)) === full
    ? milliseconds : NaN;
}

function timestampWithOffset(normalized: string, civil: number, offsetMilliseconds: number): string {
  const offsetMinutes = offsetMilliseconds / 60000;
  // Some early historic IANA offsets include seconds, unsupported by Date.parse.
  if (!Number.isInteger(offsetMinutes)) return new Date(civil - offsetMilliseconds).toISOString();
  const absolute = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${normalized}${offset}`;
}

/** Resolve civil time in Astana without using the browser's time zone.
 * Looking on both sides of a transition detects ambiguous/nonexistent times.
 */
export function dutyTimestampForSave(value: string, original?: string): string {
  const civil = civilMilliseconds(value);
  if (!Number.isFinite(civil)) throw new Error("Укажите допустимые дату и время.");
  const normalized = normalizedCivil(value);
  const originalMilliseconds = original ? Date.parse(original) : NaN;
  if (Number.isFinite(originalMilliseconds) && localDateTime(originalMilliseconds) === normalized) {
    return timestampWithOffset(normalized, civil, civil - originalMilliseconds);
  }
  const candidates = new Map<number, number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = civil + delta;
    const offset = civilMilliseconds(localDateTime(probe)) - probe;
    if (!Number.isFinite(offset)) continue;
    const candidate = civil - offset;
    if (localDateTime(candidate) === normalized) candidates.set(candidate, offset);
  }
  if (candidates.size !== 1) throw new Error("Это местное время не существует или неоднозначно из-за перевода часов. Уточните время выхода.");
  return timestampWithOffset(normalized, civil, [...candidates.values()][0]);
}

export function dutyTimestampForInput(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return value;
  return localDateTime(Date.parse(value));
}

export function dutyIntervalDrafts(placement: Pick<DutyPlacement, "intervals"> | null | undefined): DutyIntervalDraft[] | undefined {
  return placement?.intervals?.map(interval => ({ start: dutyTimestampForInput(interval.start_at), end: dutyTimestampForInput(interval.end_at), original: interval }));
}

/** A replacement creates a new period; copy only its remaining exits.
 * The source status and a calendar plan are never modified by this operation.
 */
export function dutyIntervalsForNewStatus(placement: Pick<DutyPlacement, "intervals"> | null | undefined, date: string | undefined) {
  if (placement?.intervals === undefined || !date) return { intervals: dutyIntervalDrafts(placement), adjusted: false };
  const cutoffTimestamp = dutyTimestampForSave(`${date}T00:00`), cutoff = Date.parse(cutoffTimestamp);
  let adjusted = false;
  const remaining = placement.intervals.flatMap(interval => {
    if (Date.parse(interval.end_at) <= cutoff) { adjusted = true; return []; }
    if (Date.parse(interval.start_at) < cutoff) { adjusted = true; return [{ ...interval, start_at: cutoffTimestamp }]; }
    return [interval];
  });
  return { intervals: dutyIntervalDrafts({ intervals: remaining }), adjusted };
}

export function dutyIntervalsPayload(intervals: readonly DutyIntervalDraft[] | undefined): { intervals?: DutyInterval[]; time_zone?: string } {
  return intervals === undefined ? {} : {
    intervals: intervals.map(interval => ({ start_at: dutyTimestampForSave(interval.start, interval.original?.start_at), end_at: dutyTimestampForSave(interval.end, interval.original?.end_at) })),
    time_zone: DUTY_TIME_ZONE,
  };
}

/** Half-open intervals ending at midnight do not occupy the following day. */
export function dutyIntervalsOnDate(intervals: readonly DutyInterval[], date: string): DutyInterval[] {
  const nextDayMilliseconds = civilMilliseconds(`${date}T00:00`) + 86400000;
  if (!Number.isFinite(nextDayMilliseconds)) return [];
  const nextDay = new Date(nextDayMilliseconds).toISOString().slice(0, 10);
  const start = Date.parse(dutyTimestampForSave(`${date}T00:00`));
  const end = nextDay.startsWith("+") ? Infinity : Date.parse(dutyTimestampForSave(`${nextDay}T00:00`));
  return intervals.filter(interval => Date.parse(interval.start_at) < end && Date.parse(interval.end_at) > start);
}

function civilDay(value: Date | string | null | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (!value || Number.isNaN(value.getTime())) return undefined;
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function validateDutyIntervals(intervals: readonly DutyIntervalDraft[] | undefined,
  startDate?: Date | string | null, endDate?: Date | string | null): DutyIntervalIssue[] {
  if (!intervals) return [];
  if (intervals.length > MAX_DUTY_INTERVALS) return [{ message: `Допустимо не более ${MAX_DUTY_INTERVALS} выходов.` }];
  const issues: DutyIntervalIssue[] = [];
  const startDay = civilDay(startDate), endDay = civilDay(endDate);
  const periodStart = startDay ? civilMilliseconds(`${startDay}T00:00`) : NaN;
  const periodEnd = endDay ? civilMilliseconds(`${endDay}T00:00`) + 86400000 : NaN;
  const valid: { index: number; start: number; end: number }[] = [];
  intervals.forEach((interval, index) => {
    const resolved: Partial<Record<"start" | "end", number>> = {};
    for (const field of ["start", "end"] as const) {
      if (!interval[field]) { issues.push({ index, field, message: field === "start" ? "Укажите дату и время начала выхода." : "Укажите дату и время окончания выхода." }); continue; }
      try { resolved[field] = Date.parse(dutyTimestampForSave(interval[field], field === "start" ? interval.original?.start_at : interval.original?.end_at)); }
      catch (error) { issues.push({ index, field, message: error instanceof Error ? error.message : "Уточните дату и время." }); }
    }
    if (resolved.start === undefined || resolved.end === undefined) return;
    if (resolved.end <= resolved.start) { issues.push({ index, field: "end", message: "Окончание должно быть позже начала. Для ночного выхода укажите следующую дату." }); return; }
    if (Number.isFinite(periodStart) && civilMilliseconds(interval.start) < periodStart) issues.push({ index, field: "start", message: "Выход начинается раньше периода статуса. Измените дату выхода или период." });
    if (Number.isFinite(periodEnd) && civilMilliseconds(interval.end) > periodEnd) issues.push({ index, field: "end", message: "Выход заканчивается после периода статуса. Измените дату выхода или период." });
    valid.push({ index, start: resolved.start, end: resolved.end });
  });
  valid.sort((a, b) => a.start - b.start);
  let previousEnd = -Infinity;
  for (const interval of valid) {
    if (interval.start < previousEnd) issues.push({ index: interval.index, field: "start", message: "Выходы пересекаются. Уточните время начала или окончания." });
    previousEnd = Math.max(previousEnd, interval.end);
  }
  return issues;
}

export function dutyIntervalLabel(interval: DutyInterval): string {
  const display = (value: string) => {
    const local = dutyTimestampForInput(value);
    const [date, time] = local.split("T");
    const clockTime = time && /[1-9]/.test(time.slice(6)) ? time : time?.slice(0, 5) ?? "";
    return `${date.split("-").reverse().join(".")} ${clockTime}`;
  };
  return `${display(interval.start_at)} — ${display(interval.end_at)}`;
}
