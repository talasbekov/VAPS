// @vitest-environment jsdom
// Story 20.1c: contract tests for useSecurityEventReadiness — real schema
// types (paths[...]), MSW handlers per-test (не dev:mock фикстуры), образец
// status-calendar/api/queries.test.tsx's структура.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../../../shared/api/testing/server'
import { ApiError } from '../../../shared/api/errors'
import { ToastProvider } from '../../../shared/ui/toast'
import { useSecurityEventReadiness } from './readiness'

afterEach(cleanup)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  return { Wrapper, queryClient }
}

describe('useSecurityEventReadiness', () => {
  it('returns the readiness snapshot from the real backend endpoint', async () => {
    server.use(
      http.get('*/api/operations/security-events/42/readiness/', () =>
        HttpResponse.json({
          checklist_ready: true,
          demand_ready: false,
          placement_ready: false,
          acknowledgement_ready: true,
          conflicts_ready: true,
          readiness_pct: 60,
        }),
      ),
    )
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSecurityEventReadiness('42'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      checklist_ready: true,
      demand_ready: false,
      placement_ready: false,
      acknowledgement_ready: true,
      conflicts_ready: true,
      readiness_pct: 60,
    })
  })

  it('surfaces a 403 as ApiFailure error', async () => {
    server.use(
      http.get('*/api/operations/security-events/42/readiness/', () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Нет права на это событие.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 403 },
        ),
      ),
    )
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSecurityEventReadiness('42'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).errorCode).toBe('PERMISSION_DENIED')
  })

  it('surfaces a 404 as ApiFailure error', async () => {
    server.use(
      http.get('*/api/operations/security-events/999999/readiness/', () =>
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
    )
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSecurityEventReadiness('999999'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
  })

  it('interpolates the eventId into the URL', async () => {
    // Review (Blind Hunter): изначально проверялось только
    // toHaveBeenCalledTimes(1) — тест назывался «interpolates the
    // eventId», но не проверял, что 777 реально попал в URL (прошёл бы
    // даже при поломанной интерполяции, случайно совпавшей с паттерном
    // MSW). Ловим реальный URL через wildcard-паттерн + ассерт на путь.
    const seenUrls: string[] = []
    server.use(
      http.get('*/api/operations/security-events/:id/readiness/', ({ request }) => {
        seenUrls.push(new URL(request.url).pathname)
        return HttpResponse.json({
          checklist_ready: true,
          demand_ready: true,
          placement_ready: true,
          acknowledgement_ready: true,
          conflicts_ready: true,
          readiness_pct: 100,
        })
      }),
    )
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSecurityEventReadiness('777'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seenUrls).toEqual(['/api/operations/security-events/777/readiness/'])
  })
})
