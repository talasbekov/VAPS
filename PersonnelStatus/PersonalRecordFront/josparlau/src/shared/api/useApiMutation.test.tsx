// @vitest-environment jsdom
// Контрактный тест маппинга ARCH-FE-015 (AC 1–5, 7): КАЖДЫЙ класс ApiError-union
// доведён до своего канала (форма/диалог/state/тост) через renderHook + MSW.
// jest-dom — per-file (общий vitest.setup.ts гоняется и в node-тестах 8.4).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createApiClient } from './client'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from './errors'
import {
  GENERIC_FAILURE_MESSAGE,
  useApiMutation,
} from './useApiMutation'
import {
  conflictOverridableEnvelope,
  serverEnvelope,
  validationEnvelope,
} from './testing/handlers'
import { server } from './testing/server'
import { ToastProvider } from '../ui/toast'

// vitest globals выключены → авто-cleanup RTL не регистрируется сам
afterEach(cleanup)

// Ловушка 1: относительный URL в node-fetch не парсится — абсолютный origin
const client = createApiClient({ baseUrl: 'http://localhost' })

// Ловушка 6: свежий QueryClient на каждый тест (кэш мутаций не протекает);
// локальная обёртка вместо app/providers — shared-тесту импорт из app запрещён
// (ARCH-FE-013), retry: false зеркалит дефолт createQueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
}

type Body = Record<string, unknown>

function renderApiMutation(options: {
  mutationFn: (vars: Body) => Promise<Body>
  onSuccess?: (data: Body, vars: Body) => void
  onFormError?: (details: Record<string, unknown>) => void
}) {
  return renderHook(() => useApiMutation<Body, Body>(options), {
    wrapper: createWrapper(),
  })
}

const ORIGINAL_BODY: Body = {
  employee_id: '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f',
  status_type: 'TEMPORARY_DUTY',
}

const REASON = 'Замена по приказу — наряд снят, отдых подтверждён'

// капчер — массив, не let (tsc сужает let к initializer в замыкании хендлера)
function captureTemporaryDuty() {
  const captured: Body[] = []
  server.use(
    http.post('*/api/operations/temporary-duty/', async ({ request }) => {
      const body = (await request.json()) as Body
      captured.push(body)
      if (body.override === true && typeof body.override_reason === 'string') {
        return HttpResponse.json(body, { status: 201 })
      }
      return HttpResponse.json(conflictOverridableEnvelope, { status: 409 })
    }),
  )
  return captured
}

describe('канал ConflictDialog: 409 overridable (AC 1, 2)', () => {
  it('409 overridable → conflict-state; ни тоста, ни onFormError', async () => {
    const onFormError = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
      onFormError,
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() =>
      expect(result.current.conflict).toBeInstanceOf(ConflictError),
    )
    expect(result.current.conflict?.overridable).toBe(true)
    expect(result.current.conflict?.errorCode).toBe('STATUS_OVERLAP_WARNING')
    expect(onFormError).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('confirmOverride: повтор РОВНО один раз с {...тело, override: true, override_reason} → onSuccess, conflict сброшен (AC 1)', async () => {
    const captured = captureTemporaryDuty()
    const onSuccess = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
      onSuccess,
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())

    act(() => result.current.confirmOverride(REASON))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))

    // тело второго запроса: исходное + ДВА snake_case поля протокола (Д1)
    expect(captured).toEqual([
      ORIGINAL_BODY,
      { ...ORIGINAL_BODY, override: true, override_reason: REASON },
    ])
    expect(result.current.conflict).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('dismissConflict: повтора НЕТ, conflict сброшен, ошибка доступна фиче (AC 2)', async () => {
    const captured = captureTemporaryDuty()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())

    act(() => result.current.dismissConflict())
    expect(result.current.conflict).toBeNull()
    // ошибка мутации остаётся фиче (рендер — E9)
    expect(result.current.error).toBeInstanceOf(ConflictError)
    expect(captured).toHaveLength(1)
  })

  it('MSW-фикстура override-флоу из handlers.ts (Task 7): дефолтный хендлер сам ведёт 409 → 201', async () => {
    const onSuccess = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
      onSuccess,
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())

    act(() => result.current.confirmOverride(REASON))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    // echo-тело фикстуры подтверждает, что до сервера дошли оба поля
    expect(onSuccess.mock.calls[0][0]).toEqual({
      ...ORIGINAL_BODY,
      override: true,
      override_reason: REASON,
    })
  })
})

