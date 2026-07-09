// Story 9.2 — exhaustive unit-тесты грамматики (Vitest, node-env: модуль чист,
// jsdom не нужен). Источник истины таблицы переходов:
// docs/contracts/09-01-экран-1-массовый-грид.md §3.2; три инварианта — §3.3.
import { describe, expect, it } from 'vitest'

import { transition } from './grammar'
import {
  CELL_STATES,
  KEY_TYPES,
  type Action,
  type Bounds,
  type CellState,
  type Key,
  type Position,
} from './grammar.types'

// Грид §2 контракта: ФИО(readonly) · Статус · Период · флаг. 3 строки.
const BOUNDS: Bounds = {
  rows: 3,
  cols: 4,
  columnKinds: ['readonly', 'status', 'period', 'flag'],
}
const STATUS_COL = 1
const PERIOD_COL = 2
const READONLY_COL = 0

function at(row: number, col: number): Position {
  return { row, col }
}

function keyOf(type: (typeof KEY_TYPES)[number], char = 'б'): Key {
  return type === 'Char' ? { type: 'Char', char } : ({ type } as Key)
}

function run(state: CellState, position: Position, key: Key) {
  return transition({ state, position, bounds: BOUNDS, key })
}

const inBounds = (p: Position) =>
  p.row >= 0 && p.row < BOUNDS.rows && p.col >= 0 && p.col < BOUNDS.cols

// --- NAVIGATE (§3.2) --------------------------------------------------------

describe('NAVIGATE', () => {
  it('Enter на статусе → OPEN_EDIT/EDIT', () => {
    expect(run('NAVIGATE', at(0, STATUS_COL), keyOf('Enter'))).toEqual({
      action: 'OPEN_EDIT',
      nextState: 'EDIT',
      nextPosition: at(0, STATUS_COL),
    })
  })

  it('Enter на периоде → OPEN_PERIOD/PERIOD_EDIT', () => {
    const r = run('NAVIGATE', at(0, PERIOD_COL), keyOf('Enter'))
    expect(r.action).toBe('OPEN_PERIOD')
    expect(r.nextState).toBe('PERIOD_EDIT')
  })

  it('Enter на readonly → NOOP', () => {
    const r = run('NAVIGATE', at(0, READONLY_COL), keyOf('Enter'))
    expect(r.action).toBe('NOOP')
    expect(r.nextState).toBe('NAVIGATE')
  })

  it('Char на статусе → TYPE_AHEAD с seed, EDIT', () => {
    const r = run('NAVIGATE', at(0, STATUS_COL), keyOf('Char', 'б'))
    expect(r).toMatchObject({
      action: 'TYPE_AHEAD',
      nextState: 'EDIT',
      seed: 'б',
    })
  })

  it('Char на readonly → NOOP', () => {
    expect(run('NAVIGATE', at(0, READONLY_COL), keyOf('Char')).action).toBe(
      'NOOP',
    )
  })

  it('Tab/→ двигает вправо; ShiftTab/← влево; ↑/↓ по строкам', () => {
    expect(run('NAVIGATE', at(1, 1), keyOf('Tab')).nextPosition).toEqual(
      at(1, 2),
    )
    expect(run('NAVIGATE', at(1, 1), keyOf('ArrowRight')).nextPosition).toEqual(
      at(1, 2),
    )
    expect(run('NAVIGATE', at(1, 1), keyOf('ShiftTab')).nextPosition).toEqual(
      at(1, 0),
    )
    expect(run('NAVIGATE', at(1, 1), keyOf('ArrowLeft')).nextPosition).toEqual(
      at(1, 0),
    )
    expect(run('NAVIGATE', at(1, 1), keyOf('ArrowUp')).nextPosition).toEqual(
      at(0, 1),
    )
    expect(run('NAVIGATE', at(1, 1), keyOf('ArrowDown')).nextPosition).toEqual(
      at(2, 1),
    )
  })

  it('Esc в навигации → NOOP', () => {
    expect(run('NAVIGATE', at(0, 1), keyOf('Esc')).action).toBe('NOOP')
  })
})

// --- EDIT (§3.2) ------------------------------------------------------------

