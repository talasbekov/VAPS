/** A status-editing day is independent of the expense submission businessDate. */
export function validStatusCalendarDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function statusCalendarHref(day: string, currentQuery = new URLSearchParams()): string {
  const next = new URLSearchParams(currentQuery);
  next.set("view", "calendar");
  next.set("statusDate", day);
  return `/statuses/?${next.toString()}`;
}