describe('канал формы: 400 VALIDATION_ERROR (AC 3)', () => {
  it('400 → onFormError(details по полям); ни тоста, ни диалога', async () => {
    const onFormError = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/core/employees/', vars),
      onFormError,
    })

    act(() => result.current.mutate({ iin: '' }))
    await waitFor(() => expect(onFormError).toHaveBeenCalledTimes(1))

    // сырьё, совместимое с RHF setError (Д3): DRF-details по полям
    expect(onFormError).toHaveBeenCalledWith(validationEnvelope.details)
    expect(result.current.error).toBeInstanceOf(ValidationError)
    expect(result.current.conflict).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('канал error-state фичи: 422 и non-overridable 409 (AC 4)', () => {
  it('422 BUSINESS_DATE_OUT_OF_WINDOW → только mutation.error; ни диалога, ни тоста', async () => {
    const onFormError = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) =>
        client.post('/api/operations/daily-submissions/', vars),
      onFormError,
    })

    act(() => result.current.mutate({ business_date: '2026-07-01' }))
    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(BusinessRuleError),
    )
    expect(result.current.error?.kind).toBe('business_rule')
    expect(result.current.conflict).toBeNull()
    expect(onFormError).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('409 non-overridable DAY_ALREADY_SUBMITTED → только mutation.error, диалог НЕ открыт', async () => {
    const { result } = renderApiMutation({
      mutationFn: (vars) =>
        client.post('/api/operations/daily-submissions/42/amend/', vars),
    })

    act(() => result.current.mutate({ reason: 'поздняя правка' }))
    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(ConflictError),
    )
    const err = result.current.error as ConflictError
    expect(err.overridable).toBe(false)
    expect(err.errorCode).toBe('DAY_ALREADY_SUBMITTED')
    expect(result.current.conflict).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('401 с конвертом (базовый ApiError) → только mutation.error (редирект — 8.6)', async () => {
    server.use(
      http.post('*/api/operations/my-permissions/', () =>
        HttpResponse.json(
          {
            error_code: 'AUTH_REQUIRED',
            message: 'Отсутствуют учётные данные.',
            details: {},
            request_id: null,
            timestamp: '2026-07-07T12:00:00+05:00',
          },
          { status: 401 },
        ),
      ),
    )
    const onFormError = vi.fn()
    const { result } = renderApiMutation({
      mutationFn: (vars) =>
        client.post('/api/operations/my-permissions/', vars),
      onFormError,
    })

    act(() => result.current.mutate({}))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current.error?.kind).toBe('api')
    expect(result.current.conflict).toBeNull()
    expect(onFormError).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('канал тоста: 5xx и сетевой обрыв (AC 5)', () => {
  it.each([
    ['500 с конвертом', '/api/audit/logs/', ServerError],
    ['502 text/html', '/api/notifications/', ServerError],
    ['сетевой обрыв', '/api/core/divisions/', NetworkError],
  ])(
    '%s → глобальный тост (aria-live) с generic-текстом БЕЗ деталей',
    async (_label, path, errorClass) => {
      const onFormError = vi.fn()
      const { result } = renderApiMutation({
        mutationFn: () => client.get(path),
        onFormError,
      })

      act(() => result.current.mutate({}))
      await waitFor(() =>
        expect(result.current.error).toBeInstanceOf(errorClass),
      )
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent(GENERIC_FAILURE_MESSAGE)
      // БЕЗ деталей наружу (UX L208): текст конверта не протекает в тост
      expect(status).not.toHaveTextContent(serverEnvelope.message)
      expect(onFormError).not.toHaveBeenCalled()
      expect(result.current.conflict).toBeNull()
    },
  )

  it('5xx НЕ ретраится автоматически (канон L472: retry: false)', async () => {
    const captured: Body[] = []
    server.use(
      http.post('*/api/operations/daily-submissions/', async ({ request }) => {
        captured.push((await request.json()) as Body)
        return HttpResponse.json(serverEnvelope, { status: 500 })
      }),
    )
    const { result } = renderApiMutation({
      mutationFn: (vars) =>
        client.post('/api/operations/daily-submissions/', vars),
    })

    act(() => result.current.mutate({ business_date: '2026-07-06' }))
    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(ServerError),
    )
    expect(result.current.isPending).toBe(false)
    expect(captured).toHaveLength(1)
  })
})

describe('conflict-state: граничные переходы (AC 1, 2)', () => {
  it('новый mutate при открытом конфликте сбрасывает conflict-state сразу (прежний конфликт неактуален)', async () => {
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())

    act(() => result.current.mutate(ORIGINAL_BODY))
    // сброс синхронный: диалог закрывается, не дожидаясь ответа сервера
    expect(result.current.conflict).toBeNull()
    // дефолтная фикстура снова 409 → конфликт взводится заново
    await waitFor(() =>
      expect(result.current.conflict).toBeInstanceOf(ConflictError),
    )
  })

  it('override-повтор, встретивший НОВЫЙ 409 overridable → диалог взводится заново (сервер авторитетен)', async () => {
    const onSuccess = vi.fn()
    // сервер конфликтует и на повтор с override: hard/soft деление — на бэке (UX L177)
    server.use(
      http.post('*/api/operations/temporary-duty/', () =>
        HttpResponse.json(conflictOverridableEnvelope, { status: 409 }),
      ),
    )
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
      onSuccess,
    })

    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())

    act(() => result.current.confirmOverride(REASON))
    expect(result.current.conflict).toBeNull() // сброшен на время повтора
    await waitFor(() =>
      expect(result.current.conflict).toBeInstanceOf(ConflictError),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('confirmOverride без предшествующего mutate — no-op: запрос не уходит', () => {
    const captured = captureTemporaryDuty()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
    })

    act(() => result.current.confirmOverride(REASON))
    expect(result.current.isPending).toBe(false)
    expect(captured).toHaveLength(0)
  })

  it('reset: error и conflict сброшены к idle БЕЗ нового запроса (10.6: повторный вход в путь, гардящийся производной от error)', async () => {
    // Без reset ошибка отказа живёт до следующего mutate — а фиче, которая
    // ДЕРЖИТ путь закрытым по error (10.6: форма исправления после 409/404),
    // новый mutate взять неоткуда. Ровно этот замкнутый круг reset размыкает.
    const captured = captureTemporaryDuty()
    const { result } = renderApiMutation({
      mutationFn: (vars) => client.post('/api/operations/temporary-duty/', vars),
    })

    // дефолт captureTemporaryDuty: без override-полей приходит 409 overridable
    act(() => result.current.mutate(ORIGINAL_BODY))
    await waitFor(() => expect(result.current.conflict).not.toBeNull())
    expect(result.current.error).not.toBeNull()
    expect(captured).toHaveLength(1)

    act(() => result.current.reset())
    expect(result.current.conflict).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.isPending).toBe(false)
    // сброс — локальный: повторного запроса reset не порождает
    expect(captured).toHaveLength(1)
  })
})
