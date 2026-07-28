// Story 9.4 — грид слепого ввода на TanStack Virtual, подключающий ЧИСТУЮ
// грамматику 9.2 (transition) к DOM. Грамматика — единственный источник
// переходов клавиш; грид применяет action к фокусу/правке и ХРАНИТ значения
// ячеек (грамматика значений не хранит). Границы: конфликт-маркеры = 9.6,
// prefill+отправка-дельт = 9.7, глубокий фокус-RTL = 9.5.
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { z } from 'zod'

import { ConflictError } from '../../shared/api/errors'
import { Card } from '../../shared/ui/Card'
import { ConflictDialog } from '../../shared/ui/ConflictDialog'
import { transition } from './grammar'
import type { Bounds, CellState, ColumnKind, Key } from './grammar.types'
import type {
  DailyGridProps,
  EmployeeRow,
  RowChange,
  RowMarker,
  StatusOption,
  ValueAction,
  ValueState,
} from './DailyGrid.types'

// zod-схема строки (9.6, Д1): statusCode обязателен непустой. Полная валидация
// периода/дат — при реальном date-редакторе.
const rowSchema = z.object({
  statusCode: z.string().min(1),
  period: z.string(),
})

// §2 контракта: ФИО(readonly) · Статус · Период · флаг.
const COLUMN_KINDS: readonly ColumnKind[] = [
  'readonly',
  'status',
  'period',
  'flag',
]
const NAME_COL = 0
const STATUS_COL = 1
const PERIOD_COL = 2
const FLAG_COL = 3
const ROW_HEIGHT = 36
const OVERSCAN = 8

interface Focus {
  row: number
  col: number
  mode: CellState
}

function valueReducer(state: ValueState, action: ValueAction): ValueState {
  if (action.type === 'RESYNC') {
    // Смена состава rows: правки оператора живут, остальное — новый initial.
    const next: ValueState = {}
    for (const id of Object.keys(action.initials)) {
      const current = state[id]
      const before = action.prevInitials[id]
      const edited =
        current &&
        before &&
        (current.statusCode !== before.statusCode ||
          current.period !== before.period)
      next[id] = edited ? current : action.initials[id]
    }
    return next
  }
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
  marker?: RowMarker
  rowIndex: number
  onStatus: (id: string, code: string) => void
  onPeriod: (id: string, period: string) => void
  /** DOM-фокус пришёл в ячейку мимо клавиатуры (клик мышью) — синк стейта. */
  onCellFocus: (row: number, col: number) => void
}

// Фокусная ячейка помечается data-active; DOM-фокус наводит layout-эффект грида
// через querySelector (без ref-в-рендере — react-hooks/refs).
const ACTIVE = { 'data-active': '' } as const

// Слой конфликтов ПОВЕРХ статус-цвета (§5/DESIGN): soft=жёлтый, hard/invalid=
// красная заливка (не статус-цвет).
const MARKER_ROW: Record<RowMarker, string> = {
  soft: 'bg-amber-50',
  hard: 'bg-red-50',
  invalid: 'bg-red-50',
}

