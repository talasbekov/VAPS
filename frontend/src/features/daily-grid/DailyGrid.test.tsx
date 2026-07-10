// @vitest-environment jsdom
// Story 9.4 — грид: пустое состояние/фокус, счётчик/onSubmit, перф-инвариант
// (Profiler 1 commit/keystroke, БЛОКИРУЮЩИЙ), виртуализация ≤N DOM при 5000.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
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
import type { EmployeeRow, StatusOption } from './DailyGrid.types'

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
