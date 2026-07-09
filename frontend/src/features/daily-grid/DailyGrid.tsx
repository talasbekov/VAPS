// Story 9.4 — грид слепого ввода на TanStack Virtual, подключающий ЧИСТУЮ
// грамматику 9.2 (transition) к DOM. Грамматика — единственный источник
// переходов клавиш; грид применяет action к фокусу/правке и ХРАНИТ значения
// ячеек (грамматика значений не хранит). Границы: конфликт-маркеры = 9.6,
// prefill+отправка-дельт = 9.7, глубокий фокус-RTL = 9.5.
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { Card } from '../../shared/ui/Card'
import { transition } from './grammar'
import type { Bounds, CellState, ColumnKind, Key } from './grammar.types'
import type {
  DailyGridProps,
  EmployeeRow,
  RowChange,
  StatusOption,
  ValueAction,
  ValueState,
} from './DailyGrid.types'

// §2 контракта: ФИО(readonly) · Статус · Период · флаг.
const COLUMN_KINDS: readonly ColumnKind[] = [
  'readonly',
  'status',
  'period',
  'flag',
]
const STATUS_COL = 1
const ROW_HEIGHT = 36
const OVERSCAN = 8

interface Focus {
  row: number
  col: number
  mode: CellState
}

function valueReducer(state: ValueState, action: ValueAction): ValueState {
  const prev = state[action.id]
  if (!prev) return state
  if (action.type === 'SET_STATUS') {
    if (prev.statusCode === action.statusCode) return state
    return { ...state, [action.id]: { ...prev, statusCode: action.statusCode } }
  }
  if (prev.period === action.period) return state
  return { ...state, [action.id]: { ...prev, period: action.period } }
}

function initValues(rows: EmployeeRow[]): ValueState {
  const out: ValueState = {}
  for (const r of rows)
    out[r.id] = { statusCode: r.statusCode, period: r.period ?? '' }
  return out
}

/** Клавиатурное событие → грамматический Key (или null — игнорируем). */
function toKey(e: React.KeyboardEvent): Key | null {
  switch (e.key) {
    case 'Enter':
      return { type: 'Enter' }
    case 'Tab':
      return e.shiftKey ? { type: 'ShiftTab' } : { type: 'Tab' }
    case 'Escape':
      return { type: 'Esc' }
    case 'ArrowUp':
      return { type: 'ArrowUp' }
    case 'ArrowDown':
      return { type: 'ArrowDown' }
    case 'ArrowLeft':
      return { type: 'ArrowLeft' }
    case 'ArrowRight':
      return { type: 'ArrowRight' }
    default:
      // Одиночный печатный символ (не Ctrl/Alt/Meta) → type-ahead.
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)
        return { type: 'Char', char: e.key }
      return null
  }
}

// Действия грамматики, которыми управляет ГРИД (перехватываем клавишу).
const GRID_ACTIONS = new Set([
  'MOVE',
  'COMMIT',
  'OPEN_EDIT',
  'OPEN_PERIOD',
  'TYPE_AHEAD',
  'RESTORE_PRE_EDIT',
  'OVERRIDE_RETRY',
  'CLOSE_DIALOG',
])

interface GridRowProps {
  row: EmployeeRow
  value: { statusCode: string; period: string }
  dirty: boolean
  focusedCol: number | null
  mode: CellState
  statusOptions: StatusOption[]
  onStatus: (id: string, code: string) => void
  onPeriod: (id: string, period: string) => void
}

// Фокусная ячейка помечается data-active; DOM-фокус наводит layout-эффект грида
// через querySelector (без ref-в-рендере — react-hooks/refs).
const ACTIVE = { 'data-active': '' } as const