const GridRow = memo(function GridRow({
  row,
  value,
  dirty,
  focusedCol,
  mode,
  statusOptions,
  marker,
  rowIndex,
  onStatus,
  onPeriod,
  onCellFocus,
}: GridRowProps) {
  const label =
    statusOptions.find((o) => o.code === value.statusCode)?.label ??
    value.statusCode

  return (
    <div
      data-grid-row
      data-marker={marker ?? undefined}
      role="row"
      aria-rowindex={rowIndex + 1}
      className={`flex items-stretch border-b text-sm ${dirty ? 'font-medium' : ''} ${marker ? MARKER_ROW[marker] : ''}`}
    >
      <span role="gridcell" className="w-64 px-1 py-1">
        <button
          type="button"
          {...(focusedCol === NAME_COL ? ACTIVE : {})}
          tabIndex={focusedCol === NAME_COL ? 0 : -1}
          onFocus={() => onCellFocus(rowIndex, NAME_COL)}
          className="w-full truncate px-1 text-left"
        >
          {row.fullName}
        </button>
      </span>
      <span role="gridcell" className="w-48 px-1 py-1">
        {focusedCol === STATUS_COL && mode === 'EDIT' ? (
          <select
            aria-label="Статус"
            {...ACTIVE}
            value={value.statusCode}
            onChange={(e) => onStatus(row.id, e.target.value)}
            onFocus={() => onCellFocus(rowIndex, STATUS_COL)}
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
            onFocus={() => onCellFocus(rowIndex, STATUS_COL)}
            className="w-full rounded bg-muted px-1 text-left"
          >
            {label}
          </button>
        )}
      </span>
      <span role="gridcell" className="w-40 px-1 py-1">
        {focusedCol === PERIOD_COL && mode === 'PERIOD_EDIT' ? (
          <input
            aria-label="Период"
            {...ACTIVE}
            value={value.period}
            onChange={(e) => onPeriod(row.id, e.target.value)}
            onFocus={() => onCellFocus(rowIndex, PERIOD_COL)}
            className="w-full rounded bg-muted px-1"
          />
        ) : (
          <button
            type="button"
            {...(focusedCol === PERIOD_COL ? ACTIVE : {})}
            tabIndex={focusedCol === PERIOD_COL ? 0 : -1}
            onFocus={() => onCellFocus(rowIndex, PERIOD_COL)}
            className="w-full px-1 text-left"
          >
            {value.period}
          </button>
        )}
      </span>
      <span role="gridcell" className="w-8 px-1 py-1 text-center">
        <button
          type="button"
          aria-label={
            marker === 'soft'
              ? 'Предупреждение'
              : marker === 'invalid'
                ? 'Ошибка заполнения'
                : marker
                  ? 'Конфликт'
                  : 'Флаг'
          }
          {...(focusedCol === FLAG_COL ? ACTIVE : {})}
          tabIndex={focusedCol === FLAG_COL ? 0 : -1}
          onFocus={() => onCellFocus(rowIndex, FLAG_COL)}
          className={`w-full font-bold ${marker === 'soft' ? 'text-amber-600' : marker ? 'text-red-600' : ''}`}
        >
          {marker === 'soft' ? '!' : marker ? '×' : ''}
        </button>
      </span>
    </div>
  )
})

