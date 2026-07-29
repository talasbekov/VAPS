// Story 13.1b — «последние request_id» для BugReportButton (shared/ui).
//
// Backend deliberately does NOT keep a rolling per-user history
// (RequestContextMiddleware only tracks the CURRENT request — 13.1a's own
// Dev Notes) — the frontend accumulates the last few from response
// X-Request-Id headers itself.
//
// A small module-level ring buffer, NOT inside createApiClient's closure:
// that factory is explicitly documented as stateless (ARCH-FE-010, "чистый
// транспорт, никаких кэшей") — this is a separate, clearly-labeled piece of
// state for a diagnostic purpose, not a cache of API data.

const MAX_TRACKED = 5
let recentRequestIds: string[] = []

/** Called by shared/api/client.ts's request() after every response. */
export function trackRequestId(id: string | null): void {
  if (id === null || id === '') return
  recentRequestIds = [id, ...recentRequestIds].slice(0, MAX_TRACKED)
}

export function getRecentRequestIds(): string[] {
  return recentRequestIds
}

/** Test-only reset — avoids cross-test leakage of module-level state. */
export function resetRecentRequestIds(): void {
  recentRequestIds = []
}
