// @vitest-environment jsdom
// Story 10.2 — канал грязного состояния грида (onDirtyChange). Ключевой
// инвариант: счётчик считает ДЕЛЬТЫ ЗНАЧЕНИЙ, а не нажатия — иначе оператор,
// просто просмотревший список стрелками, получил бы модалку «уйти со
// страницы?» (ложный beforeunload, AC-11).
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

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
  vi.unstubAllGlobals()
  if (origOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight)
  if (origOffsetWidth)
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
})

afterEach(() => cleanup())

const OPTIONS: StatusOption[] = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'VACATION', label: 'В отпуске' },
]

// Кириллица во всех фикстурах (урок E9: латинские имена дают «зелёный тест на
// сломанном» — type-ahead и сортировки ведут себя иначе)
const ROWS: EmployeeRow[] = [
  { id: 'e0', fullName: 'Абдуллаев Асхат Маратович', statusCode: 'IN_SERVICE', period: '' },
  { id: 'e1', fullName: 'Бекова Гульмира Ержановна', statusCode: 'IN_SERVICE', period: '' },
  { id: 'e2', fullName: 'Валиев Тимур Русланович', statusCode: 'IN_SERVICE', period: '' },
]

it('правка ячейки → onDirtyChange(1); возврат к базовой линии → onDirtyChange(0)', async () => {
  const user = userEvent.setup()
  const onDirtyChange = vi.fn()
  render(
    <DailyGrid
      rows={ROWS}
      statusOptions={OPTIONS}
      onSubmit={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  // Монтирование сообщает чистое состояние — beforeunload не навешан
  expect(onDirtyChange).toHaveBeenCalledWith(0)

  await user.keyboard('{Enter}')
  await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
  expect(onDirtyChange).toHaveBeenLastCalledWith(1)

  await user.selectOptions(screen.getByLabelText('Статус'), 'IN_SERVICE')
  expect(onDirtyChange).toHaveBeenLastCalledWith(0)
})

it('серия стрелок без правок: onDirtyChange НЕ дёргается вовсе (анти-ложный beforeunload)', async () => {
  const user = userEvent.setup()
  const onDirtyChange = vi.fn()
  render(
    <DailyGrid
      rows={ROWS}
      statusOptions={OPTIONS}
      onSubmit={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  onDirtyChange.mockClear() // отбрасываем сообщение о монтировании

  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowRight}{ArrowLeft}')

  // Ни одного вызова: эффект висит на changed.length, а не на нажатиях.
  // Реализация «слушатель keydown» дала бы 5 вызовов и ложный dirty.
  expect(onDirtyChange).not.toHaveBeenCalled()
})

it('без пропа onDirtyChange грид работает как раньше (аддитивность, AC-13)', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(<DailyGrid rows={ROWS} statusOptions={OPTIONS} onSubmit={onSubmit} />)

  await user.keyboard('{Enter}')
  await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 1 из 3',
  )
})
