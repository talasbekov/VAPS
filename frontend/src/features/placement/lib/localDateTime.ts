// Story 18.6c: copied from features/duty-plans/lib/localDateTime.ts
// (14.11k) — ARCH-FE-013 boundaries forbids features/*→features/* imports,
// so small cross-feature utilities are duplicated per-feature in this
// codebase rather than cross-imported. See that file for the original
// tz-math rationale (empirically confirmed by review: naive
// `new Date(localDateTime).toISOString()` uses the BROWSER's ambient
// timezone, not VAPS_LOCAL_TIMEZONE — up to a 21h spread across zones).
export const VAPS_LOCAL_TIMEZONE = 'Asia/Qyzylorda'

/**
 * Interpret `localDateTime` (a `datetime-local` input value, e.g.
 * "2026-09-05T08:00") as wall-clock time in `timeZone`, and return the
 * corresponding absolute instant as an ISO 8601 UTC string.
 */
export function zonedDateTimeToIso(
  localDateTime: string,
  timeZone: string = VAPS_LOCAL_TIMEZONE,
): string {
  // Reference instant: treat the input as if it were literal UTC.
  const asIfUtc = new Date(`${localDateTime}:00Z`)
  // Render that reference instant AS SEEN in `timeZone`, then reinterpret
  // those displayed wall-clock digits as UTC — the difference from the
  // reference instant is exactly `timeZone`'s UTC offset at that moment.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(asIfUtc)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const asIfUtcInZone = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  const offsetMs = asIfUtcInZone - asIfUtc.getTime()
  return new Date(asIfUtc.getTime() - offsetMs).toISOString()
}

/**
 * Inverse of `zonedDateTimeToIso`: render an ISO 8601 UTC instant as a
 * `datetime-local` input value (`"YYYY-MM-DDTHH:mm"`) showing wall-clock
 * time in `timeZone`.
 */
export function isoToZonedDateTimeLocal(
  iso: string,
  timeZone: string = VAPS_LOCAL_TIMEZONE,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
