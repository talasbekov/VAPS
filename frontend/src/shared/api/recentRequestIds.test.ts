// Story 13.1b — ring buffer + real wiring через createApiClient (response
// header capture), не только изолированная логика буфера.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { createApiClient } from './client'
import { server } from './testing/server'
import {
  getRecentRequestIds,
  resetRecentRequestIds,
  trackRequestId,
} from './recentRequestIds'

const client = createApiClient({ baseUrl: 'http://localhost' })

describe('recentRequestIds', () => {
  beforeEach(resetRecentRequestIds)
  afterEach(resetRecentRequestIds)

  it('tracks ids, most-recent-first, capped at 5', () => {
    for (let i = 1; i <= 7; i += 1) {
      trackRequestId(`req-${i}`)
    }
    expect(getRecentRequestIds()).toEqual([
      'req-7',
      'req-6',
      'req-5',
      'req-4',
      'req-3',
    ])
  })

  it('ignores null/empty ids', () => {
    trackRequestId('req-1')
    trackRequestId(null)
    trackRequestId('')
    expect(getRecentRequestIds()).toEqual(['req-1'])
  })

  it('client.get() on a successful response captures X-Request-Id', async () => {
    server.use(
      http.get('*/api/core/employees/', () =>
        HttpResponse.json(
          { count: 0, next: null, previous: null, results: [] },
          { headers: { 'X-Request-Id': 'success-req-id' } },
        ),
      ),
    )
    await client.get('/api/core/employees/')
    expect(getRecentRequestIds()).toContain('success-req-id')
  })

  it('an error response still captures X-Request-Id before throwing', async () => {
    server.use(
      http.get('*/api/core/employees/', () =>
        HttpResponse.json(
          {
            error_code: 'SERVER_ERROR',
            message: 'x',
            details: {},
            request_id: 'error-req-id',
            timestamp: '2026-07-29T09:00:00+05:00',
          },
          { status: 500, headers: { 'X-Request-Id': 'error-req-id' } },
        ),
      ),
    )
    await expect(client.get('/api/core/employees/')).rejects.toThrow()
    expect(getRecentRequestIds()).toContain('error-req-id')
  })

  it('client.getBlob() also captures X-Request-Id (review: Edge Case Hunter — previously untested)', async () => {
    server.use(
      http.get(
        '*/api/documents/attachments/abc/download/',
        () =>
          new HttpResponse(new Blob(['x']), {
            status: 200,
            headers: { 'X-Request-Id': 'blob-req-id' },
          }),
      ),
    )
    await client.getBlob('/api/documents/attachments/abc/download/')
    expect(getRecentRequestIds()).toContain('blob-req-id')
  })
})
