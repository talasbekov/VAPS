// @vitest-environment jsdom
// Story 9.8 — перф-смоук: БЛОКИРУЮЩИЕ детерминированные счётчики (коммиты/DOM)
// на 500 строках. Тайминги p95 (Playwright CDP) — не-блокирующий артефакт,
// привязка к смонтированному гриду (9.9/10.2). architecture.md L246.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { DailyGrid } from './DailyGrid'
import type { EmployeeRow, StatusOption } from './DailyGrid.types'

beforeAll(() => {
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

// Бюджет DOM-узлов виртуализации (спайк 1.10 / константа 9.4).
const DOM_BUDGET = 60

describe('9.8 перф-смоук (блокирующие счётчики)', () => {
  it('500 строк, серия из 12 символов → РОВНО 12 React-коммитов (1/нажатие)', () => {
    let commits = 0
    render(
      <Profiler id="grid" onRender={() => (commits += 1)}>
        <DailyGrid
          rows={makeRows(500)}
          statusOptions={OPTIONS}
          onSubmit={vi.fn()}
        />
      </Profiler>,
    )
    const grid = screen.getByRole('grid')
    commits = 0 // сброс после начального рендера
    const N = 12
    // Серия символов В ОДНОЙ ячейке (type-ahead) — без скролл-каскада.
    for (let i = 0; i < N; i++) {
      fireEvent.keyDown(grid, { key: String.fromCharCode(97 + (i % 26)) })
    }
    expect(commits).toBe(N) // без каскада: ровно 1 коммит на нажатие
  })

  it('500 строк → DOM-узлов строк ≤ бюджета (виртуализация)', () => {
    render(
      <DailyGrid
        rows={makeRows(500)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const rowEls = document.querySelectorAll('[data-grid-row]')
    expect(rowEls.length).toBeGreaterThan(0)
    expect(rowEls.length).toBeLessThanOrEqual(DOM_BUDGET)
  })
})
