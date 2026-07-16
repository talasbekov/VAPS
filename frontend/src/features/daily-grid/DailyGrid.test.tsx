// @vitest-environment jsdom
// Story 9.4 — грид: пустое состояние/фокус, счётчик/onSubmit, перф-инвариант
// (Profiler 1 commit/keystroke, БЛОКИРУЮЩИЙ), виртуализация ≤N DOM при 5000.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler, act, createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// TanStack Virtual в jsdom: без ResizeObserver и с нулевым getBoundingClientRect
// окно виртуализации = 0 (строк не рендерит). Полифилл + ненулевой rect скролл-
// контейнера — стандартная тест-обвязка (в проде меряется реально).
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // TanStack getRect читает offsetWidth/offsetHeight (в jsdom = 0). Ненулевой
  // размер скролл-контейнера → окно виртуализации > 0.
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

import { DailyGrid } from './DailyGrid'
import type {
  DailyGridHandle,
  EmployeeRow,
  StatusOption,
} from './DailyGrid.types'

const OPTIONS: StatusOption[] = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'VACATION', label: 'В отпуске' },
  { code: 'SICK', label: 'На больничном' },
]

function makeRows(n: number): EmployeeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    fullName: `Сотрудник ${i}`,
    statusCode: 'IN_SERVICE',
  }))
}

describe('DailyGrid — пустое состояние и фокус', () => {
  it('0 строк → пустое состояние, фокус не падает на body', () => {
    render(<DailyGrid rows={[]} statusOptions={OPTIONS} onSubmit={vi.fn()} />)
    expect(screen.getByTestId('grid-empty')).toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('непустой грид → фокус в первой ячейке статуса (не body)', () => {
    render(
      <DailyGrid
        rows={makeRows(5)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.tagName.toLowerCase()).toBe('button')
  })
})

describe('DailyGrid — счётчик и отправка', () => {
  it('правка статуса → счётчик растёт, onSubmit получает изменение', () => {
    const onSubmit = vi.fn()
    render(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={onSubmit}
      />,
    )
    const grid = screen.getByRole('grid')
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 3',
    )

    // Enter на статусе → открыть select, сменить значение
    fireEvent.keyDown(grid, { key: 'Enter' })
    const select = screen.getByLabelText('Статус') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'VACATION' } })

    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 1 из 3',
    )
    fireEvent.click(screen.getByText('Сдать день'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { id: 'e0', statusCode: 'VACATION', period: '' },
    ])
  })
})

