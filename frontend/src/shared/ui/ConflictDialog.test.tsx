// @vitest-environment jsdom
// Компонентные тесты общего ConflictDialog (AC 1, 2, 7): валидация 10–500 со
// счётчиком, «Отмена»/«Подтвердить оверрайд», Escape (keyboard path — L262).
// Ловушка 3: в jsdom ассертим dialog.open/контент, не ::backdrop/top-layer.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictError } from '../api/errors'
import { conflictOverridableEnvelope } from '../api/testing/handlers'
import { ConflictDialog, REASON_MAX, REASON_MIN } from './ConflictDialog'

// vitest globals выключены → авто-cleanup RTL не регистрируется сам
afterEach(cleanup)

// jsdom 29 НЕ реализует методы <dialog> (show/showModal/close — undefined;
// уточнение Ловушки 3 по факту): минимальный полифилл — только open-семантика,
// без top-layer/фокус-трапа (их и ассертить нельзя — смок по dialog.open)
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

const conflictFixture = new ConflictError({
  status: 409,
  errorCode: conflictOverridableEnvelope.error_code,
  message: conflictOverridableEnvelope.message,
  details: conflictOverridableEnvelope.details,
  requestId: null,
})

const LABEL = 'Причина (10–500 символов)'
const CONFIRM = 'Подтвердить оверрайд'

function renderDialog(conflict: ConflictError | null = conflictFixture) {
  const onOverride = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConflictDialog
      conflict={conflict}
      onOverride={onOverride}
      onCancel={onCancel}
    />,
  )
  return { onOverride, onCancel }
}

describe('ConflictDialog: открытие/закрытие', () => {
  it('conflict=null → диалога нет в DOM', () => {
    renderDialog(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('conflict → модальный диалог открыт: заголовок из message, список конфликтов, аудит-копирайт', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect((dialog as HTMLDialogElement).open).toBe(true)
    expect(
      screen.getByRole('heading', {
        name: `Конфликт: ${conflictOverridableEnvelope.message}`,
      }),
    ).toBeInTheDocument()
    // details.conflicts[] конверта отображён
    expect(
      screen.getByText(/UNAVAILABLE_STATUS_CONFLICT/),
    ).toBeInTheDocument()
    // «…Причина попадёт в аудит.» — копирайт мокапа key-daily-grid.html
    expect(screen.getByText(/Причина попадёт в аудит\./)).toBeInTheDocument()
  })

  it('10.2a: bulk-агрегат (details.rows[], НЕ details.conflicts[]) тоже отображается итемизированно', () => {
    const bulkConflict = new ConflictError({
      status: 409,
      errorCode: 'STATUS_OVERLAP_WARNING',
      message: 'Массовое обновление отклонено: см. detail.rows.',
      details: {
        rows: [
          {
            index: 0,
            employee_id: 'emp-0',
            code: 'STATUS_OVERLAP_WARNING',
            http_status: 409,
            message: 'Статус пересекает soft-статус сотрудника.',
          },
        ],
      },
      requestId: null,
    })
    renderDialog(bulkConflict)
    expect(
      screen.getByText(
        'Строка 1 · emp-0 · Статус пересекает soft-статус сотрудника.',
      ),
    ).toBeInTheDocument()
  })
})

describe('ConflictDialog: валидация причины 10–500 (AC 2)', () => {
  it('пустая причина: счётчик 0 / 500, «Подтвердить оверрайд» заблокирована', () => {
    renderDialog()
    expect(screen.getByText(`0 / ${REASON_MAX}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CONFIRM })).toBeDisabled()
  })

  it('9 символов — заблокирована; 10 — разблокирована (нижняя граница)', async () => {
    const user = userEvent.setup()
    renderDialog()
    const textarea = screen.getByLabelText(LABEL)
    const confirm = screen.getByRole('button', { name: CONFIRM })

    await user.type(textarea, 'а'.repeat(REASON_MIN - 1))
    expect(screen.getByText(`9 / ${REASON_MAX}`)).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    await user.type(textarea, 'а')
    expect(screen.getByText(`10 / ${REASON_MAX}`)).toBeInTheDocument()
    expect(confirm).toBeEnabled()
  })

  it('501 символ — заблокирована; 500 — разблокирована (верхняя граница)', async () => {
    const user = userEvent.setup()
    renderDialog()
    const textarea = screen.getByLabelText(LABEL)
    const confirm = screen.getByRole('button', { name: CONFIRM })

    await user.click(textarea)
    await user.paste('б'.repeat(REASON_MAX + 1))
    expect(screen.getByText(`501 / ${REASON_MAX}`)).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    await user.clear(textarea)
    await user.paste('б'.repeat(REASON_MAX))
    expect(confirm).toBeEnabled()
  })

  it('правило считает символы ПОСЛЕ trim: пробельная обивка не делает причину валидной', async () => {
    const user = userEvent.setup()
    renderDialog()
    const textarea = screen.getByLabelText(LABEL)

    await user.click(textarea)
    await user.paste('    короткo    ') // raw 15, trim 8 → невалидно
    expect(screen.getByRole('button', { name: CONFIRM })).toBeDisabled()
  })
})

describe('ConflictDialog: действия (AC 1, 2)', () => {
  it('«Подтвердить оверрайд» → onOverride(введённая причина)', async () => {
    const user = userEvent.setup()
    const { onOverride, onCancel } = renderDialog()
    const reason = 'Замена по приказу — наряд снят'

    await user.click(screen.getByLabelText(LABEL))
    await user.paste(reason)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(onOverride).toHaveBeenCalledTimes(1)
    expect(onOverride).toHaveBeenCalledWith(reason)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('«Отмена» → onCancel, onOverride не вызван', async () => {
    const user = userEvent.setup()
    const { onOverride, onCancel } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOverride).not.toHaveBeenCalled()
  })

  it('Escape → onCancel (keyboard path, L262)', async () => {
    const user = userEvent.setup()
    const { onOverride, onCancel } = renderDialog()

    await user.click(screen.getByLabelText(LABEL)) // фокус внутри диалога
    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOverride).not.toHaveBeenCalled()
  })
})
