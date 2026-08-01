// MSW handler для существующего (`existing`) donor-эндпоинта `/api/audit/logs/`
// — не замочен ни в одной существующей фиче для dev:mock (см. personnel A25).
import { http, HttpResponse } from 'msw'
import { AUDIT_LOGS } from './fixtures'

export const auditHandlers = [
  http.get('*/api/audit/logs/', () =>
    HttpResponse.json({ count: AUDIT_LOGS.length, next: null, previous: null, results: AUDIT_LOGS }),
  ),
]