describe('EDIT', () => {
  it('Enter → COMMIT + фокус вниз', () => {
    expect(run('EDIT', at(0, STATUS_COL), keyOf('Enter'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(1, STATUS_COL),
    })
  })

  it('Tab → COMMIT + вправо; ShiftTab → COMMIT + влево', () => {
    expect(run('EDIT', at(0, STATUS_COL), keyOf('Tab')).nextPosition).toEqual(
      at(0, 2),
    )
    expect(
      run('EDIT', at(0, STATUS_COL), keyOf('ShiftTab')).nextPosition,
    ).toEqual(at(0, 0))
  })

  it('Esc → RESTORE_PRE_EDIT (§3.3 инвариант), позиция та же', () => {
    expect(run('EDIT', at(0, STATUS_COL), keyOf('Esc'))).toEqual({
      action: 'RESTORE_PRE_EDIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, STATUS_COL),
    })
  })

  it('Char → TYPE_AHEAD, остаёмся в EDIT', () => {
    expect(run('EDIT', at(0, STATUS_COL), keyOf('Char', 'о')).action).toBe(
      'TYPE_AHEAD',
    )
  })

  it('↑/↓ → LIST_MOVE по кандидатам, позиция грида не меняется', () => {
    const r = run('EDIT', at(1, STATUS_COL), keyOf('ArrowDown'))
    expect(r.action).toBe('LIST_MOVE')
    expect(r.nextPosition).toEqual(at(1, STATUS_COL))
  })

  it('←/→ → NOOP (текстовый курсор), остаёмся в EDIT', () => {
    expect(run('EDIT', at(0, STATUS_COL), keyOf('ArrowLeft'))).toMatchObject({
      action: 'NOOP',
      nextState: 'EDIT',
    })
  })
})

// --- PERIOD_EDIT / CONFLICT -------------------------------------------------

describe('PERIOD_EDIT', () => {
  it('Enter → COMMIT вниз; Esc → RESTORE_PRE_EDIT', () => {
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Enter')).action).toBe(
      'COMMIT',
    )
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Esc')).action).toBe(
      'RESTORE_PRE_EDIT',
    )
  })
  it('символы/стрелки → NOOP (редактор периода), остаёмся', () => {
    expect(
      run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Char', '1')),
    ).toMatchObject({
      action: 'NOOP',
      nextState: 'PERIOD_EDIT',
    })
  })
})

describe('CONFLICT', () => {
  it('Enter → OVERRIDE_RETRY, фокус в исходную ячейку', () => {
    expect(run('CONFLICT', at(2, STATUS_COL), keyOf('Enter'))).toEqual({
      action: 'OVERRIDE_RETRY',
      nextState: 'NAVIGATE',
      nextPosition: at(2, STATUS_COL),
    })
  })
  it('Esc → CLOSE_DIALOG, фокус в ячейку; прочее → NOOP', () => {
    expect(run('CONFLICT', at(2, 1), keyOf('Esc')).action).toBe('CLOSE_DIALOG')
    expect(run('CONFLICT', at(2, 1), keyOf('Tab')).action).toBe('NOOP')
  })
})

// --- Инвариант границ: движение всегда КЛАМПИТСЯ (§3.3-1, детерминированно) ---

describe('границы (клампинг)', () => {
  it('верхний/нижний/левый/правый края не выпадают', () => {
    expect(run('NAVIGATE', at(0, 1), keyOf('ArrowUp')).nextPosition).toEqual(
      at(0, 1),
    )
    expect(run('NAVIGATE', at(2, 1), keyOf('ArrowDown')).nextPosition).toEqual(
      at(2, 1),
    )
    expect(run('NAVIGATE', at(1, 0), keyOf('ShiftTab')).nextPosition).toEqual(
      at(1, 0),
    )
    expect(run('NAVIGATE', at(1, 3), keyOf('Tab')).nextPosition).toEqual(
      at(1, 3),
    )
  })
  it('COMMIT из последней строки остаётся в границах', () => {
    expect(run('EDIT', at(2, 1), keyOf('Enter')).nextPosition).toEqual(at(2, 1))
  })
})

// --- Guard полноты: КАЖДАЯ (state × key-класс) обработана и в границах -------

describe('полнота таблицы переходов', () => {
  const ACTIONS: ReadonlySet<Action> = new Set([
    'OPEN_EDIT',
    'OPEN_PERIOD',
    'TYPE_AHEAD',
    'LIST_MOVE',
    'COMMIT',
    'RESTORE_PRE_EDIT',
    'MOVE',
    'OVERRIDE_RETRY',
    'CLOSE_DIALOG',
    'NOOP',
  ])

  for (const state of CELL_STATES) {
    for (const keyType of KEY_TYPES) {
      it(`${state} × ${keyType} → валидный переход в границах`, () => {
        // проверяем на всех колонках (readonly/status/period/flag)
        for (let col = 0; col < BOUNDS.cols; col++) {
          const r = run(state, at(1, col), keyOf(keyType))
          expect(ACTIONS.has(r.action)).toBe(true)
          expect(inBounds(r.nextPosition)).toBe(true)
          expect(CELL_STATES).toContain(r.nextState)
        }
      })
    }
  }
})
