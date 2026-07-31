// Review (Blind Hunter/Edge Case Hunter, 14.11k): pins the exact bug both
// agents demonstrated empirically — the SAME wall-clock input must produce
// the SAME UTC instant, deterministically, regardless of the test runner's
// own local timezone (unlike the old `new Date(value).toISOString()`).
import { describe, expect, it } from 'vitest'
import { zonedDateTimeToIso } from './localDateTime'

describe('zonedDateTimeToIso', () => {
  it('interprets input as Asia/Qyzylorda (+05:00) wall-clock, not the runner TZ', () => {
    expect(zonedDateTimeToIso('2026-09-05T08:00')).toBe('2026-09-05T03:00:00.000Z')
  })

  it('is stable across explicit timeZone overrides (sanity on the helper itself)', () => {
    expect(zonedDateTimeToIso('2026-09-05T08:00', 'UTC')).toBe('2026-09-05T08:00:00.000Z')
    expect(zonedDateTimeToIso('2026-09-05T08:00', 'Pacific/Kiritimati')).toBe(
      '2026-09-04T18:00:00.000Z',
    )
  })

  it('handles a date crossing midnight when converted to UTC', () => {
    expect(zonedDateTimeToIso('2026-09-05T02:00')).toBe('2026-09-04T21:00:00.000Z')
  })
})
