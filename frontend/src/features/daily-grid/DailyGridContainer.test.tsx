// @vitest-environment jsdom
// Story 9.7 — контейнер: prefill «вчера» + счётчик отклонений + отправка ТОЛЬКО
// дельт в bulk-3.8-shape.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { DailyGridContainer } from './DailyGridContainer'
import type { StatusOption } from './DailyGrid.types'
import type { EmployeeSeed } from './prefill'

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
  // сюиты при неизолированном раннере.
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

const OPTIONS: StatusOption[] = [
  { code: 'IN_SERVICE', label: 'В строю' },
  { code: 'VACATION', label: 'В отпуске' },
]
const EMPLOYEES: EmployeeSeed[] = [
  { id: 'e0', fullName: 'Сотрудник 0' },
  { id: 'e1', fullName: 'Сотрудник 1' },
  { id: 'e2', fullName: 'Сотрудник 2' },
]

/** Строка грида, содержащая данное ФИО (позиционная привязка — прецедент 9.5). */
function rowOf(fullName: string): HTMLElement {
  const row = screen.getByText(fullName).closest<HTMLElement>('[data-grid-row]')
  if (!row) throw new Error(`Строка «${fullName}» не найдена`)
  return row
}

it('prefill: строки из вчера, счётчик «Изменено 0 из 3»', () => {
  render(
    <DailyGridContainer
      employees={EMPLOYEES}
      yesterday={{ e0: { statusCode: 'VACATION' } }}
      businessDate="2026-07-08"
      statusOptions={OPTIONS}
      onBulkSubmit={vi.fn()}
    />,
  )
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 0 из 3',
  )
  // Вчерашний статус привязан к СВОЕЙ строке, дефолт — к соседней.
  expect(
    within(rowOf('Сотрудник 0')).getByText('В отпуске'),
  ).toBeInTheDocument()
  expect(within(rowOf('Сотрудник 1')).getByText('В строю')).toBeInTheDocument()
})

it('правка → счётчик растёт; «Сдать день» → onBulkSubmit РОВНО раз, только дельта в 3.8-shape', async () => {
  const user = userEvent.setup()
  const onBulkSubmit = vi.fn()
  render(
    <DailyGridContainer
      employees={EMPLOYEES}
      yesterday={{}}
      businessDate="2026-07-08"
      statusOptions={OPTIONS}
      onBulkSubmit={onBulkSubmit}
    />,
  )
  await user.keyboard('{Enter}') // открыть правку статуса строки 0
  await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 1 из 3',
  )
  await user.click(screen.getByText('Сдать день'))
  expect(onBulkSubmit).toHaveBeenCalledTimes(1)
  // 10.2: вторым аргументом — исходные RowChange (rebase initials страницей).
  expect(onBulkSubmit).toHaveBeenCalledWith(
    {
      business_date: '2026-07-08',
      rows: [
        {
          employee_id: 'e0',
          status_type_code: 'VACATION',
          date_start: '2026-07-08',
          date_end: '2026-07-09',
        },
      ],
    },
    [{ id: 'e0', statusCode: 'VACATION', period: '' }],
  )
})

it('откат правки к базовой линии → счётчик обратно 0; пустая сдача НЕ зовёт onBulkSubmit', async () => {
  const user = userEvent.setup()
  const onBulkSubmit = vi.fn()
  render(
    <DailyGridContainer
      employees={EMPLOYEES}
      yesterday={{}}
      businessDate="2026-07-08"
      statusOptions={OPTIONS}
      onBulkSubmit={onBulkSubmit}
    />,
  )
  await user.keyboard('{Enter}')
  await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 1 из 3',
  )
  // Возврат к prefill-значению: строка перестаёт быть отклонением.
  await user.selectOptions(screen.getByLabelText('Статус'), 'IN_SERVICE')
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 0 из 3',
  )
  // Ноль дельт → bulk-вызова нет (бэк-3.8 отверг бы пустой payload 400).
  await user.click(screen.getByText('Сдать день'))
  expect(onBulkSubmit).not.toHaveBeenCalled()
})

it('смена businessDate ремоунтит грид — правки старого дня не пере-датируются', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <DailyGridContainer
      employees={EMPLOYEES}
      yesterday={{}}
      businessDate="2026-07-08"
      statusOptions={OPTIONS}
      onBulkSubmit={vi.fn()}
    />,
  )
  await user.keyboard('{Enter}')
  await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 1 из 3',
  )
  rerender(
    <DailyGridContainer
      employees={EMPLOYEES}
      yesterday={{}}
      businessDate="2026-07-09"
      statusOptions={OPTIONS}
      onBulkSubmit={vi.fn()}
    />,
  )
  // key={businessDate}: новый день = чистый грид, дельта 08-го не уедет 09-м.
  expect(screen.getByTestId('changed-counter').textContent).toContain(
    'Изменено 0 из 3',
  )
})
