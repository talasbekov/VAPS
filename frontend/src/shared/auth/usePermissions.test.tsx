// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import {
  adminPermissionsFixture,
  myPermissionsFixture,
} from '../api/testing/handlers'
import { server } from '../api/testing/server'
import { clearCredential, setCredential } from './credential'
import { usePermissions } from './usePermissions'

// vitest globals выключены → авто-cleanup RTL не регистрируется сам (урок 8.5)
afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

// капчер — массив, не let (урок 8.4)
function captureRequests(fixture = myPermissionsFixture) {
  const captured: Array<{ 'x-user-id': string | null }> = []
  server.use(
    http.get('*/api/operations/my-permissions/', ({ request }) => {
      captured.push({ 'x-user-id': request.headers.get('x-user-id') })
      return HttpResponse.json(fixture)
    }),
  )
  return captured
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

describe('usePermissions: права ТОЛЬКО из useQuery([me]) (AC 3)', () => {
  it('без credential запрос НЕ уходит вовсе (enabled-гейт, Ловушка 1)', async () => {
    const captured = captureRequests()
    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    // даём микрозадачам шанс отправить то, чего быть не должно
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    expect(captured).toHaveLength(0)
    expect(result.current.permissions).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.hasPermission('status.view')).toBe(false)
  })

  it('с credential: типизированный ответ → ReadonlySet, точное совпадение кода', async () => {
    const captured = captureRequests()
    setCredential({ kind: 'dev', userId: 'operator-1' })
    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.permissions).toBeDefined())

    expect(captured).toHaveLength(1)
    expect(captured[0]['x-user-id']).toBe('operator-1')
    expect([...result.current.permissions!].sort()).toEqual(
      [...myPermissionsFixture.permissions].sort(),
    )
    expect(result.current.hasPermission('status.view')).toBe(true)
    expect(result.current.hasPermission('audit.view')).toBe(false)
  })

  it('wildcard `*` (ADMIN) даёт ЛЮБОЕ право', async () => {
    captureRequests(adminPermissionsFixture)
    setCredential({ kind: 'dev', userId: 'admin-1' })
    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.permissions).toBeDefined())

    expect(result.current.hasPermission('audit.view')).toBe(true)
    expect(result.current.hasPermission('какое-угодно.право')).toBe(true)
  })

  it('enabled-гейт РЕАКТИВЕН: после login() запрос стартует сам', async () => {
    const captured = captureRequests()
    const { result } = renderHook(() => usePermissions(), {
      wrapper: createWrapper(),
    })

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(captured).toHaveLength(0)

    act(() => {
      setCredential({ kind: 'dev', userId: 'operator-1' })
    })

    await waitFor(() => expect(result.current.permissions).toBeDefined())
    expect(captured).toHaveLength(1)
  })
})
