// Story 20.1e: dev:mock handler for the REAL backend readiness endpoint
// (`/api/operations/security-events/:id/readiness/`, 20.1b) — distinct from
// `handlers.ts`'s mock-first `/api/ops/security-events/...` (20.1c/20.1d
// separation carried into mocks). `browser.ts`'s `onUnhandledRequest: 'error'`
// means this endpoint MUST be registered or the panel crashes with an
// internal MSW exception instead of its own honest error UI (19.4d
// precedent). Always 404 — no mock-created ОМ has a real backend row, so a
// success response here would be a fabricated result (§35).
import { http, HttpResponse } from 'msw'

export const readinessMockHandlers = [
  http.get('*/api/operations/security-events/:id/readiness/', () =>
    HttpResponse.json(
      {
        error_code: 'NOT_FOUND',
        message: 'ОМ не найден.',
        details: {},
        request_id: null,
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    ),
  ),
]
