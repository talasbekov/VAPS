export interface WorkloadCoveragePeriod { from: string; to: string }

export function paginateCoverage<T>(rows: readonly T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return { page, pages, rows: rows.slice((page - 1) * 20, page * 20) };
}

function calendarDay(value: string): number | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000-") || value === "0001-01-01" || value === "9999-12-31") return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value ? instant : null;
}

export function validateCoveragePeriod(from: string, to: string): string | null {
  const start = calendarDay(from), end = calendarDay(to);
  if (start === null || end === null || start > end || end - start >= 31 * 86400000) {
    return "Укажите корректные даты сводки: от 1 до 31 дня.";
  }
  return null;
}

export function coverageMinutes(value: number | null): string {
  if (value === null) return "Неизвестно";
  const hours = Math.floor(value / 60);
  const minutes = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value - hours * 60);
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

export function coverageTimestamp(value: string | null, timeZone: string): string {
  if (value === null) return "Не задано";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "Не задано" : new Intl.DateTimeFormat("ru-RU", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(instant);
}
