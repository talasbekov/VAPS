// Story 14.11k / review (Blind Hunter, Edge Case Hunter — independently
// confirmed empirically): `new Date(localDateTimeString).toISOString()`
// interprets a `datetime-local` value (no offset) as the BROWSER's ambient
// timezone, not the project's canonical business timezone
// (`VAPS_LOCAL_TIMEZONE = "Asia/Qyzylorda"`, Backend/VAPS/config/settings.py)
// — the same wall-clock input produces a different absolute UTC instant
// depending on where the operator's machine is set, up to a 21h spread
// across sampled zones. No timezone library is in the deps allowlist
// (deps-gate), so this uses the documented `Intl.DateTimeFormat` offset
// trick instead of adding one.
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
