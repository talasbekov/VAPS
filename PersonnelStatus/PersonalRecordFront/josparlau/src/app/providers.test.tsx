// @vitest-environment jsdom
// E2E-уровень стека (vitest+RTL+MSW; браузерного раннера в проекте нет):
// полный пользовательский флоу протокола ошибок ARCH-FE-015 через РЕАЛЬНУЮ
// app-композицию Providers (createQueryClient c retry: false + ToastProvider),
// а не локальную тест-обёртку — хук + общий ConflictDialog + тост, управляемые
// user-event. app → shared легален (ARCH-FE-013), обратное — нет: поэтому
// интеграция живёт здесь, рядом с providers.tsx (L440).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { createApiClient } from '../shared/api/client'
import {
  GENERIC_FAILURE_MESSAGE,
  useApiMutation,
} from '../shared/api/useApiMutation'
import {
  conflictOverridableEnvelope,
  serverEnvelope,
} from '../shared/api/testing/handlers'
import { server } from '../shared/api/testing/server'
import { ConflictDialog } from '../shared/ui/ConflictDialog'
import { Providers } from './providers'

// vitest globals выключены → авто-cleanup RTL не регистрируется сам
afterEach(cleanup)

// jsdom 29 НЕ реализует методы <dialog> (уточнение Ловушки 3 стори 8.5):
// минимальный полифилл open-семантики, ассерты — по dialog.open/контенту
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

type Body = Record<string, unknown>

// Ловушка 1: относительный URL в node-fetch не парсится — абсолютный origin
const client = createApiClient({ baseUrl: 'http://localhost' })

const ORIGINAL_BODY: Body = {
  employee_id: '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f',
  status_type: 'TEMPORARY_DUTY',
}

const REASON = 'Замена по приказу — наряд снят, отдых подтверждён'
const LABEL = 'Причина (10–500 символов)'
const SUBMIT = 'Сохранить статус'

// Мини-фича «как в E9»: сабмит статуса + общий ConflictDialog + error-state.
// Ровно та связка, которую features обязаны собирать из shared (ARCH-FE-015).
function TemporaryDutyProbe() {
  const [created, setCreated] = useState(false)
  const mutation = useApiMutation<Body, Body>({
    mutationFn: (vars) =>
      client.post<Body>('/api/operations/temporary-duty/', vars),
    onSuccess: () => setCreated(true),
  })
  return (
    <div>
      <button type="button" onClick={() => mutation.mutate(ORIGINAL_BODY)}>
        {SUBMIT}
      </button>
      {created && <p>Статус создан</p>}
      {mutation.error !== null && <p>Ошибка операции</p>}
      <ConflictDialog
        conflict={mutation.conflict}
        onOverride={mutation.confirmOverride}
        onCancel={mutation.dismissConflict}
      />
    </div>
  )
}

function renderProbe() {
  return render(
    <Providers>
      <TemporaryDutyProbe />
    </Providers>,
  )
}

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

describe('E2E: override-флоу глазами пользователя через Providers (AC 1, 2)', () => {
  it('сабмит → 409 → диалог → причина → «Подтвердить оверрайд» → повтор с override-полями → успех, диалог закрыт', async () => {
    const captured = captureTemporaryDuty()
    const user = userEvent.setup()
    renderProbe()

    await user.click(screen.getByRole('button', { name: SUBMIT }))
    const dialog = await screen.findByRole('dialog')
    expect((dialog as HTMLDialogElement).open).toBe(true)

    await user.click(screen.getByLabelText(LABEL))
    await user.paste(REASON)
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оверрайд' }),
    )

    expect(await screen.findByText('Статус создан')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // тело второго запроса: исходное + ДВА snake_case поля протокола (Д1)
    expect(captured).toEqual([
      ORIGINAL_BODY,
      { ...ORIGINAL_BODY, override: true, override_reason: REASON },
    ])
  })

  it('«Отмена» → повтора нет, ошибка у фичи; новый сабмит открывает диалог с ЧИСТОЙ причиной', async () => {
    const captured = captureTemporaryDuty()
    const user = userEvent.setup()
    renderProbe()

    await user.click(screen.getByRole('button', { name: SUBMIT }))
    await screen.findByRole('dialog')
    await user.click(screen.getByLabelText(LABEL))
    await user.paste(REASON)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // ошибка мутации осталась фиче (рендер error-state — E9)
    expect(screen.getByText('Ошибка операции')).toBeInTheDocument()
    expect(captured).toHaveLength(1)

    // повторный сабмит: state причины НЕ пережил закрытие (размонтирование = закрытие)
    await user.click(screen.getByRole('button', { name: SUBMIT }))
    await screen.findByRole('dialog')
    expect(screen.getByLabelText(LABEL)).toHaveValue('')
    expect(captured).toHaveLength(2)
  })
})

describe('E2E: канал тоста через Providers (AC 5)', () => {
  it('500 → generic-тост из реального ToastProvider; авто-ретрая нет (retry: false из createQueryClient)', async () => {
    const captured: Body[] = []
    server.use(
      http.post('*/api/operations/temporary-duty/', async ({ request }) => {
        captured.push((await request.json()) as Body)
        return HttpResponse.json(serverEnvelope, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderProbe()

    await user.click(screen.getByRole('button', { name: SUBMIT }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        GENERIC_FAILURE_MESSAGE,
      ),
    )
    // БЕЗ деталей наружу (UX L208) и без диалога
    expect(screen.getByRole('status')).not.toHaveTextContent(
      serverEnvelope.message,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(captured).toHaveLength(1)
  })
})
