// Story 9.2 — клавиатурная грамматика грида слепого ввода как ЧИСТАЯ
// state machine (architecture.md L253): без React/DOM, детерминирована.
// Реализует таблицу переходов §3.2 контракта docs/contracts/09-01-*.md.
//
// Модуль НЕ хранит значения ячеек и НЕ двигает реальный фокус — он лишь
// вычисляет (action, nextState, nextPosition). Применение (рендер, DOM-фокус,
// восстановление pre-edit значения, детект 409/422) — грид 9.4 / фокус 9.5 /
// валидация 9.6.

import type {
  Bounds,
  CellState,
  ColumnKind,
  Position,
  TransitionInput,
  TransitionResult,
} from './grammar.types'

function clamp(value: number, max: number): number {
  if (max < 0) return 0 // вырожденный грид (rows/cols = 0): держимся нуля
  if (value < 0) return 0
  if (value > max) return max
  return value
}

function move(
  position: Position,
  bounds: Bounds,
  dRow: number,
  dCol: number,
): Position {
  return {
    row: clamp(position.row + dRow, bounds.rows - 1),
    col: clamp(position.col + dCol, bounds.cols - 1),
  }
}

function columnKind(bounds: Bounds, col: number): ColumnKind {
  return bounds.columnKinds[col] ?? 'readonly'
}

function stay(
  state: CellState,
  position: Position,
  action: TransitionResult['action'],
): TransitionResult {
  return { action, nextState: state, nextPosition: position }
}

/**
 * Единственный публичный вход грамматики: один шаг конечного автомата.
 * Чистая функция — тот же вход даёт тот же выход, без сайд-эффектов.
 *
 * Входная позиция вне bounds (грид сжался после refetch/фильтра, фокус
 * устарел) клампится ДО шага — ни одна ветка, включая стационарные
 * (NOOP/Esc/CONFLICT), не эхо-возвращает невалидную позицию.
 */
export function transition(input: TransitionInput): TransitionResult {
  const { state, bounds } = input
  const position: Position = {
    row: clamp(input.position.row, bounds.rows - 1),
    col: clamp(input.position.col, bounds.cols - 1),
  }
  const healed: TransitionInput = { ...input, position }

  switch (state) {
    case 'NAVIGATE':
      return navigate(healed)
    case 'EDIT':
      return edit(healed)
    case 'PERIOD_EDIT':
      return periodEdit(healed)
    case 'CONFLICT':
      return conflict(healed)
    default: {
      // Исчерпывающая проверка: новый CellState обязан завести ветку.
      // В рантайме (не-TS вызов) — честный NOOP, а не мусор в результате.
      const never: never = state
      void never
      return { action: 'NOOP', nextState: state, nextPosition: position }
    }
  }
}

function navigate({
  position,
  bounds,
  key,
}: TransitionInput): TransitionResult {
  const kind = columnKind(bounds, position.col)
  switch (key.type) {
    case 'Enter':
      if (kind === 'status')
        return {
          action: 'OPEN_EDIT',
          nextState: 'EDIT',
          nextPosition: position,
        }
      if (kind === 'period')
        return {
          action: 'OPEN_PERIOD',
          nextState: 'PERIOD_EDIT',
          nextPosition: position,
        }
      return stay('NAVIGATE', position, 'NOOP')
    case 'Char':
      if (kind === 'status')
        return {
          action: 'TYPE_AHEAD',
          nextState: 'EDIT',
          nextPosition: position,
          seed: key.char,
        }
      return stay('NAVIGATE', position, 'NOOP')
    case 'Tab':
    case 'ArrowRight':
      return {
        action: 'MOVE',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, 1),
      }
    case 'ShiftTab':
    case 'ArrowLeft':
      return {
        action: 'MOVE',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, -1),
      }
    case 'ArrowUp':
      return {
        action: 'MOVE',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, -1, 0),
      }
    case 'ArrowDown':
      return {
        action: 'MOVE',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 1, 0),
      }
    case 'Esc':
      return stay('NAVIGATE', position, 'NOOP')
    default: {
      const never: never = key
      void never
      return stay('NAVIGATE', position, 'NOOP')
    }
  }
}

function edit({ position, bounds, key }: TransitionInput): TransitionResult {
  switch (key.type) {
    case 'Enter': // подтвердить и уйти вниз (§3.2)
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 1, 0),
      }
    case 'Tab': // подтвердить и вправо
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, 1),
      }
    case 'ShiftTab': // подтвердить и влево
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, -1),
      }
    case 'Esc': // отмена: вернуть pre-edit (§3.3 инвариант)
      return {
        action: 'RESTORE_PRE_EDIT',
        nextState: 'NAVIGATE',
        nextPosition: position,
      }
    case 'Char': // фильтрация списка (type-ahead)
      return {
        action: 'TYPE_AHEAD',
        nextState: 'EDIT',
        nextPosition: position,
        seed: key.char,
      }
    case 'ArrowUp':
    case 'ArrowDown': // перемещение по кандидатам combobox
      return stay('EDIT', position, 'LIST_MOVE')
    case 'ArrowLeft':
    case 'ArrowRight': // текстовый курсор внутри combobox — грамматике безразлично
      return stay('EDIT', position, 'NOOP')
    default: {
      const never: never = key
      void never
      return stay('EDIT', position, 'NOOP')
    }
  }
}

function periodEdit({
  position,
  bounds,
  key,
}: TransitionInput): TransitionResult {
  switch (key.type) {
    case 'Enter':
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 1, 0),
      }
    case 'Tab':
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, 1),
      }
    case 'ShiftTab':
      return {
        action: 'COMMIT',
        nextState: 'NAVIGATE',
        nextPosition: move(position, bounds, 0, -1),
      }
    case 'Esc':
      return {
        action: 'RESTORE_PRE_EDIT',
        nextState: 'NAVIGATE',
        nextPosition: position,
      }
    case 'Char':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': // ввод даты обслуживает редактор периода (9.4)
      return stay('PERIOD_EDIT', position, 'NOOP')
    default: {
      const never: never = key
      void never
      return stay('PERIOD_EDIT', position, 'NOOP')
    }
  }
}

function conflict({ position, key }: TransitionInput): TransitionResult {
  // В CONFLICT грид заморожен под диалогом; фокус после закрытия — в исходную
  // ячейку (§3.2). ВХОД в CONFLICT задаёт грид по ответу бэкенда (409), не
  // грамматика (Д3 — она не знает 409/422).
  switch (key.type) {
    case 'Enter': // «Подтвердить оверрайд» → ретрай override:true
      return {
        action: 'OVERRIDE_RETRY',
        nextState: 'NAVIGATE',
        nextPosition: position,
      }
    case 'Esc': // «Отмена» → закрыть, значение не сохранено
      return {
        action: 'CLOSE_DIALOG',
        nextState: 'NAVIGATE',
        nextPosition: position,
      }
    case 'Tab':
    case 'ShiftTab':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Char': // диалог захватывает остальные клавиши
      return stay('CONFLICT', position, 'NOOP')
    default: {
      const never: never = key
      void never
      return stay('CONFLICT', position, 'NOOP')
    }
  }
}
