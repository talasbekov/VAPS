// @vitest-environment jsdom
// Story 9.5 — фокус-слой: RTL+userEvent сценарии фокус-инвариантов (L262) +
// возврат фокуса после ConflictDialog. Грамматика 9.2 не тронута — проверяем
// ПРИМЕНЕНИЕ фокуса гридом 9.4/9.5.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ConflictError } from '../../shared/api/errors'
import { conflictOverridableEnvelope } from '../../shared/api/testing/handlers'
import { DailyGrid } from './DailyGrid'
import type { EmployeeRow, StatusOption } from './DailyGrid.types'

beforeAll(() => {
  // jsdom не реализует методы <dialog> (showModal/close) — минимальный полифилл
  // open-семантики (как в ConflictDialog.test).
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  })
})

afterEach(() => cleanup())

const OPTIONS: StatusOption[] = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'VACATION', label: 'В отпуске' },
]

function makeRows(n: number): EmployeeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    fullName: `Сотрудник ${i}`,
    statusCode: 'IN_SERVICE',
  }))
}

const conflictFixture = () =>
  new ConflictError({
    status: 409,
    errorCode: conflictOverridableEnvelope.error_code,
    message: conflictOverridableEnvelope.message,
    details: conflictOverridableEnvelope.details,
    requestId: null,
  })

/** Активная ячейка помечена data-active — единый инвариант «фокус не на body». */
function activeIsCell() {
  const el = document.activeElement
  expect(el).not.toBe(document.body)
  expect(el).toBeTruthy()
  expect(el!.hasAttribute('data-active')).toBe(true)
}

describe('9.5 фокус-слой — навигация', () => {
  it('1. монтирование → фокус в ячейке (не body)', () => {
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    activeIsCell()
  })

  it('2. Enter → открывает правку статуса (select в фокусе)', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByLabelText('Статус'))
  })

  it('3. Enter в правке → коммит и фокус вниз (не body)', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{Enter}') // open
    await user.keyboard('{Enter}') // commit → down
    activeIsCell()
  })

  it('4. Tab → вправо; 5. Shift+Tab → влево (фокус на ячейке)', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{Tab}')
    activeIsCell()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    activeIsCell()
  })

  it('6-9. стрелки ↓↑→← держат фокус на ячейке', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    for (const k of [
      '{ArrowDown}',
      '{ArrowUp}',
      '{ArrowRight}',
      '{ArrowLeft}',
    ]) {
      await user.keyboard(k)
      activeIsCell()
    }
  })

  it('10. Esc в правке → возврат pre-edit и фокус в ячейку (NAVIGATE)', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{Enter}') // open edit
    await user.keyboard('{Escape}') // restore
    activeIsCell()
    expect(document.activeElement!.tagName.toLowerCase()).toBe('button')
  })

  it('11. навигация к ФИО (readonly) — фокус на ячейке, не body', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{ArrowLeft}') // status(1) → ФИО(0)
    activeIsCell()
    expect(document.activeElement!.textContent).toContain('Сотрудник 0')
  })

  it('12-13. края (↑ на первой строке, ← на первой колонке) — фокус не падает на body', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await user.keyboard('{ArrowUp}{ArrowUp}') // уже на row 0 → кламп
    activeIsCell()
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}') // до col 0 → кламп
    activeIsCell()
  })
})

describe('9.5 фокус-слой — ConflictDialog', () => {
  it('14. конфликт на коммите → диалог; Отмена → фокус возвращается в ячейку', async () => {
    const user = userEvent.setup()
    const onCellCommit = vi.fn(() => conflictFixture())
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={onCellCommit}
      />,
    )
    await user.keyboard('{Enter}') // open edit
    await user.keyboard('{Enter}') // commit → onCellCommit → CONFLICT + dialog
    expect(onCellCommit).toHaveBeenCalled()
    // диалог открыт
    const cancel = await screen.findByRole('button', { name: /отмена/i })
    await user.click(cancel)
    activeIsCell() // фокус вернулся в ячейку, не на body
  })

  it('15. конфликт → «Подтвердить оверрайд» → фокус возвращается в ячейку', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={() => conflictFixture()}
      />,
    )
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    const reason = await screen.findByLabelText(/причин/i)
    await user.type(reason, 'Достаточно длинная причина оверрайда')
    await user.click(screen.getByRole('button', { name: /подтвердить/i }))
    activeIsCell()
  })
})
