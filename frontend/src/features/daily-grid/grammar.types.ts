// Story 9.2 — типы клавиатурной грамматики грида слепого ввода.
// Источник истины: docs/contracts/09-01-экран-1-массовый-грид.md §3.
// Чистые типы — ноль рантайма, ноль React/DOM.

/** §3.1 — состояния конечного автомата. */
export type CellState = 'NAVIGATE' | 'EDIT' | 'PERIOD_EDIT' | 'CONFLICT'

/** Класс нажатой клавиши (дискриминированный union; `Char` несёт символ). */
export type Key =
  | { type: 'Enter' }
  | { type: 'Tab' }
  | { type: 'ShiftTab' }
  | { type: 'Esc' }
  | { type: 'ArrowUp' }
  | { type: 'ArrowDown' }
  | { type: 'ArrowLeft' }
  | { type: 'ArrowRight' }
  | { type: 'Char'; char: string }

/** Все классы клавиш — для guard-теста полноты (9.2 AC-3). */
export const KEY_TYPES = [
  'Enter',
  'Tab',
  'ShiftTab',
  'Esc',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Char',
] as const

export const CELL_STATES = [
  'NAVIGATE',
  'EDIT',
  'PERIOD_EDIT',
  'CONFLICT',
] as const

/** Вид колонки — из §2 контракта (ФИО=readonly · Статус · Период · флаг). */
export type ColumnKind = 'readonly' | 'status' | 'period' | 'flag'

export interface Position {
  row: number
  col: number
}

/** Форма грида: размеры + вид каждой колонки (индекс = col). */
export interface Bounds {
  rows: number
  cols: number
  columnKinds: readonly ColumnKind[]
}

/**
 * Эффект перехода. Направление коммита/движения закодировано в
 * `nextPosition`, а не в имени действия (одно `COMMIT`/`MOVE` на все стороны).
 */
export type Action =
  | 'OPEN_EDIT' // открыть правку статуса (combobox)
  | 'OPEN_PERIOD' // открыть правку периода
  | 'TYPE_AHEAD' // ввод символа в открытый combobox (seed в результате)
  | 'LIST_MOVE' // ↑/↓ по кандидатам combobox (без смены позиции грида)
  | 'COMMIT' // подтвердить правку; фокус → nextPosition
  | 'RESTORE_PRE_EDIT' // Esc: вернуть pre-edit значение (применит грид, 9.4)
  | 'MOVE' // навигация фокуса без правки; фокус → nextPosition
  | 'OVERRIDE_RETRY' // из диалога 409: ретрай с override:true
  | 'CLOSE_DIALOG' // закрыть диалог конфликта, значение не сохранено
  | 'NOOP' // нет эффекта (напр. Enter на readonly)

export interface TransitionInput {
  state: CellState
  position: Position
  bounds: Bounds
  key: Key
}

export interface TransitionResult {
  action: Action
  nextState: CellState
  nextPosition: Position
  /** Символ, засеявший type-ahead (только для TYPE_AHEAD из NAVIGATE). */
  seed?: string
}
