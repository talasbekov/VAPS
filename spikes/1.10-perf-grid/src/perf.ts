// Внутристраничная инструментация замера (спайк 1.10).
//
// ПОЧЕМУ ВНУТРИ СТРАНИЦЫ: Playwright на Firefox 100 невозможен (патченые сборки,
// architecture.md:258). Поэтому числа снимаются в самой странице и выводятся на HUD,
// откуда исполнитель замера списывает их глазами на целевой машине.
//
// HUD обновляется ИМПЕРАТИВНО через requestAnimationFrame, БЕЗ React-стейта —
// иначе обновление HUD плодило бы лишние коммиты и ломало инвариант «1 коммит / keystroke».

type PerfState = {
  /** число обработанных нажатий (печатный символ / Enter / Tab / Esc / Backspace) */
  keystrokes: number
  /** метка performance.now() последнего keydown; null — ждём следующего */
  pendingTs: number | null
  /** всего коммитов грида (через Profiler onRender) */
  commitsTotal: number
  /** коммитов с момента последнего keydown */
  commitsSinceKeydown: number
  /** коммитов на ПОСЛЕДНИЙ обработанный keystroke (инвариант = 1) */
  lastCommitsPerKey: number
  /** максимум коммитов на keystroke за прогон (>1 = красный флаг бюджета) */
  maxCommitsPerKey: number
  /** выборка задержек keydown→commit, мс */
  samples: number[]
  /** Time To Interactive: performance.now() в момент монтирования App, мс */
  tti: number | null
  /** CSS-селектор строк грида для подсчёта DOM-узлов */
  domRowSelector: string
}

export const perf: PerfState = {
  keystrokes: 0,
  pendingTs: null,
  commitsTotal: 0,
  commitsSinceKeydown: 0,
  lastCommitsPerKey: 0,
  maxCommitsPerKey: 0,
  samples: [],
  tti: null,
  domRowSelector: '[data-grid-row]',
}

/** вызывается из обработчика keydown ДО setState; t0 — метка времени нажатия */
export function markKeydown(t0: number): void {
  perf.keystrokes += 1
  perf.pendingTs = t0
  perf.commitsSinceKeydown = 0
}

/**
 * Тик коммита. Вызывается из useLayoutEffect БЕЗ deps (выполняется после каждого коммита поддерева).
 *
 * НАХОДКА СПАЙКА: <Profiler onRender> — НО-ОП в стандартной ПРОД-сборке react-dom
 * (нужна profiling-сборка). Поэтому на проде коммиты считаем через useLayoutEffect-тик,
 * а не через Profiler. Profiler-инварианты 9.8 живут в gate-окружении (Vitest/dev), где Profiler работает.
 */
export function recordCommitTick(): void {
  perf.commitsTotal += 1
  perf.commitsSinceKeydown += 1
}

/** вызывается из того же useLayoutEffect ПОСЛЕ тика — фиксирует задержку keydown→commit */
export function recordCommitLatency(): void {
  if (perf.pendingTs != null) {
    const dt = performance.now() - perf.pendingTs
    perf.samples.push(dt)
    perf.lastCommitsPerKey = perf.commitsSinceKeydown
    if (perf.commitsSinceKeydown > perf.maxCommitsPerKey) {
      perf.maxCommitsPerKey = perf.commitsSinceKeydown
    }
    perf.pendingTs = null
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))
  return sorted[idx]
}

export function stats(): { p50: number; p95: number; max: number; n: number } {
  const sorted = perf.samples.slice().sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    n: sorted.length,
  }
}

export function domRowCount(): number {
  return document.querySelectorAll(perf.domRowSelector).length
}

/** снимок результатов для ручного списывания / экспорта */
export function snapshot() {
  const s = stats()
  return {
    keystrokes: perf.keystrokes,
    tti_ms: perf.tti,
    p50_keydown_commit_ms: Number(s.p50.toFixed(2)),
    p95_keydown_commit_ms: Number(s.p95.toFixed(2)),
    max_keydown_commit_ms: Number(s.max.toFixed(2)),
    samples_n: s.n,
    last_commits_per_key: perf.lastCommitsPerKey,
    max_commits_per_key: perf.maxCommitsPerKey,
    commits_total: perf.commitsTotal,
    dom_rows_in_grid: domRowCount(),
    note_memory: 'память вкладки: снять вручную из Firefox about:processes / about:memory',
  }
}

export function exportJson(): string {
  return JSON.stringify(snapshot(), null, 2)
}

function renderHud(): void {
  const el = document.getElementById('hud')
  if (!el) return
  const s = stats()
  el.textContent =
    `VAPS спайк 1.10 — перф-грид (FF~100, 4ГБ)\n` +
    `─────────────────────────────\n` +
    `keystrokes:            ${perf.keystrokes} / цель 100\n` +
    `TTI:                   ${perf.tti != null ? perf.tti.toFixed(0) + ' ms' : '—'}\n` +
    `p50 keydown→commit:    ${s.p50.toFixed(1)} ms\n` +
    `p95 keydown→commit:    ${s.p95.toFixed(1)} ms  (n=${s.n})\n` +
    `max keydown→commit:    ${s.max.toFixed(1)} ms\n` +
    `commits / last key:    ${perf.lastCommitsPerKey}   (инвариант = 1)\n` +
    `max commits / key:     ${perf.maxCommitsPerKey}   (>1 = красный флаг)\n` +
    `DOM-строк в гриде:     ${domRowCount()}   (инвариант ≪ 1000)\n` +
    `─────────────────────────────\n` +
    `память вкладки → Firefox about:processes (снять вручную)\n` +
    `консоль: __vapsPerf.exportJson()`
}

/** запускает rAF-цикл обновления HUD (вне React) */
export function startHudLoop(): void {
  const tick = (): void => {
    renderHud()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
