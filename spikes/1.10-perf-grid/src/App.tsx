import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  exportJson,
  markKeydown,
  perf,
  recordCommitLatency,
  recordCommitTick,
  snapshot,
  startHudLoop,
} from './perf'

// ── Параметры прототипа ──────────────────────────────────────────────
// ~1000 строк × 6 колонок статики (AC-1). Числа правятся слепым вводом.
const ROW_COUNT = 1000
const COL_COUNT = 6
const ROW_HEIGHT = 28
const OVERSCAN = 8

// Данные — string[][] (НЕ object-spread на 6000 ключей).
// Иммутабельная правка ячейки = shallow-copy O(строк), без копирования ячеек.
// ВАЖНО для FF~100: НЕ используем Array.prototype.with() (FF115+) — только slice/индекс.
function makeInitialData(): string[][] {
  const rows: string[][] = []
  for (let r = 0; r < ROW_COUNT; r++) {
    const row: string[] = []
    for (let c = 0; c < COL_COUNT; c++) row.push(`r${r}·c${c}`)
    rows.push(row)
  }
  return rows
}

type Active = { row: number; col: number }

function Grid() {
  const [rows, setRows] = useState<string[][]>(makeInitialData)
  const [active, setActive] = useState<Active>({ row: 0, col: 0 })

  const scrollRef = useRef<HTMLDivElement>(null)
  // снимок значения активной ячейки ДО правки — для отката по Esc
  const preEditRef = useRef<{ row: number; col: number; value: string }>({
    row: 0,
    col: 0,
    value: rows[0][0],
  })

  const rowVirtualizer = useVirtualizer({
    count: ROW_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  // фокус на контейнер, чтобы принимать клавиатуру без клика мышью (слепой ввод)
  useEffect(() => {
    scrollRef.current?.focus()
  }, [])

  // pre-edit снимок при смене активной ячейки (для Esc)
  // useLayoutEffect (НЕ useEffect): scrollToIndex выполняется ДО paint в окне коммита keystroke —
  // (а) активная строка не теряет кадр видимости при слепом вводе «вниз»; (б) каскадный коммит
  // виртуализатора учитывается в commits-per-key текущего keystroke, а не «утекает» после paint
  // мимо детектора (ревью 1.10 пр.1, D1).
  useLayoutEffect(() => {
    preEditRef.current = {
      row: active.row,
      col: active.col,
      value: rows[active.row][active.col],
    }
    // держим активную строку в зоне видимости (иначе слепой ввод «вниз» уведёт её из DOM)
    rowVirtualizer.scrollToIndex(active.row, { align: 'auto' })
    // намеренно зависим только от координат: снимок берём в момент входа в ячейку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.row, active.col])

  // useLayoutEffect без deps — выполняется после КАЖДОГО коммита (синхронно, до paint).
  // Порядок: сначала тик (считаем коммит, работает в проде), потом латентность (читает счётчик).
  useLayoutEffect(() => {
    recordCommitTick()
    recordCommitLatency()
  })

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const t0 = performance.now()
      const key = e.key
      let handled = true

      if (key === 'Enter') {
        e.preventDefault()
        setActive((a) => ({ row: Math.min(ROW_COUNT - 1, a.row + 1), col: a.col }))
      } else if (key === 'Tab') {
        e.preventDefault()
        setActive((a) => {
          const nextCol = a.col + 1
          if (nextCol < COL_COUNT) return { row: a.row, col: nextCol }
          return { row: Math.min(ROW_COUNT - 1, a.row + 1), col: 0 }
        })
      } else if (key === 'Escape') {
        e.preventDefault()
        const pe = preEditRef.current
        setRows((prev) => {
          const next = prev.slice()
          const row = next[pe.row].slice()
          row[pe.col] = pe.value
          next[pe.row] = row
          return next
        })
      } else if (key === 'Backspace') {
        e.preventDefault()
        setRows((prev) => {
          const next = prev.slice()
          const row = next[active.row].slice()
          row[active.col] = row[active.col].slice(0, -1)
          next[active.row] = row
          return next
        })
      } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // печатаемый символ — слепой ввод в активную ячейку
        e.preventDefault()
        setRows((prev) => {
          const next = prev.slice()
          const row = next[active.row].slice()
          row[active.col] = row[active.col] + key
          next[active.row] = row
          return next
        })
      } else {
        handled = false
      }

      // помечаем keydown ТОЛЬКО для обработанных клавиш (иначе latency «повиснет» на pendingTs)
      if (handled) markKeydown(t0)
    },
    [active.row, active.col],
  )

  const virtualRows = rowVirtualizer.getVirtualItems()

  return (
    <div
      ref={scrollRef}
      className="grid-scroll"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="перф-грид спайка 1.10"
    >
      {/* высота-распорка под все строки; видимые строки позиционируются абсолютно */}
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualRows.map((vi) => (
          <div
            key={vi.key}
            data-grid-row
            className="grid-row"
            // inline-стиль — РАЗРЕШЁННОЕ исключение: рантайм-значения виртуализации (architecture.md:241)
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${vi.size}px`,
              transform: `translateY(${vi.start}px)`,
            }}
          >
            <div className="grid-cell grid-cell--idx">{vi.index}</div>
            {rows[vi.index].map((value, c) => {
              const isActive = active.row === vi.index && active.col === c
              return (
                <div key={c} className={isActive ? 'grid-cell grid-cell--active' : 'grid-cell'}>
                  {value}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export function App() {
  useEffect(() => {
    // TTI: момент, когда страница смонтирована и готова к вводу (performance.now() ≈ от navigation start)
    perf.tti = performance.now()
    startHudLoop()
    // хук для консоли / headless-смоука: __vapsPerf.exportJson() / .snapshot()
    ;(window as unknown as { __vapsPerf: unknown }).__vapsPerf = { exportJson, snapshot, perf }
  }, [])

  // NB: НЕ оборачиваем в <Profiler>. Его onRender — но-оп в прод-сборке react-dom (находка спайка).
  // Коммиты считаются через useLayoutEffect-тик внутри <Grid>, что работает и на проде.
  return <Grid />
}