describe('DailyGrid — type-ahead seed (ревью 9.4: AC-3, §3.3 инвариант 2)', () => {
  it('символ в NAVIGATE → EDIT открыт И seed применён (прыжок по префиксу label)', () => {
    render(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Н' }) // «На больничном»
    const select = screen.getByLabelText('Статус') as HTMLSelectElement
    expect(select.value).toBe('SICK') // нажатие НЕ потеряно
  })

  it('символ внутри EDIT фильтрует дальше и НЕ перезатирает pre-edit: Esc возвращает исходное', () => {
    render(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Enter' }) // OPEN_EDIT, снапшот = IN_SERVICE
    fireEvent.keyDown(grid, { key: 'Н' }) // TYPE_AHEAD в EDIT → SICK
    let select = screen.getByLabelText('Статус') as HTMLSelectElement
    expect(select.value).toBe('SICK')
    fireEvent.keyDown(grid, { key: 'В' }) // ещё прыжок → «В строю»/«В отпуске»
    fireEvent.keyDown(grid, { key: 'Escape' }) // RESTORE_PRE_EDIT
    fireEvent.keyDown(grid, { key: 'Enter' }) // снова открыть
    select = screen.getByLabelText('Статус') as HTMLSelectElement
    expect(select.value).toBe('IN_SERVICE') // исходное, не промежуточное
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 3',
    )
  })
})

describe('DailyGrid — смена rows-пропа (ревью 9.4: самоисцеление)', () => {
  it('сжатие rows при устаревшем фокусе → COMMIT не падает, фокус клампится', () => {
    const { rerender } = render(
      <DailyGrid
        rows={makeRows(10)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const grid = screen.getByRole('grid')
    for (let i = 0; i < 7; i++) fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' }) // EDIT на строке 7
    rerender(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    // Enter в EDIT → COMMIT по устаревшей позиции: не должен кидать TypeError
    expect(() => fireEvent.keyDown(grid, { key: 'Enter' })).not.toThrow()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('новый состав rows → новые id рендерятся и редактируемы, правки живут, нетронутые строки берут новый initial', () => {
    const onSubmit = vi.fn()
    const before: EmployeeRow[] = [
      { id: 'a', fullName: 'А', statusCode: 'IN_SERVICE' },
      { id: 'b', fullName: 'Б', statusCode: 'IN_SERVICE' },
    ]
    const { rerender } = render(
      <DailyGrid rows={before} statusOptions={OPTIONS} onSubmit={onSubmit} />,
    )
    const grid = screen.getByRole('grid')
    // правка строки a: IN_SERVICE → VACATION, Enter = COMMIT
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Статус'), {
      target: { value: 'VACATION' },
    })
    fireEvent.keyDown(grid, { key: 'Enter' })
    // refetch: у b сервер сменил статус, появился новый c
    const after: EmployeeRow[] = [
      { id: 'a', fullName: 'А', statusCode: 'IN_SERVICE' },
      { id: 'b', fullName: 'Б', statusCode: 'SICK' },
      { id: 'c', fullName: 'В', statusCode: 'IN_SERVICE' },
    ]
    expect(() =>
      rerender(
        <DailyGrid rows={after} statusOptions={OPTIONS} onSubmit={onSubmit} />,
      ),
    ).not.toThrow() // новый id не роняет рендер
    // правка a пережила ресинк; b взял новый initial (не ложно-dirty)
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 1 из 3',
    )
    fireEvent.click(screen.getByText('Сдать день'))
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { id: 'a', statusCode: 'VACATION', period: '' },
    ])
  })
})

describe('DailyGrid — перф-инвариант (БЛОКИРУЮЩИЙ)', () => {
  it('одно нажатие клавиши → РОВНО 1 React-коммит (Profiler)', () => {
    let commits = 0
    render(
      <Profiler id="grid" onRender={() => (commits += 1)}>
        <DailyGrid
          rows={makeRows(6)}
          statusOptions={OPTIONS}
          onSubmit={vi.fn()}
        />
      </Profiler>,
    )
    const grid = screen.getByRole('grid')
    commits = 0 // сбросить после начального рендера
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(commits).toBe(1)
  })
})

describe('DailyGrid — виртуализация', () => {
  it('5000 строк → в DOM ≤ N строк-узлов (не 5000)', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    render(
      <DailyGrid
        rows={makeRows(5000)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
      {
        container: parent,
      },
    )
    const rowEls = parent.querySelectorAll('[data-grid-row]')
    expect(rowEls.length).toBeGreaterThan(0) // не вакуумно
    expect(rowEls.length).toBeLessThanOrEqual(60)
    expect(rowEls.length).toBeLessThan(5000)
  })
})

// --- Story 10.2 — обратный канал маркеров + Ctrl+Enter выход -----------------

/** Строка грида по ФИО (позиционная привязка — прецедент 9.5). */
function rowOf(fullName: string): HTMLElement {
  const row = screen.getByText(fullName).closest<HTMLElement>('[data-grid-row]')
  if (!row) throw new Error(`Строка «${fullName}» не найдена`)
  return row
}

describe('10.2 DailyGrid — императивный канал applyMarkers (AC-7/AC-9)', () => {
  it('applyMarkers мержит в СУЩЕСТВУЮЩИЙ markers-стейт: заливка + гейт «Сдать день»', () => {
    const ref = createRef<DailyGridHandle>()
    render(
      <DailyGrid
        ref={ref}
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    act(() => ref.current!.applyMarkers({ e0: 'hard', e1: 'soft' }))
    expect(rowOf('Сотрудник 0')).toHaveAttribute('data-marker', 'hard')
    expect(rowOf('Сотрудник 1')).toHaveAttribute('data-marker', 'soft')
    // Переиспользован существующий гейт: hard блокирует отправку, soft — нет.
    expect(screen.getByText('Сдать день')).toBeDisabled()
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'заблокировано 1',
    )
  })

  it('id вне текущих rows игнорируется (чужой сотрудник из агрегата)', () => {
    const ref = createRef<DailyGridHandle>()
    render(
      <DailyGrid
        ref={ref}
        rows={makeRows(2)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    act(() => ref.current!.applyMarkers({ ghost: 'hard' }))
    expect(
      document.querySelectorAll('[data-marker]').length,
    ).toBe(0)
    expect(screen.getByText('Сдать день')).toBeEnabled()
  })

  it('RESYNC-прунинг переиспользован: маркер строки с обновлённым initial снят', () => {
    const ref = createRef<DailyGridHandle>()
    const rows = makeRows(2)
    const { rerender } = render(
      <DailyGrid
        ref={ref}
        rows={rows}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    act(() => ref.current!.applyMarkers({ e0: 'hard' }))
    expect(rowOf('Сотрудник 0')).toHaveAttribute('data-marker', 'hard')
    // Сервер обновил initial e0 (rebase/refetch) → стейл-маркер исцеляется
    // существующим RESYNC-прунингом (9.6) — параллельного источника нет.
    const next = [{ ...rows[0], statusCode: 'VACATION' }, rows[1]]
    rerender(
      <DailyGrid
        ref={ref}
        rows={next}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    expect(rowOf('Сотрудник 0')).not.toHaveAttribute('data-marker')
  })

  it('isDirty: false на старте, true после правки', () => {
    const ref = createRef<DailyGridHandle>()
    render(
      <DailyGrid
        ref={ref}
        rows={makeRows(2)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    expect(ref.current!.isDirty()).toBe(false)
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Статус'), {
      target: { value: 'VACATION' },
    })
    expect(ref.current!.isDirty()).toBe(true)
  })
})

describe('10.2 DailyGrid — Ctrl+Enter: санкционированный выход (AC-12)', () => {
  it('Ctrl+Enter в NAVIGATE → фокус НА КНОПКЕ «Сдать день» (направленный ассерт), сабмита нет', () => {
    const onSubmit = vi.fn()
    render(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={onSubmit}
      />,
    )
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Enter', ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByText('Сдать день'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('грамматика событие НЕ получила: перехода NAVIGATE→EDIT нет (select не открыт)', () => {
    render(
      <DailyGrid
        rows={makeRows(3)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Enter', ctrlKey: true })
    expect(screen.queryByLabelText('Статус')).not.toBeInTheDocument()
  })

  it('submitPending дизейблит «Сдать день» (AC-5: pending-гейт повторного клика)', () => {
    render(
      <DailyGrid
        rows={makeRows(2)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        submitPending
      />,
    )
    expect(screen.getByText('Сдать день')).toBeDisabled()
  })
})
