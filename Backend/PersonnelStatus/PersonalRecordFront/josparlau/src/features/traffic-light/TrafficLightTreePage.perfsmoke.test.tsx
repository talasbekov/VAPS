// @vitest-environment jsdom
// Story 10.4 — перф-смоук AC-4: БЛОКИРУЮЩИЕ детерминированные счётчики на 400
// подразделениях (целевая машина — 4 ГБ). Счётчики, а не тайминги
// (architecture.md §перф-инварианты; образец — DailyGrid.perfsmoke.test.tsx).
//
// AC-4 состоит из ДВУХ половин, и проверяются обе:
//   1. свёрнутые поддеревья НЕ смонтированы (DOM-бюджет);
//   2. раскрытие узла НЕ порождает сетевых запросов — данные пришли одним
//      ответом (ленив РЕНДЕР, не загрузка; изобретать N+1 запрещено, 5.5b
//      держит инвариант n1 == n5, n5 ≤ 6).
//
// ⚠️ БЕЗ фейковых таймеров и с фильтром ВЫКЛЮЧЕННЫМ (как требует AC-4).
// Счётчик запросов и refetchInterval конфликтуют: тест обязан отработать
// заведомо быстрее TRAFFIC_LIGHT_POLL_MS, иначе фоновый опрос сам
// инкрементит счётчик и ассерт станет флейком. 30 с против ~секунды — запас
// на два порядка, но зависимость названа явно.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '../../shared/api/testing/server'
import { TrafficLightTreePage, TRAFFIC_LIGHT_POLL_MS } from './TrafficLightTreePage'
import type { TrafficLightNode } from './trafficLight'

afterEach(() => cleanup())

const TREE_PATH = '*/api/operations/traffic-light/tree/'

/**
 * Ровно 400 узлов: корень + 19 рот × (1 + 20 взводов) = 1 + 19·21. Форма
 * реалистична для оргструктуры пилота — широкая и мелкая, а не цепочка
 * длиной 400 (цепочка не нагрузила бы механизм: у неё на каждом уровне один
 * ребёнок, и «не рендерить свёрнутое» экономило бы один узел).
 */
const ROOT_ID = 'r0000000-0000-4000-8000-000000000000'
const TOTAL_NODES = 400
const COMPANIES = 19
const PLATOONS = 20

function makeTree(): TrafficLightNode[] {
  const nodes: TrafficLightNode[] = [
    { division_id: ROOT_ID, name: 'Штаб бригады', parent_id: null, status: 'RED', late: false },
  ]
  for (let c = 0; c < COMPANIES; c++) {
    const companyId = `c${String(c).padStart(7, '0')}-0000-4000-8000-000000000000`
    nodes.push({
      division_id: companyId,
      name: `Рота ${c + 1}`,
      parent_id: ROOT_ID,
      status: 'RED',
      late: false,
    })
    for (let p = 0; p < PLATOONS; p++) {
      nodes.push({
        division_id: `p${String(c).padStart(3, '0')}${String(p).padStart(3, '0')}-0000-4000-8000-000000000000`,
        name: `Взвод ${c + 1}-${p + 1}`,
        parent_id: companyId,
        status: 'RED',
        late: false,
      })
    }
  }
  return nodes
}

/**
 * Бюджет при дефолтной раскладке: корень + 19 рот = 20 узлов. Люфт до 24 —
 * один случайно раскрытый лишний уровень даёт 40 и краснеет. «≪ 400» бюджетом
 * НЕ является: он пропустил бы 10× регрессию (урок ревью 9.8, где
 * унаследованное «60» прятало 3×).
 */
const DOM_BUDGET_COLLAPSED = 24
/** Раскрыта одна рота: 20 + её 20 взводов = 40; люфт до 44. */
const DOM_BUDGET_ONE_BRANCH = 44

function mountedCount(): number {
  return document.querySelectorAll('[data-traffic-node]').length
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TrafficLightTreePage />
    </QueryClientProvider>,
  )
}

describe('AC-4 — ленивый РЕНДЕР на 400 подразделениях', () => {
  it('свёрнутые поддеревья не смонтированы: DOM-бюджет держится', async () => {
    const nodes = makeTree()
    expect(nodes).toHaveLength(TOTAL_NODES) // фикстура действительно 400

    server.use(
      http.get(TREE_PATH, () => HttpResponse.json({ business_date: '2026-07-19', nodes })),
    )
    renderPage()

    await screen.findByText('Штаб бригады')

    const mounted = mountedCount()
    expect(mounted).toBeLessThanOrEqual(DOM_BUDGET_COLLAPSED)
    // Нижняя грань — санити: дерево действительно отрисовано, а не пусто.
    expect(mounted).toBeGreaterThanOrEqual(COMPANIES + 1)
    // Поимённо: рота видна, её взвод — нет.
    expect(screen.getByText('Рота 1')).toBeInTheDocument()
    expect(screen.queryByText('Взвод 1-1')).not.toBeInTheDocument()
  })

  it('раскрытие ветки НЕ шлёт ни одного нового запроса (данные — одним ответом)', async () => {
    const user = userEvent.setup()
    const nodes = makeTree()
    let calls = 0
    server.use(
      http.get(TREE_PATH, () => {
        calls += 1
        return HttpResponse.json({ business_date: '2026-07-19', nodes })
      }),
    )
    renderPage()

    await screen.findByText('Штаб бригады')
    expect(calls).toBe(1)

    const started = Date.now()
    await user.click(screen.getByRole('button', { name: 'Раскрыть Рота 1' }))
    expect(screen.getByText('Взвод 1-1')).toBeInTheDocument()

    // Раскрытие — чистый рендер: сеть не тронута (иначе это изобретённый N+1).
    expect(calls).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Раскрыть Рота 2' }))
    expect(screen.getByText('Взвод 2-1')).toBeInTheDocument()
    expect(calls).toBe(1)

    // Ассерт выше честен только если фоновый опрос не успел вмешаться.
    expect(Date.now() - started).toBeLessThan(TRAFFIC_LIGHT_POLL_MS)
  })

  it('раскрытие ОДНОЙ ветки добавляет только её детей, не всё дерево', async () => {
    const user = userEvent.setup()
    const nodes = makeTree()
    server.use(
      http.get(TREE_PATH, () => HttpResponse.json({ business_date: '2026-07-19', nodes })),
    )
    renderPage()

    await screen.findByText('Штаб бригады')
    await user.click(screen.getByRole('button', { name: 'Раскрыть Рота 1' }))

    const mounted = mountedCount()
    expect(mounted).toBeLessThanOrEqual(DOM_BUDGET_ONE_BRANCH)
    // Соседняя рота осталась свёрнутой — раскрытие не каскадит.
    expect(screen.queryByText('Взвод 2-1')).not.toBeInTheDocument()
  })

  it('сворачивание РАЗМОНТИРУЕТ поддерево (узлы не копятся)', async () => {
    const user = userEvent.setup()
    const nodes = makeTree()
    server.use(
      http.get(TREE_PATH, () => HttpResponse.json({ business_date: '2026-07-19', nodes })),
    )
    renderPage()

    await screen.findByText('Штаб бригады')
    const collapsed = mountedCount()

    await user.click(screen.getByRole('button', { name: 'Раскрыть Рота 1' }))
    expect(mountedCount()).toBeGreaterThan(collapsed)

    await user.click(screen.getByRole('button', { name: 'Свернуть Рота 1' }))
    // Классический баг «скрыли, но не размонтировали»: с `hidden` вместо
    // не-рендера счётчик остался бы раздутым.
    expect(mountedCount()).toBe(collapsed)
  })
})
