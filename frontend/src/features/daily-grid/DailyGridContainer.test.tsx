// @vitest-environment jsdom
// Story 9.7 — контейнер: prefill «вчера» + счётчик отклонений + отправка ТОЛЬКО
// дельт в bulk-3.8-shape.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { DailyGridContainer } from './DailyGridContainer'
import type { StatusOption } from './DailyGrid.types'
import type { EmployeeSeed } from './prefill'

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
const EMPLOYEES: EmployeeSeed[] = [
  { id: 'e0', fullName: 'Сотрудник 0' },
  { id: 'e1', fullName: 'Сотрудник 1' },
  { id: 'e2', fullName: 'Сотрудник 2' },
]

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
  expect(screen.getByText('В отпуске')).toBeInTheDocument() // e0 — вчерашний статус
})

it('правка → счётчик растёт; «Сдать день» → onBulkSubmit ТОЛЬКО дельта', async () => {
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
  expect(onBulkSubmit).toHaveBeenCalledWith({
    business_date: '2026-07-08',
    rows: [{ employee_id: 'e0', status_type_code: 'VACATION' }],
  })
})
