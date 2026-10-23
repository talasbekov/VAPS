import type { DutyPlacement } from "@/entities/duty-assignment";

export interface CalendarStatusContext {
  date: string;
  /** Canonical code from the calendar, never a translated label. */
  code: string;
}

export interface CalendarPersonnelStatus {
  id: number;
  state: string;
  status_type: string;
  start_date: string | null;
  end_date: string | null;
  comment?: string;
  location?: string;
  duty_assignment?: DutyPlacement | null;
}

/** Fields this form can replace; labels and unrelated response metadata do not count. */
export function calendarStatusFingerprint(row: CalendarPersonnelStatus | undefined | null): string {
  if (!row) return "missing";
  const place = row.duty_assignment;
  return JSON.stringify([row.id, row.state, row.status_type, row.start_date, row.end_date, row.comment ?? "", row.location ?? "",
    place ? [place.kind, place.object_id, place.post_id, place.group_id, place.time_zone ?? null,
      place.intervals?.map(interval => [interval.start_at, interval.end_at]) ?? null] : null]);
}

/** Select a real future record, or prepare a new one-day assignment.
 * A cell cannot silently edit a different type or choose between duplicates.
 */
export function calendarStatusDraft(context: CalendarStatusContext,
  catalog: readonly { code: string; legacy_code: string | null }[],
  planned: readonly CalendarPersonnelStatus[]) {
  const type = catalog.find(row => row.code === context.code || row.legacy_code === context.code);
  if (!type) throw new Error("Тип статуса недоступен. Обновите календарь и справочник.");
  const code = type.legacy_code || type.code;
  const matches = planned.filter(row => row.state === "planned" && row.start_date && row.start_date <= context.date &&
    (!row.end_date || row.end_date >= context.date) &&
    (row.status_type === code || row.status_type === type.code));
  if (matches.length > 1) throw new Error("На этот день найдено несколько запланированных статусов. Уточните периоды в истории сотрудника.");
  const target = matches[0] ?? null;
  return { code, target, start: target?.start_date ?? context.date, end: target ? target.end_date : context.date,
    comment: target?.comment ?? "", location: target?.location ?? "", placement: target?.duty_assignment ?? null };
}
