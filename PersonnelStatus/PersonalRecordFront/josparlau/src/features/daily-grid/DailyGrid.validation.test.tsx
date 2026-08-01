// @vitest-environment jsdom
// Story 9.6 — валидация в гриде: zod + конфликт-маркеры soft/hard + маппинг
// ошибок бэка на строки (per-row). Поверх seam onCellCommit (9.5) + грид 9.4/9.5.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  BusinessRuleError,
  ConflictError,
  type ApiError,
} from '../../shared/api/errors'
import { conflictOverridableEnvelope } from '../../shared/api/testing/handlers'
import { DailyGrid } from './DailyGrid'
import type { EmployeeRow, StatusOption } from './DailyGrid.types'

beforeAll(() => {
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

function rows(...statusCodes: string[]): EmployeeRow[] {
  return statusCodes.map((statusCode, i) => ({
    id: `e${i}`,
    fullName: `Сотрудник ${i}`,
    statusCode,
  }))
}

const softError = (): ApiError =>
  new ConflictError({
    status: 409,
    errorCode: conflictOverridableEnvelope.error_code,
    message: conflictOverridableEnvelope.message,
    details: conflictOverridableEnvelope.details,
    requestId: null,
  })

const hardError = (): ApiError =>
  new BusinessRuleError({
    status: 422,
    errorCode: 'REPORT_NOT_CONVERGENT',
    message: 'несходящийся расход',
    details: {},
    requestId: null,
  })

function marker(kind: 'soft' | 'hard' | 'invalid') {
  return document.querySelector(`[data-marker="${kind}"]`)
}

/**
 * aria-rowindex активной строки (1-based) — позиционный ассерт (ревью 9.6):
 * мутационная проба показала, что `hasAttribute('data-active')` истинен и
 * после НЕзаблокированного коммита (фокус уехал вниз) — 5/5 тестов зелёные
 * при снятой блокировке.
 */
function activeRowIndex(): number {
  const el = document.activeElement
  expect(el).not.toBe(document.body)
  expect(el!.hasAttribute('data-active')).toBe(true)
  return Number(el!.closest('[role="row"]')!.getAttribute('aria-rowindex'))
}

async function commitFocusedCell(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Enter}') // open edit
  await user.keyboard('{Enter}') // commit
}

describe('9.6 валидация — zod', () => {
  it('пустой statusCode → invalid-маркер, коммит блокируется, фокус на ячейке', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await commitFocusedCell(user)
    expect(marker('invalid')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /отмена/i })).toBeNull() // без диалога
    expect(activeRowIndex()).toBe(1) // блок = фокус ОСТАЛСЯ на строке 0
    expect(screen.getByLabelText('Ошибка заполнения')).toBeInTheDocument() // не «Конфликт»
  })

  it('invalid → исправление значения → валидный коммит снимает маркер и уходит вниз', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
      />,
    )
    await commitFocusedCell(user) // invalid, блок
    expect(marker('invalid')).toBeInTheDocument()
    await user.keyboard('{Enter}') // снова открыть правку
    await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
    await user.keyboard('{Enter}') // валидный коммит
    expect(marker('invalid')).toBeNull() // маркер снят clearMarker-путём
    expect(activeRowIndex()).toBe(2) // коммит ПРОШЁЛ — фокус ушёл вниз
  })
})

describe('9.6 валидация — конфликты soft/hard', () => {
  it('soft (409 overridable) → жёлтый маркер + ConflictDialog; оверрайд снимает', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={() => softError()}
      />,
    )
    await commitFocusedCell(user)
    expect(marker('soft')).toBeInTheDocument()
    const reason = await screen.findByLabelText(/причин/i)
    await user.type(reason, 'Достаточно длинная причина оверрайда')
    await user.click(screen.getByRole('button', { name: /подтвердить/i }))
    expect(marker('soft')).toBeNull() // оверрайд снял маркер
  })

  it('soft → «Отмена» оставляет маркер', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={() => softError()}
      />,
    )
    await commitFocusedCell(user)
    await user.click(await screen.findByRole('button', { name: /отмена/i }))
    expect(marker('soft')).toBeInTheDocument() // маркер остался
    expect(activeRowIndex()).toBe(1) // фокус вернулся в исходную строку
  })

  it('hard (422 BusinessRuleError) → красный маркер, блок, БЕЗ диалога', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={() => hardError()}
      />,
    )
    await commitFocusedCell(user)
    expect(marker('hard')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /отмена/i })).toBeNull() // диалога нет
    expect(activeRowIndex()).toBe(1) // блок = фокус НЕ ушёл вниз
  })

  it('hard → бэк «выздоровел» → повторный коммит снимает маркер, фокус уходит вниз, «Сдать день» разблокируется', async () => {
    const user = userEvent.setup()
    const seam = vi
      .fn<(change: unknown) => ApiError | null>()
      .mockReturnValueOnce(hardError())
      .mockReturnValue(null)
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={seam}
      />,
    )
    await commitFocusedCell(user) // hard, блок
    expect(marker('hard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /сдать день/i })).toBeDisabled()
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'заблокировано 1',
    )
    await commitFocusedCell(user) // повторный коммит: seam → null
    expect(marker('hard')).toBeNull() // clearMarker-путь жив
    expect(activeRowIndex()).toBe(2)
    expect(
      screen.getByRole('button', { name: /сдать день/i }),
    ).not.toBeDisabled()
  })

  it('уход мышью из правки = blur-коммит: zod+seam отрабатывают, маркер не лжёт', async () => {
    const user = userEvent.setup()
    const seam = vi.fn(() => hardError())
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={seam}
      />,
    )
    await user.keyboard('{Enter}') // открыть правку строки 0
    await user.selectOptions(screen.getByLabelText('Статус'), 'VACATION')
    // клик по ФИО строки 1 — раньше миновал COMMIT (ни zod, ни seam)
    const row2 = document.querySelector('[aria-rowindex="2"]')!
    await user.click(row2.querySelector('button')!)
    expect(seam).toHaveBeenCalledTimes(1) // blur-коммит дёрнул seam
    expect(marker('hard')).toBeInTheDocument() // маркер честный
    expect(screen.queryByRole('button', { name: /отмена/i })).toBeNull() // без модалки
  })
})

describe('9.6 валидация — per-row', () => {
  it('маркер на одной строке; другая строка навигируема и без маркера', async () => {
    const user = userEvent.setup()
    render(
      <DailyGrid
        rows={rows('IN_SERVICE', 'IN_SERVICE', 'IN_SERVICE')}
        statusOptions={OPTIONS}
        onSubmit={vi.fn()}
        onCellCommit={() => hardError()}
      />,
    )
    await commitFocusedCell(user) // строка 0 → hard
    expect(document.querySelectorAll('[data-marker]').length).toBe(1)
    // другая строка навигируема И редактируема (грид не заблокирован целиком)
    await user.keyboard('{ArrowDown}')
    expect(activeRowIndex()).toBe(2)
    await user.keyboard('{Enter}') // правка на строке 1 открывается
    expect(document.activeElement).toBe(screen.getByLabelText('Статус'))
    await user.keyboard('{Escape}')
    expect(document.querySelectorAll('[data-marker]').length).toBe(1) // всё ещё одна
  })
})
