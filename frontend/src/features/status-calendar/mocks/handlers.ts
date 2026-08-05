// Story 19.4d: MSW dev:mock handler for GET /statuses/calendar/ — synthetic
// dense month (mostly IN_SERVICE, one VACATION week), independent of
// employee_id/division_id (demo-scale, no real backend in dev:mock).
import { http, HttpResponse } from 'msw'

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function parseYearOrDefault(raw: string | null): number {
  const parsed = Number(raw)
  return raw !== null && Number.isInteger(parsed) ? parsed : new Date().getFullYear()
}

function parseMonthOrDefault(raw: string | null): number {
  const parsed = Number(raw)
  return raw !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
    ? parsed
    : new Date().getMonth() + 1
}

export const statusCalendarHandlers = [
  http.get('*/api/operations/statuses/calendar/', ({ request }) => {
    const url = new URL(request.url)
    // review (Blind Hunter + Edge Case Hunter): Number(null) === 0 and
    // Number('abc') === NaN both used to silently produce invalid ISO
    // keys (e.g. "2026-00-15") instead of a usable demo month — missing
    // or malformed params now fall back to the real current month
    // instead of propagating garbage into daysInMonth().
    const year = parseYearOrDefault(url.searchParams.get('year'))
    const month = parseMonthOrDefault(url.searchParams.get('month'))
    const total = daysInMonth(year, month)
    const calendar: Record<string, string> = {}
    for (let day = 1; day <= total; day += 1) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      calendar[iso] = day >= 10 && day <= 14 ? 'VACATION' : 'IN_SERVICE'
    }
    return HttpResponse.json(calendar)
  }),
]
