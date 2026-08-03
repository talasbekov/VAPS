// @vitest-environment jsdom
// Story 10.4 — расписание опроса (AC-7) и переживание раскладки при перечитке
// (AC-5). Отдельным файлом: фейковые таймеры здесь обязательны, а в сюите
// экрана — вредны.
//
// ⚠️ Ловушка 10.3: `user-event` v14 + фейковые таймеры БЕЗ
// `shouldAdvanceTime: true` не «падают», а ВИСНУТ. Отладка дорогая — флаг
// стоит осознанно.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../../shared/api/testing/server'
import { TrafficLightTreePage, TRAFFIC_LIGHT_POLL_MS } from './TrafficLightTreePage'
import type { TrafficLightNode } from './trafficLight'

const TREE_PATH = '*/api/operations/traffic-light/tree/'

const SHTAB = '11111111-1111-4111-8111-111111111111'
const ROTA = '22222222-2222-4222-8222-222222222222'
const VZVOD = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setVisibility('visible')
})

/**
 * Подмена видимости вкладки — ЧЕСТНАЯ: `focusManager` react-query читает
 * `document.visibilityState` и слушает `visibilitychange` на window, поэтому
 * после подмены он реально переключается, а не «делает вид».
 *
 * ⚠️ `bubbles: true` обязателен: слушатель висит на window, а событие
 * отправляется в document — без всплытия оно до него не дойдёт, и тест
 * «фон не опрашивается» стал бы зелёным по неверной причине.
 *
 * Почему это здесь, а не в Playwright: спрятать страницу из Playwright нечем —
 * `bringToFront()` соседней вкладки в headless-контуре оставляет
 * `visibilityState === 'visible'` (проверено), CDP `Page.setWebLifecycleState`
 * знает только active/frozen. Там ассерт был бы вакуумным, здесь — нет.
 */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

function node(over: Partial<TrafficLightNode> & { division_id: string }): TrafficLightNode {
  return { name: 'Подразделение', parent_id: null, status: 'GREEN', late: false, ...over }
}

/** Счётчик ушедших GET: MSW видит РЕАЛЬНЫЕ запросы, а не намерения. */
function countingTree(nodes: TrafficLightNode[]) {
  const state = { calls: 0 }
  server.use(
    http.get(TREE_PATH, () => {
      state.calls += 1
      return HttpResponse.json({ business_date: '2026-07-19', nodes })
    }),
  )
  return state
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TrafficLightTreePage />
    </QueryClientProvider>,
  )
  return queryClient
}

describe('AC-7 — polling с отметкой свежести', () => {
  it('интервал — ЭКСПОРТИРУЕМАЯ константа (тест не хардкодит число)', () => {
    expect(typeof TRAFFIC_LIGHT_POLL_MS).toBe('number')
    expect(TRAFFIC_LIGHT_POLL_MS).toBeGreaterThan(0)
  })

  it('за каждый интервал уходит РОВНО один повторный GET', async () => {
    const state = countingTree([node({ division_id: SHTAB, name: 'Штаб' })])
    renderPage()

    await screen.findByText('Штаб')
    expect(state.calls).toBe(1)

    // Чуть меньше интервала — второго запроса ещё НЕТ. Без этой половины
    // ассерт «стало 2» проходил бы и при интервале вдвое короче.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS - 1000)
    })
    expect(state.calls).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(state.calls).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS)
    })
    expect(state.calls).toBe(3)
  })

  it('СКРЫТАЯ вкладка фоновый опрос НЕ ведёт (refetchIntervalInBackground выключен)', async () => {
    // Вторая половина AC-7, до сих пор не покрытая ничем: «Given вкладка
    // скрыта, Then фоновый опрос не идёт» — обоснование прямое, целевые 4 ГБ не
    // должны платить за картину, которую никто не смотрит. Мишень мутации:
    // включить `refetchIntervalInBackground: true` ⇒ счётчик уйдёт за 1.
    const state = countingTree([node({ division_id: SHTAB, name: 'Штаб' })])
    renderPage()

    await screen.findByText('Штаб')
    expect(state.calls).toBe(1)

    setVisibility('hidden')
    await act(async () => {
      // ДВА интервала: одиночный прыжок мог бы «не успеть» по краю таймера, и
      // зелёный ассерт означал бы не то, что нужно.
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS * 2)
    })
    expect(state.calls, 'фоновая вкладка ушла в сеть').toBe(1)

    // И контроль обратного хода: опрос возобновляется, когда вкладка вернулась.
    // Без этой половины тест был бы зелёным и на экране, который не опрашивает
    // ВООБЩЕ НИКОГДА.
    setVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS)
    })
    expect(state.calls).toBeGreaterThan(1)
  })

  it('подпись свежести появляется после первой загрузки', async () => {
    countingTree([node({ division_id: SHTAB, name: 'Штаб' })])
    renderPage()

    await screen.findByText('Штаб')
    expect(screen.getByText(/обновлено \d+ (с|мин) назад/)).toBeInTheDocument()
  })
})

describe('AC-5 — раскладка переживает перечитку', () => {
  it('раскрытая ветка НЕ схлопывается после polling-обновления', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    countingTree([
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB }),
      node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA }),
    ])
    renderPage()

    await screen.findByText('Первая рота')
    await user.click(screen.getByRole('button', { name: 'Раскрыть Первая рота' }))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS)
    })

    // Ветка жива: раскладка ключёвана division_id, а не индексом.
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()
  })

  it('раскладка переживает перечитку с ИЗМЕНИВШИМСЯ порядком узлов', async () => {
    // Мишень мутации №5: при индексном ключе перестановка схлопнула бы не ту
    // ветку. На стабильном порядке такой тест был бы вакуумен.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let call = 0
    const first = [
      node({ division_id: SHTAB, name: 'Штаб' }),
      node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB }),
      node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA }),
    ]
    server.use(
      http.get(TREE_PATH, () => {
        call += 1
        // Второй ответ: те же узлы, ПЕРЕВЁРНУТЫЙ порядок.
        return HttpResponse.json({
          business_date: '2026-07-19',
          nodes: call === 1 ? first : [...first].reverse(),
        })
      }),
    )
    renderPage()

    await screen.findByText('Первая рота')
    await user.click(screen.getByRole('button', { name: 'Раскрыть Первая рота' }))
    expect(screen.getByText('Взвод связи')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAFFIC_LIGHT_POLL_MS)
    })
    expect(call).toBeGreaterThan(1)

    expect(screen.getByText('Взвод связи')).toBeInTheDocument()
  })
})