const GridRow = memo(function GridRow({
  row,
  value,
  dirty,
  focusedCol,
  mode,
  statusOptions,
  onStatus,
  onPeriod,
}: GridRowProps) {
  const label =
    statusOptions.find((o) => o.code === value.statusCode)?.label ??
    value.statusCode

  return (
    <div
      data-grid-row
      role="row"
      className={`flex items-stretch border-b text-sm ${dirty ? 'font-medium' : ''}`}
    >
      <span role="cell" className="w-64 truncate px-2 py-1">
        {row.fullName}
      </span>
      <span role="cell" className="w-48 px-1 py-1">
        {focusedCol === STATUS_COL && mode === 'EDIT' ? (
          <select
            aria-label="Статус"
            {...ACTIVE}
            value={value.statusCode}
            onChange={(e) => onStatus(row.id, e.target.value)}
            className="w-full rounded bg-muted px-1"
          >
            {statusOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            {...(focusedCol === STATUS_COL ? ACTIVE : {})}
            tabIndex={focusedCol === STATUS_COL ? 0 : -1}
            className="w-full rounded bg-muted px-1 text-left"
          >
            {label}
          </button>
        )}
      </span>
      <span role="cell" className="w-40 px-1 py-1">
        {focusedCol === 2 && mode === 'PERIOD_EDIT' ? (
          <input
            aria-label="Период"
            {...ACTIVE}
            value={value.period}
            onChange={(e) => onPeriod(row.id, e.target.value)}
            className="w-full rounded bg-muted px-1"
          />
        ) : (
          <button
            type="button"
            {...(focusedCol === 2 ? ACTIVE : {})}
            tabIndex={focusedCol === 2 ? 0 : -1}
            className="w-full px-1 text-left"
          >
            {value.period}
          </button>
        )}
      </span>
      <span role="cell" className="w-8 px-1 py-1 text-center" aria-hidden />
    </div>
  )
})

export function DailyGrid({
  rows,
  statusOptions,
  onSubmit,
  emptyLabel,
}: DailyGridProps) {
  const initials = useMemo(() => initValues(rows), [rows])
  const [values, dispatch] = useReducer(valueReducer, undefined, () =>
    initValues(rows),
  )
  const [focus, setFocus] = useState<Focus>({
    row: 0,
    col: STATUS_COL,
    mode: 'NAVIGATE',
  })

  const parentRef = useRef<HTMLDivElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const preEditRef = useRef<{
    id: string
    statusCode: string
    period: string
  } | null>(null)

  const bounds: Bounds = useMemo(
    () => ({
      rows: Math.max(rows.length, 1),
      cols: 4,
      columnKinds: COLUMN_KINDS,
    }),
    [rows.length],
  )

  // TanStack Virtual — канон ARCH-FE-246 (обязателен вместо AG Grid/Handsontable);
  // его API возвращает не-мемоизируемые функции → React Compiler пропускает
  // мемоизацию компонента (by-design). Перф-инвариант «1 commit/keystroke»
  // держится на ручном React.memo(GridRow) + стабильном dispatch, не на компайлере.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Стартовый rect до реального замера: в проде перемеряется фактической
    // высотой контейнера; без него среда без ResizeObserver (jsdom) держит
    // окно 0 и не рендерит строк.
    initialRect: { width: 800, height: 400 },
  })

  const onStatus = useCallback((id: string, code: string) => {
    dispatch({ type: 'SET_STATUS', id, statusCode: code })
  }, [])
  const onPeriod = useCallback((id: string, period: string) => {
    dispatch({ type: 'SET_PERIOD', id, period })
  }, [])

  const capturePreEdit = useCallback(() => {
    const row = rows[focus.row]
    if (!row) return
    const v = values[row.id]
    preEditRef.current = {
      id: row.id,
      statusCode: v.statusCode,
      period: v.period,
    }
  }, [rows, focus.row, values])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = toKey(e)
      if (!key || rows.length === 0) return
      const result = transition({
        state: focus.mode,
        position: { row: focus.row, col: focus.col },
        bounds,
        key,
      })
      if (!GRID_ACTIONS.has(result.action)) return // LIST_MOVE/NOOP → нативный контрол
      e.preventDefault()
      if (
        result.action === 'OPEN_EDIT' ||
        result.action === 'OPEN_PERIOD' ||
        result.action === 'TYPE_AHEAD'
      ) {
        capturePreEdit()
      }
      if (result.action === 'RESTORE_PRE_EDIT' && preEditRef.current) {
        const pe = preEditRef.current
        dispatch({ type: 'SET_STATUS', id: pe.id, statusCode: pe.statusCode })
        dispatch({ type: 'SET_PERIOD', id: pe.id, period: pe.period })
      }
      setFocus({
        row: result.nextPosition.row,
        col: result.nextPosition.col,
        mode: result.nextState,
      })
    },
    [rows.length, focus, bounds, capturePreEdit],
  )

  // Управляемый фокус: активная ячейка получает DOM-фокус; строка — в вид.
  useLayoutEffect(() => {
    if (rows.length === 0) {
      // Пустое подразделение: фокус в управляемом контейнере пустого состояния,
      // не на document.body (слепой ввод не должен терять точку опоры).
      emptyRef.current?.focus()
      return
    }
    virtualizer.scrollToIndex(focus.row)
    parentRef.current?.querySelector<HTMLElement>('[data-active]')?.focus()
  }, [focus, rows.length, virtualizer])

  const changed = useMemo(() => {
    const list: RowChange[] = []
    for (const r of rows) {
      const v = values[r.id]
      const init = initials[r.id]
      if (
        v &&
        init &&
        (v.statusCode !== init.statusCode || v.period !== init.period)
      )
        list.push({ id: r.id, statusCode: v.statusCode, period: v.period })
    }
    return list
  }, [rows, values, initials])

  const items = virtualizer.getVirtualItems()

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span
          data-testid="changed-counter"
          className="text-sm text-muted-foreground"
        >
          Изменено {changed.length} из {rows.length}
        </span>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
          onClick={() => onSubmit(changed)}
        >
          Сдать день
        </button>
      </div>

      {rows.length === 0 ? (
        <div
          ref={emptyRef}
          data-testid="grid-empty"
          role="status"
          tabIndex={0}
          className="py-8 text-center text-muted-foreground"
        >
          {emptyLabel ?? 'Личный состав не загружен'}
        </div>
      ) : (
        <div
          ref={parentRef}
          role="grid"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="h-96 overflow-auto outline-none"
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {items.map((item) => {
              const row = rows[item.index]
              const v = values[row.id]
              const init = initials[row.id]
              const dirty =
                !!v &&
                !!init &&
                (v.statusCode !== init.statusCode || v.period !== init.period)
              return (
                <div
                  key={row.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <GridRow
                    row={row}
                    value={v}
                    dirty={dirty}
                    focusedCol={item.index === focus.row ? focus.col : null}
                    mode={focus.mode}
                    statusOptions={statusOptions}
                    onStatus={onStatus}
                    onPeriod={onPeriod}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
