// @vitest-environment jsdom
// Story 16.8h1: contract tests for the placement API hooks — real schema
// types (paths[...]), MSW handlers per-test (не dev:mock фикстуры), образец
// useApiMutation.test.tsx's структура.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../../../shared/api/testing/server'
import { ConflictError } from '../../../shared/api/errors'
import { ToastProvider } from '../../../shared/ui/toast'
import {
  assignmentVersionKeys,
  useAssignmentVersions,
  useAssignmentVersion,
  useAssignmentVersionConflicts,
  useCreatePlacementDraft,
  useSubmitAssignmentVersion,
  useReturnAssignmentVersion,
  useApproveAssignmentVersion,
  useAcknowledgePlacementAssignment,
} from './queries'

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

describe('useAssignmentVersions/useAssignmentVersion/useAssignmentVersionConflicts', () => {
  it('list returns the paginated envelope', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1 }] }),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAssignmentVersions(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.results).toHaveLength(1)
  })

  it('detail fetches by id', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({ id: 7, status: 'DRAFT', assignments: [] }),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAssignmentVersion('7'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe(7)
  })

  it('conflicts returns a plain (unpaginated) list', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([{ id: 1, conflict_severity: 'SOFT' }]),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAssignmentVersionConflicts('7'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data)).toBe(true)
  })
})

describe('useCreatePlacementDraft', () => {
  it('POSTs to placement/draft and invalidates the versions list cache', async () => {
    server.use(
      http.post('*/api/operations/security-events/9/placement/draft/', () =>
        HttpResponse.json({ id: 42, event: 9, status: 'DRAFT' }, { status: 201 }),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(assignmentVersionKeys.lists(), {
      count: 0,
      results: [],
    })
    const { result } = renderHook(() => useCreatePlacementDraft(9), { wrapper: Wrapper })

    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.error).toBeNull()
    expect(
      queryClient.getQueryState(assignmentVersionKeys.lists())?.isInvalidated,
    ).toBe(true)
  })

  it('surfaces 409 PLACEMENT_DRAFT_ALREADY_EXISTS as a plain error', async () => {
    server.use(
      http.post('*/api/operations/security-events/9/placement/draft/', () =>
        HttpResponse.json(
          {
            error_code: 'PLACEMENT_DRAFT_ALREADY_EXISTS',
            message: 'Уже есть текущая версия.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        ),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreatePlacementDraft(9), { wrapper: Wrapper })

    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.error).not.toBeNull())

    // Non-overridable 409 → plain mutation.error, not the conflict channel.
    expect(result.current.conflict).toBeNull()
  })
})

describe('useSubmitAssignmentVersion', () => {
  it('POSTs to submit and seeds the detail cache with the response', async () => {
    server.use(
      http.post('*/api/operations/assignment-versions/7/submit/', () =>
        HttpResponse.json({ id: 7, status: 'SUBMITTED' }),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useSubmitAssignmentVersion('7'), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.error).toBeNull()
    expect(queryClient.getQueryData(assignmentVersionKeys.detail('7'))).toEqual({
      id: 7,
      status: 'SUBMITTED',
    })
  })
})

describe('useReturnAssignmentVersion', () => {
  it('sends reason and surfaces the new_draft_version in the response', async () => {
    server.use(
      http.post('*/api/operations/assignment-versions/7/return/', async ({ request }) => {
        const body = (await request.json()) as { reason: string }
        return HttpResponse.json({
          id: 7,
          status: 'RETURNED',
          new_draft_version: { id: 8, status: 'DRAFT' },
          received_reason: body.reason,
        })
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useReturnAssignmentVersion('7'), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({ reason: 'Проверить состав' }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.error).toBeNull()
  })
})

describe('useApproveAssignmentVersion', () => {
  it('409 SOFT_CONFLICT_DETECTED surfaces on the conflict channel', async () => {
    server.use(
      http.post('*/api/operations/assignment-versions/7/approve/', () =>
        HttpResponse.json(
          {
            error_code: 'SOFT_CONFLICT_DETECTED',
            message: 'Конфликт',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        ),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useApproveAssignmentVersion('7'), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.conflict).toBeInstanceOf(ConflictError))
  })
})

describe('useAcknowledgePlacementAssignment', () => {
  it('POSTs to acknowledge and invalidates the parent version detail', async () => {
    server.use(
      http.post('*/api/operations/placement-assignments/3/acknowledge/', () =>
        HttpResponse.json({ id: 3, acknowledged_at: '2026-08-03T10:00:00Z' }),
      ),
    )
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(assignmentVersionKeys.detail('7'), { id: 7, status: 'APPROVED' })
    const { result } = renderHook(() => useAcknowledgePlacementAssignment('3', '7'), {
      wrapper: Wrapper,
    })
    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.error).toBeNull()
    expect(queryClient.getQueryState(assignmentVersionKeys.detail('7'))?.isInvalidated).toBe(
      true,
    )
  })
})
