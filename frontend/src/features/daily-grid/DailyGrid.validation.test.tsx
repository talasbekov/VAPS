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
    expect(document.activeElement?.hasAttribute('data-active')).toBe(true)
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
    expect(document.activeElement?.hasAttribute('data-active')).toBe(true)
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
    expect(document.activeElement?.hasAttribute('data-active')).toBe(true)
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
    // навигация к другой строке работает (грид не заблокирован целиком)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement?.hasAttribute('data-active')).toBe(true)
    expect(document.querySelectorAll('[data-marker]').length).toBe(1) // всё ещё одна
  })
})
