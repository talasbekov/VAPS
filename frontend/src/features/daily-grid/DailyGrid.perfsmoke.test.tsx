// @vitest-environment jsdom
// Story 9.8 — перф-смоук: БЛОКИРУЮЩИЕ детерминированные счётчики (коммиты/DOM)
// на 500 строках. Тайминги p95 (Playwright CDP) — не-блокирующий артефакт,
// привязка к смонтированному гриду (9.9/10.2). architecture.md L246.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { DailyGrid } from './DailyGrid'
import type { EmployeeRow, StatusOption } from './DailyGrid.types'

const origOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
)
const origOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth',
)

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

afterAll(() => {
  // Прототип общий на процесс: не восстановить — геттеры протекут в чужие
  // сюиты при неизолированном раннере (ревью 9.7/9.8).
  vi.unstubAllGlobals()
  if (origOffsetHeight)
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      origOffsetHeight,
    )
  if (origOffsetWidth)
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
})

afterEach(() => cleanup())

// Кириллические лейблы с РАЗНЫМИ префиксами: чередование сидов «н»/«в»
// переключает статус НА КАЖДОЕ нажатие — серия меряет живой value-путь
// (TYPE_AHEAD → dispatch → reducer → memo(GridRow)), а не только identity
// setFocus (ревью 9.8 P1: латиница не матчилась вовсе — серия была вакуумной).
const OPTIONS: StatusOption[] = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'SICK_LEAVE', label: 'На больничном' },
]

function makeRows(n: number): EmployeeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    fullName: `Сотрудник ${i}`,
    statusCode: 'IN_SERVICE',
  }))
}

// Геометрия обвязки: initialRect 400px / ROW_HEIGHT 36 → 12 видимых,
// overscan 8 с двух сторон + частичная строка ≈ 29 узлов максимум.
// Бюджет 32 (небольшой люфт) — утроенный overscan/накопление строк красные.
// Спайк 1.10 BUDGET.md: факт ~30 dev / ~40-46 target, «≪ 1000» — унаследованное
// от 9.4 «60» спайку НЕ принадлежало и пропускало 3× регрессию (ревью P3).
const DOM_BUDGET = 32
const VISIBLE_MIN = 11 // видимое окно 400/36 заполнено (нижняя грань санити)

/** rAF+macrotask flush: отложенные коммиты (виртуализатор/эффекты) докатились. */
async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
}

describe('9.8 перф-смоук (блокирующие счётчики)', () => {
  it('500 строк, серия из 12 живых type-ahead → РОВНО 12 коммитов, без async-хвоста', async () => {
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
    // Сброс ПОСЛЕ flush'а маунт-хвоста: иначе отложенный setState обвязки
    // попал бы в серию и счётчик поплыл бы без изменения клавиатурного пути.
    await flushAsync()
    commits = 0
    const N = 12
    // Чередование «н»/«в» с первого несовпадающего: каждое нажатие реально
    // переключает статус ячейки строки 0 (IN_SERVICE ⇄ SICK_LEAVE).
    for (let i = 0; i < N; i++) {
      fireEvent.keyDown(grid, { key: i % 2 === 0 ? 'н' : 'в' })
      if (i === 0) {
        // Поведенческая привязка: первый сид ОБЯЗАН открыть EDIT и сменить
        // значение — иначе счётчик меряет пустые ре-рендеры (ревью P1).
        expect(screen.getByLabelText<HTMLSelectElement>('Статус').value).toBe(
          'SICK_LEAVE',
        )
      }
    }
    expect(commits).toBe(N) // без каскада: ровно 1 коммит на нажатие
    // Последний сид «в» вернул IN_SERVICE; правка жива, фокус — в селекте
    // (не «мёртвая клавиатура» на body).
    const select = screen.getByLabelText<HTMLSelectElement>('Статус')
    expect(select.value).toBe('IN_SERVICE')
    expect(document.activeElement).toBe(select)
    // Урок спайка 1.10 (BUDGET.md: «commits-per-key вне latency-логики, иначе
    // async-коммиты невидимы»): каскад rAF/таймера после серии — тоже красный.
    await flushAsync()
    expect(commits).toBe(N)
  })

  it('500 строк → DOM-узлов строк ≤ бюджета; окно живое, строки не копятся при скролле', async () => {
    render(
      <DailyGrid
        rows={makeRows(500)}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    const initial = document.querySelectorAll('[data-grid-row]').length
    expect(initial).toBeGreaterThanOrEqual(VISIBLE_MIN)
    expect(initial).toBeLessThanOrEqual(DOM_BUDGET)
    // Окно рендерит НАЧАЛО списка, а не заглушку: строка 0 есть, 250-й нет.
    expect(screen.getByText('Сотрудник 0')).toBeInTheDocument()
    expect(screen.queryByText('Сотрудник 250')).not.toBeInTheDocument()

    // Переокно на середину: классический баг виртуализации — строки не
    // анмаунтятся/копятся — виден только после скролла (ревью P3).
    const grid = screen.getByRole('grid')
    grid.scrollTop = 250 * 36
    await act(async () => {
      fireEvent.scroll(grid)
    })
    const scrolled = document.querySelectorAll('[data-grid-row]').length
    expect(scrolled).toBeGreaterThanOrEqual(VISIBLE_MIN)
    expect(scrolled).toBeLessThanOrEqual(DOM_BUDGET)
    expect(screen.getByText('Сотрудник 250')).toBeInTheDocument()
    // Строка 0 остаётся: rangeExtractor 9.5 намеренно пинит СФОКУСИРОВАННУЮ
    // строку в окне (фокус не падает при скролле). Накопление ловим по
    // НЕфокусной строке начала списка — она обязана анмаунтиться.
    expect(screen.getByText('Сотрудник 0')).toBeInTheDocument()
    expect(screen.queryByText('Сотрудник 5')).not.toBeInTheDocument()
  })
})
