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
  type ColumnKind,
  type Key,
  type Position,
} from './grammar.types'

// Компайл-гварды полноты констант (satisfies в типах ловит ЛИШНИЙ элемент,
// эти ассерты — НЕДОСТАЮЩИЙ): забытый вариант молча сузил бы guard-тест и 9.3.
const _keyTypesComplete: Exclude<
  Key['type'],
  (typeof KEY_TYPES)[number]
> extends never
  ? true
  : never = true
const _cellStatesComplete: Exclude<
  CellState,
  (typeof CELL_STATES)[number]
> extends never
  ? true
  : never = true
void _keyTypesComplete
void _cellStatesComplete

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

  it('Tab/→ двигает вправо; ShiftTab/← влево; ↑/↓ по строкам — всегда MOVE/NAVIGATE', () => {
    const cases: Array<[Key['type'], Position]> = [
      ['Tab', at(1, 2)],
      ['ArrowRight', at(1, 2)],
      ['ShiftTab', at(1, 0)],
      ['ArrowLeft', at(1, 0)],
      ['ArrowUp', at(0, 1)],
      ['ArrowDown', at(2, 1)],
    ]
    for (const [keyType, next] of cases) {
      expect(run('NAVIGATE', at(1, 1), keyOf(keyType))).toEqual({
        action: 'MOVE',
        nextState: 'NAVIGATE',
        nextPosition: next,
      })
    }
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
    expect(run('EDIT', at(0, STATUS_COL), keyOf('Tab'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, 2),
    })
    expect(run('EDIT', at(0, STATUS_COL), keyOf('ShiftTab'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, 0),
    })
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
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Enter'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(1, PERIOD_COL),
    })
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Esc'))).toEqual({
      action: 'RESTORE_PRE_EDIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, PERIOD_COL),
    })
  })
  it('Tab → COMMIT вправо; ShiftTab → COMMIT влево (§3.2)', () => {
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('Tab'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, PERIOD_COL + 1),
    })
    expect(run('PERIOD_EDIT', at(0, PERIOD_COL), keyOf('ShiftTab'))).toEqual({
      action: 'COMMIT',
      nextState: 'NAVIGATE',
      nextPosition: at(0, PERIOD_COL - 1),
    })
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

// --- Guard полноты: КАЖДАЯ (state × key-класс × вид колонки) ≡ §3.2 ----------
// ОЖИДАЕМАЯ таблица — вторая, независимая кодировка контракта §3.2 (Ловушка №3):
// расхождение реализации с контрактом (в т.ч. NOOP-дыра там, где контракт
// задаёт эффект, или дрейф COMMIT→MOVE) роняет guard, а не проходит молча.

type ExpectedTransition = { action: Action; nextState: CellState }

function expectedOf(
  state: CellState,
  keyType: (typeof KEY_TYPES)[number],
  kind: ColumnKind,
): ExpectedTransition {
  switch (state) {
    case 'NAVIGATE':
      switch (keyType) {
        case 'Enter':
          if (kind === 'status')
            return { action: 'OPEN_EDIT', nextState: 'EDIT' }
          if (kind === 'period')
            return { action: 'OPEN_PERIOD', nextState: 'PERIOD_EDIT' }
          return { action: 'NOOP', nextState: 'NAVIGATE' } // readonly/flag: §2 — не вводятся
        case 'Char':
          return kind === 'status'
            ? { action: 'TYPE_AHEAD', nextState: 'EDIT' }
            : { action: 'NOOP', nextState: 'NAVIGATE' }
        case 'Esc':
          return { action: 'NOOP', nextState: 'NAVIGATE' }
        default: // Tab/ShiftTab/стрелки — навигация
          return { action: 'MOVE', nextState: 'NAVIGATE' }
      }
    case 'EDIT':
      switch (keyType) {
        case 'Enter':
        case 'Tab':
        case 'ShiftTab':
          return { action: 'COMMIT', nextState: 'NAVIGATE' }
        case 'Esc':
          return { action: 'RESTORE_PRE_EDIT', nextState: 'NAVIGATE' }
        case 'Char':
          return { action: 'TYPE_AHEAD', nextState: 'EDIT' }
        case 'ArrowUp':
        case 'ArrowDown':
          return { action: 'LIST_MOVE', nextState: 'EDIT' }
        default: // ArrowLeft/ArrowRight — текстовый курсор
          return { action: 'NOOP', nextState: 'EDIT' }
      }
    case 'PERIOD_EDIT':
      switch (keyType) {
        case 'Enter':
        case 'Tab':
        case 'ShiftTab':
          return { action: 'COMMIT', nextState: 'NAVIGATE' }
        case 'Esc':
          return { action: 'RESTORE_PRE_EDIT', nextState: 'NAVIGATE' }
        default: // символы/стрелки — редактор даты
          return { action: 'NOOP', nextState: 'PERIOD_EDIT' }
      }
    case 'CONFLICT':
      switch (keyType) {
        case 'Enter':
          return { action: 'OVERRIDE_RETRY', nextState: 'NAVIGATE' }
        case 'Esc':
          return { action: 'CLOSE_DIALOG', nextState: 'NAVIGATE' }
        default: // диалог захватывает остальное
          return { action: 'NOOP', nextState: 'CONFLICT' }
      }
  }
}

describe('полнота таблицы переходов (≡ §3.2 контракта)', () => {
  for (const state of CELL_STATES) {
    for (const keyType of KEY_TYPES) {
      it(`${state} × ${keyType} → ожидаемый эффект §3.2 на каждой колонке`, () => {
        // все виды колонок: readonly(0)/status(1)/period(2)/flag(3)
        for (let col = 0; col < BOUNDS.cols; col++) {
          const kind = BOUNDS.columnKinds[col] ?? 'readonly'
          const r = run(state, at(1, col), keyOf(keyType))
          const want = expectedOf(state, keyType, kind)
          expect({ action: r.action, nextState: r.nextState }).toEqual(want)
          expect(inBounds(r.nextPosition)).toBe(true)
        }
      })
    }
  }
})

// --- Самоисцеление входа: позиция вне bounds клампится ДО шага ----------------

describe('невалидный вход', () => {
  it('устаревшая позиция (грид сжался) клампится, стационарные ветки не эхо-возвращают мусор', () => {
    // rows сжался с 6 до 3, фокус остался на строке 5
    expect(run('NAVIGATE', at(5, 1), keyOf('Esc')).nextPosition).toEqual(
      at(2, 1),
    )
    expect(run('EDIT', at(5, 1), keyOf('Enter')).nextPosition).toEqual(at(2, 1))
  })
  it('вырожденный грид (rows=0) не даёт отрицательных координат', () => {
    const empty: Bounds = { rows: 0, cols: 0, columnKinds: [] }
    const r = transition({
      state: 'NAVIGATE',
      position: at(0, 0),
      bounds: empty,
      key: keyOf('ArrowDown'),
    })
    expect(r.nextPosition).toEqual(at(0, 0))
  })
})
