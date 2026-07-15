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

/**
 * Позиционный ассерт (ревью 9.5): «не body» недостаточно — мутационная проба
 * показала, что убитое движение фокуса оставляло 9/10 тестов зелёными.
 * row/col читаются из ARIA-раскладки (aria-rowindex 1-based; колонка = индекс
 * gridcell в строке).
 */
function activeCellAt(row: number, col: number) {
  activeIsCell()
  const el = document.activeElement!
  const rowEl = el.closest('[role="row"]')
  expect(rowEl).toBeTruthy()
  expect(Number(rowEl!.getAttribute('aria-rowindex'))).toBe(row + 1)
  const cellEl = el.closest('[role="gridcell"]')
  const cells = Array.from(rowEl!.querySelectorAll('[role="gridcell"]'))
  expect(cells.indexOf(cellEl as Element)).toBe(col)
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
    activeCellAt(1, 1) // ИМЕННО вниз, та же колонка (ревью 9.5: не только «не body»)
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
    activeCellAt(0, 2) // вправо: статус → период
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    activeCellAt(0, 1) // влево: обратно на статус
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
    await user.keyboard('{ArrowDown}')
    activeCellAt(1, 1)
    await user.keyboard('{ArrowUp}')
    activeCellAt(0, 1)
    await user.keyboard('{ArrowRight}')
    activeCellAt(0, 2)
    await user.keyboard('{ArrowLeft}')
    activeCellAt(0, 1)
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
    // Ревью 9.5: раньше значение не менялось — «возврат pre-edit» был вакуумен.
    await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
    await user.keyboard('{Escape}') // restore
    activeCellAt(0, 1)
    expect(document.activeElement!.tagName.toLowerCase()).toBe('button')
    expect(document.activeElement!.textContent).toContain('В строю') // pre-edit вернулся
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 4',
    )
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
    activeCellAt(0, 0)
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
    activeCellAt(0, 1) // позиция НЕ уехала (кламп ≠ сломанная навигация)
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}') // до col 0 → кламп
    activeCellAt(0, 0)
    await user.keyboard(
      '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}',
    ) // 4 строки → кламп на последней
    activeCellAt(3, 0)
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}') // до флага → кламп
    activeCellAt(3, 3)
  })

  it('16. клик мышью по ячейке другой строки → стейт следует за DOM-фокусом, Enter правит ТУ строку', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={makeRows(4)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    // фокус-стейт на row 0; клик по статус-ячейке row 2 (ревью 9.5: без синка
    // Enter открыл бы правку row 0 — ввод статуса не тому сотруднику)
    const row2 = document.querySelector('[aria-rowindex="3"]')!
    const statusBtn = row2.querySelectorAll('[role="gridcell"] button')[1]
    await user.click(statusBtn as HTMLElement)
    activeCellAt(2, 1)
    await user.keyboard('{Enter}')
    const select = screen.getByLabelText('Статус')
    expect(select.closest('[role="row"]')!.getAttribute('aria-rowindex')).toBe(
      '3',
    )
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
    await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
    await user.keyboard('{Enter}') // commit → onCellCommit → CONFLICT + dialog
    expect(onCellCommit).toHaveBeenCalled()
    // диалог открыт
    const cancel = await screen.findByRole('button', { name: /отмена/i })
    await user.click(cancel)
    activeCellAt(0, 1) // фокус вернулся В ИСХОДНУЮ ячейку, не просто «не body»
    // §3.2 «значение не сохранено»: отвергнутое значение откачено к pre-edit,
    // НЕ уедет в bulk-дельты 9.7; soft-маркер остаётся предупреждением.
    expect(document.activeElement!.textContent).toContain('В строю')
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 4',
    )
    expect(
      document
        .querySelector('[aria-rowindex="1"]')!
        .getAttribute('data-marker'),
    ).toBe('soft')
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
    activeCellAt(0, 1)
    // оверрайд принят: soft-маркер снят
    expect(
      document
        .querySelector('[aria-rowindex="1"]')!
        .getAttribute('data-marker'),
    ).toBeNull()
  })

  it('17. Enter, добравшийся до грида при открытом диалоге, НЕ оверрайдит (обход причины запрещён)', async () => {
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
    await user.keyboard('{Enter}') // конфликт → диалог
    await screen.findByRole('button', { name: /отмена/i })
    // jsdom-полифилл не уводит фокус в диалог → Enter бьёт в грид (ровно
    // деградированное окружение, от которого защищаемся — ревью 9.5)
    await user.keyboard('{Enter}')
    // диалог всё ещё открыт, маркер не снят — бесплатного оверрайда нет
    expect(screen.getByRole('button', { name: /отмена/i })).toBeInTheDocument()
    expect(
      document
        .querySelector('[aria-rowindex="1"]')!
        .getAttribute('data-marker'),
    ).toBe('soft')
  })

  it('18. Escape, добравшийся до грида при открытом диалоге, = безопасная отмена (фокус в ячейку, маркер остаётся)', async () => {
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
    await screen.findByRole('button', { name: /отмена/i })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: /отмена/i })).toBeNull()
    activeCellAt(0, 1)
    expect(
      document
        .querySelector('[aria-rowindex="1"]')!
        .getAttribute('data-marker'),
    ).toBe('soft')
  })
})