export function DailyGrid({
  rows,
  statusOptions,
  onSubmit,
  emptyLabel,
  onCellCommit,
  onDirtyChange,
  // Дефолт = прежняя канон-строка ⇒ тесты E9, рендерящие грид напрямую,
  // остаются зелёными без единой правки (доказательство аддитивности, AC-12).
  submitLabel = 'Сдать день',
  serverMarkers,
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
  // Конфликт захватывает id строки НА МОМЕНТ коммита (ревью 9.5): пока диалог
  // открыт, rows может обновиться — снятие маркера по rows[focus.row] попало бы
  // в чужую строку.
  const [conflict, setConflict] = useState<{
    error: ConflictError
    rowId: string
  } | null>(null)
  const [markers, setMarkers] = useState<Record<string, RowMarker>>({})
  // aria-live анонс блокировок (ревью 9.6): hard/invalid раньше молчали —
  // слепой оператор не получал НИКАКОГО сигнала, что Enter не сработал.
  const [announce, setAnnounce] = useState('')

  const setMarker = useCallback((id: string, m: RowMarker) => {
    setMarkers((prev) => (prev[id] === m ? prev : { ...prev, [id]: m }))
  }, [])
  const clearMarker = useCallback((id: string) => {
    setMarkers((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // Ref-зеркало focus для onCellFocus: синк-эффект объявлен ДО эффекта
  // управляемого фокуса → к моменту focusin зеркало уже свежее.
  const focusRef = useRef(focus)
  useLayoutEffect(() => {
    focusRef.current = focus
  }, [focus])

  const parentRef = useRef<HTMLDivElement>(null)
  const emptyRef = useRef<HTMLDivElement>(null)
  const preEditRef = useRef<{
    id: string
    statusCode: string
    period: string
  } | null>(null)

  // Самоисцеление при смене rows-пропа (refetch/фильтр — источник 9.7/10.2):
  // (1) values-ресинк — новые id получают значения, правки живут; (2) кламп
  // устаревшего фокуса — без него сжатие rows роняет COMMIT-путь и рендер.
  const prevInitialsRef = useRef(initials)
  useLayoutEffect(() => {
    if (prevInitialsRef.current === initials) return
    dispatch({
      type: 'RESYNC',
      initials,
      prevInitials: prevInitialsRef.current,
    })
    // Маркеры: прунинг исчезнувших строк (ревью 9.5) + сброс у строк, чей
    // initial обновил сервер (ревью 9.6 — маркер вычисленный по старым данным
    // устарел; с гейтом «Сдать день» стейл-маркер блокировал бы отправку).
    const prevInit = prevInitialsRef.current
    setMarkers((prev) => {
      let changed = false
      const next: Record<string, RowMarker> = {}
      for (const id of Object.keys(prev)) {
        const cur = initials[id]
        const before = prevInit[id]
        const healed =
          cur &&
          before &&
          (cur.statusCode !== before.statusCode || cur.period !== before.period)
        if (!cur || healed) {
          changed = true
          continue
        }
        next[id] = prev[id]
      }
      return changed ? next : prev
    })
    prevInitialsRef.current = initials
  }, [initials])

  // Обратный канал bulk-ответа → маркеры (Story 10.2b). serverMarkers-проп —
  // ДРУГОЙ источник, но ТОТ ЖЕ markers-стейт (не параллельный). Оператор,
  // отредактировавший строку заново, естественно перезаписывает запись
  // validateAndMark'ом того коммита — специальной логики снятия «руками» не
  // нужно (AC-2).
  //
  // Ревью-фикс (3 слоя ревью 10.2b независимо сошлись на одной находке):
  // per-id гейт СИММЕТРИЧЕН для прунинга И применения — трогаем маркер id
  // ТОЛЬКО если текущее живое значение всё ещё равно тому, что ПОСЛЕДНИЙ
  // серверный синк для этого id туда положил (`current === prevServer[id]`,
  // где `undefined` для id, никогда не бывшего серверным). Если оператор
  // локально сменил маркер этого id между двумя серверными синками —
  // серверный синк его НЕ трогает ни прунингом, ни переприменением, пока
  // сам id не пропадёт/появится заново со свежим значением из следующего
  // serverMarkers. Без симметрии применение (не только прунинг) могло бы
  // молча стереть локальную правку, если тот же id снова оказался бы в
  // НОВОМ (по ссылке), но content-идентичном serverMarkers — сегодня
  // недостижимо в проводке DailyUpdatePage (проп мемоизирован на
  // mutationError, меняется только на реальный новый submit), но контракт
  // компонента этого не гарантирует для будущих вызывающих.
  const prevServerMarkersRef = useRef<Record<string, RowMarker>>({})
  useLayoutEffect(() => {
    const next = serverMarkers ?? {}
    const prev = prevServerMarkersRef.current
    if (prev === next) return
    setMarkers((current) => {
      let changed = false
      const merged = { ...current }
      const touchedIds = new Set([...Object.keys(prev), ...Object.keys(next)])
      for (const id of touchedIds) {
        const prevServerValue = prev[id]
        const nextServerValue = next[id]
        if (merged[id] !== prevServerValue) continue // локальный маркер — не трогаем
        if (merged[id] === nextServerValue) continue
        if (nextServerValue === undefined) delete merged[id]
        else merged[id] = nextServerValue
        changed = true
      }
      return changed ? merged : current
    })
    prevServerMarkersRef.current = next
  }, [serverMarkers])

  useLayoutEffect(() => {
    setFocus((f) =>
      rows.length > 0 && f.row > rows.length - 1
        ? { row: rows.length - 1, col: f.col, mode: 'NAVIGATE' }
        : f,
    )
  }, [rows.length])

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
  // Сфокусированная строка ПРИНУДИТЕЛЬНО в окне виртуализации: иначе скролл
  // колёсиком демонтирует активную ячейку → DOM-фокус падает на body и
  // клавиатура грида мертва до клика (AC-6 «точка опоры слепого ввода»).
  const activeRow = Math.min(focus.row, rows.length - 1)
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeRow < 0 || indexes.includes(activeRow)) return indexes
      return [...indexes, activeRow].sort((a, b) => a - b)
    },
    [activeRow],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    rangeExtractor,
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
  // Валидация+seam одной строки — ОБЩИЙ путь клавиатурного COMMIT и
  // blur-коммита при уходе мышью (ревью 9.6). Выставляет/чистит маркеры и
  // aria-анонс; ConflictDialog открывает только интерактивный (клавиатурный)
  // вызов — blur-путь не воюет с кликом за фокус, soft остаётся маркером.
  const validateAndMark = useCallback(
    (rowIdx: number, interactive: boolean): 'ok' | 'soft' | 'blocked' => {
      const row = rows[rowIdx]
      const v = row ? (values[row.id] ?? initials[row.id]) : undefined
      if (!row || !v) return 'ok'
      const change: RowChange = {
        id: row.id,
        statusCode: v.statusCode,
        period: v.period,
      }
      // zod-невалид → invalid (блокирует, как hard).
      if (!rowSchema.safeParse(change).success) {
        setMarker(row.id, 'invalid')
        setAnnounce(
          `${row.fullName}: значение не прошло проверку — коммит заблокирован`,
        )
        return 'blocked'
      }
      const err = onCellCommit?.(change) ?? null
      if (err) {
        if (err instanceof ConflictError && err.overridable) {
          // soft (409 overridable): жёлтый маркер + ConflictDialog (9.5).
          setMarker(row.id, 'soft')
          if (interactive) setConflict({ error: err, rowId: row.id })
          setAnnounce(`${row.fullName}: мягкий конфликт — ${err.message}`)
          return 'soft'
        }
        // hard (422 / non-overridable): красная заливка, блок, без диалога.
        setMarker(row.id, 'hard')
        setAnnounce(`${row.fullName}: коммит заблокирован — ${err.message}`)
        return 'blocked'
      }
      clearMarker(row.id) // валидно, без конфликта
      return 'ok'
    },
    [rows, values, initials, onCellCommit, setMarker, clearMarker],
  )
  const validateAndMarkRef = useRef(validateAndMark)
  useLayoutEffect(() => {
    validateAndMarkRef.current = validateAndMark
  }, [validateAndMark])

  // Клик мышью фокусит ячейку мимо клавиатуры — стейт следует за DOM-фокусом,
  // иначе следующий Enter исполнится на ЧУЖОЙ строке (ревью 9.5). Программный
  // .focus() layout-эффекта попадает в уже-активную ячейку → same-ref, без
  // лишнего коммита (перф-инвариант 1 commit/keystroke не задет).
  const onCellFocus = useCallback((row: number, col: number) => {
    // Программный .focus() layout-эффекта приходит в уже-активную ячейку —
    // сравнение через ref-зеркало БЕЗ setState: setState из фазы коммита не
    // получает eager-bailout и дал бы лишний коммит (перф-инвариант).
    const f = focusRef.current
    if (f.row === row && f.col === col) return
    // Уход мышью из правки МИНОВАЛ клавиатурный COMMIT (регрессия ревью 9.5):
    // значение оставалось dirty без zod/seam, маркер лгал → blur-коммит.
    if (f.mode === 'EDIT' || f.mode === 'PERIOD_EDIT')
      validateAndMarkRef.current(f.row, false)
    setFocus({ row, col, mode: 'NAVIGATE' })
  }, [])

  const capturePreEdit = useCallback(() => {
    const row = rows[focus.row]
    if (!row) return
    const v = values[row.id] ?? initials[row.id]
    if (!v) return
    preEditRef.current = {
      id: row.id,
      statusCode: v.statusCode,
      period: v.period,
    }
  }, [rows, focus.row, values, initials])

  const overrideConflict = useCallback(() => {
    // «Подтвердить оверрайд»: снять soft-маркер (по захваченному rowId, не по
    // rows[focus.row] — строки могли сдвинуться), коммит принят, фокус в ячейку.
    if (conflict) clearMarker(conflict.rowId)
    setConflict(null)
    setFocus((f) => ({ row: f.row, col: f.col, mode: 'NAVIGATE' }))
  }, [conflict, clearMarker])

  const cancelConflict = useCallback(() => {
    // «Отмена»/Escape: §3.2 контракта — «значение НЕ сохранено» → откат к
    // pre-edit (иначе отвергнутое значение осталось бы dirty и уехало в
    // bulk-дельты 9.7); soft-маркер ОСТАЁТСЯ (предупреждение о конфликте).
    const pe = preEditRef.current
    if (conflict && pe && pe.id === conflict.rowId) {
      dispatch({ type: 'SET_STATUS', id: pe.id, statusCode: pe.statusCode })
      dispatch({ type: 'SET_PERIOD', id: pe.id, period: pe.period })
      preEditRef.current = null
    }
    setConflict(null)
    setFocus((f) => ({ row: f.row, col: f.col, mode: 'NAVIGATE' }))
  }, [conflict])

  // Синхронизация: conflict-стейт живёт ТОЛЬКО в режиме CONFLICT (ревью 9.5) —
  // любой обходной выход из режима (кламп при сжатии rows) не оставит стейла;
  // семантика такого выхода = «Отмена» (ревью 9.6): значение откатывается к
  // pre-edit, иначе отвергнутое уехало бы в bulk-дельты мимо cancelConflict.
  useLayoutEffect(() => {
    if (focus.mode !== 'CONFLICT' && conflict) {
      const pe = preEditRef.current
      if (pe && pe.id === conflict.rowId) {
        dispatch({ type: 'SET_STATUS', id: pe.id, statusCode: pe.statusCode })
        dispatch({ type: 'SET_PERIOD', id: pe.id, period: pe.period })
        preEditRef.current = null
      }
      setConflict(null)
    }
  }, [focus.mode, conflict])

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
      // CONFLICT-режим, клавиша добралась до грида (сбой focus-trap / полифилл-
      // окружение — defense-in-depth): Enter НЕ оверрайдит — это обход причины
      // 10–500 (BR-003) и аудита; клавиша гасится, оверрайд только кнопкой
      // диалога с валидной причиной (ревью 9.5). Esc = безопасная отмена.
      if (result.action === 'OVERRIDE_RETRY') return
      if (result.action === 'CLOSE_DIALOG') {
        cancelConflict()
        return
      }
      if (
        (result.action === 'OPEN_EDIT' ||
          result.action === 'OPEN_PERIOD' ||
          result.action === 'TYPE_AHEAD') &&
        focus.mode === 'NAVIGATE'
      ) {
        // Снапшот pre-edit — ТОЛЬКО на входе в правку из NAVIGATE: TYPE_AHEAD
        // внутри EDIT не перезатирает его, иначе Esc вернул бы промежуточное
        // значение вместо исходного (§3.3).
        capturePreEdit()
      }
      // Seed type-ahead (AC-3): набранный символ применяется — прыжок на первую
      // опцию с label по префиксу (нажатие не теряется, §3.3 инвариант 2).
      // Полноценная combobox-фильтрация — E10.
      if (result.action === 'TYPE_AHEAD' && result.seed) {
        const row = rows[focus.row]
        if (row) {
          const seed = result.seed.toLocaleLowerCase('ru')
          const match = statusOptions.find((o) =>
            o.label.toLocaleLowerCase('ru').startsWith(seed),
          )
          if (match)
            dispatch({ type: 'SET_STATUS', id: row.id, statusCode: match.code })
        }
      }
      if (result.action === 'RESTORE_PRE_EDIT' && preEditRef.current) {
        const pe = preEditRef.current
        dispatch({ type: 'SET_STATUS', id: pe.id, statusCode: pe.statusCode })
        dispatch({ type: 'SET_PERIOD', id: pe.id, period: pe.period })
        // Значение вернулось к pre-edit → invalid/hard-маркер устарел и с
        // гейтом «Сдать день» блокировал бы отправку призраком (ревью 9.6);
        // soft остаётся предупреждением (AC-3).
        setMarkers((prev) => {
          const m = prev[pe.id]
          if (!m || m === 'soft') return prev
          const next = { ...prev }
          delete next[pe.id]
          return next
        })
        preEditRef.current = null // снапшот одноразовый: чужой правке не достанется
      }
      // Коммит ячейки (9.6): zod-валидация → soft/hard-ветвление по ApiError
      // (общий validateAndMark — тот же путь у blur-коммита при уходе мышью).
      if (result.action === 'COMMIT') {
        const row = rows[focus.row]
        if (!row) {
          // Стейл-фокус (rows сжался в момент правки): цели коммита больше
          // нет — без записи, в исцелённую грамматикой позицию.
          setFocus({
            row: result.nextPosition.row,
            col: result.nextPosition.col,
            mode: 'NAVIGATE',
          })
          return
        }
        const verdict = validateAndMark(focus.row, true)
        if (verdict === 'soft') {
          setFocus({ row: focus.row, col: focus.col, mode: 'CONFLICT' })
          return
        }
        if (verdict === 'blocked') {
          setFocus({ row: focus.row, col: focus.col, mode: 'NAVIGATE' })
          return
        }
      }
      setFocus({
        row: result.nextPosition.row,
        col: result.nextPosition.col,
        mode: result.nextState,
      })
    },
    [
      rows,
      statusOptions,
      focus,
      bounds,
      capturePreEdit,
      cancelConflict,
      validateAndMark,
    ],
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

  // Канал грязного состояния экрану (10.2): читает УЖЕ посчитанное мемо
  // `changed` — новых ре-рендеров строк не вносит, перф-инвариант «1 commit на
  // нажатие» не трогает (проп не передан → эффект — no-op). Зависимость —
  // changed.length, а не changed: правка внутри одной и той же дельты грязного
  // состояния не меняет.
  useEffect(() => {
    onDirtyChange?.(changed.length)
  }, [changed.length, onDirtyChange])

  // Гейт отправки (ревью 9.6): hard/invalid-строки БЛОКИРУЮТ «Сдать день» —
  // иначе «коммит блокируется» держал бы только фокус, а отвергнутые бэком /
  // невалидные значения уезжали бы в bulk-дельты. soft не блокирует
  // (предупреждение; оверрайд снимает).
  const blockedCount = useMemo(
    () => Object.values(markers).filter((m) => m !== 'soft').length,
    [markers],
  )

  const items = virtualizer.getVirtualItems()

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span
          data-testid="changed-counter"
          className="text-sm text-muted-foreground"
        >
          Изменено {changed.length} из {rows.length}
          {blockedCount > 0 ? ` · заблокировано ${blockedCount}` : ''}
        </span>
        <button
          type="button"
          disabled={blockedCount > 0}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => onSubmit(changed)}
        >
          {submitLabel}
        </button>
      </div>
      {/* aria-live анонс блокировок/конфликтов — слепой ввод получает сигнал,
          что Enter НЕ перешёл дальше (ревью 9.6). */}
      <span role="status" aria-live="assertive" className="sr-only">
        {announce}
      </span>

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
          aria-rowcount={rows.length}
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
              // Фолбэк на initial: RESYNC-эффект догоняет values ПОСЛЕ первого
              // рендера нового состава rows — без фолбэка новый id падал бы.
              const v = values[row.id] ?? initials[row.id]
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
                    mode={item.index === focus.row ? focus.mode : 'NAVIGATE'}
                    statusOptions={statusOptions}
                    marker={markers[row.id]}
                    rowIndex={item.index}
                    onStatus={onStatus}
                    onPeriod={onPeriod}
                    onCellFocus={onCellFocus}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {focus.mode === 'CONFLICT' && (
        <ConflictDialog
          conflict={conflict?.error ?? null}
          onOverride={overrideConflict}
          onCancel={cancelConflict}
        />
      )}
    </Card>
  )
}
