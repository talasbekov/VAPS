// @vitest-environment jsdom
// Story 10.4 — экран «Готовность сдачи» /organization (AC-8..12): узел =
// маркер + имя + текст-статус + «поздно» (цвет не единственный сигнал),
// ленивый DOM на 400 узлах (раскрытие без сети), фильтр «только отстающие»,
// polling 60с + ручной «Обновить» + подпись «Обновлено», состояния экрана
// (загрузка / пусто / доменная ошибка-баннер; 5xx/401 НЕ перехватываются —
// каналы ARCH-FE-015). RTL + msw; Harness из shared-примитивов (ARCH-FE-013).
import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ErrorEnvelope } from '../../shared/api/errors'
import { server } from '../../shared/api/testing/server'
import { ReadinessTreePage } from './ReadinessTreePage'
import { REFRESH_INTERVAL_MS } from './trafficTree'
import type { TrafficTreeNode } from './trafficTree'

function Harness({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// --- Фикстуры ------------------------------------------------------------------

const TREE_PATH = '*/api/operations/daily-submissions/traffic-tree/'
const TIMESTAMP = '2026-07-16T09:00:00+05:00'

function node(
  id: string,
  parentId: string | null,
  name: string,
  status: string,
  late = false,
): TrafficTreeNode {
  return { division_id: id, name, parent_id: parentId, status, late }
}

/** Регистрирует 200-handler и возвращает счётчик фактических запросов. */
function serveTree(nodes: TrafficTreeNode[]): () => number {
  let requests = 0
  server.use(
    http.get(TREE_PATH, () => {
      requests += 1
      return HttpResponse.json({ nodes })
    }),
  )
  return () => requests
}

/** 8 корней × 49 детей = 400 узлов (фикстура DOM-бюджета AC-9). */
function fourHundredNodes(): TrafficTreeNode[] {
  const nodes: TrafficTreeNode[] = []
  for (let r = 0; r < 8; r += 1) {
    const rootId = `root-${r}`
    nodes.push(node(rootId, null, `Корень ${r}`, 'RED'))
    for (let c = 0; c < 49; c += 1) {
      nodes.push(node(`${rootId}-c${c}`, rootId, `Дитя ${r}-${c}`, 'GREEN'))
    }
  }
  return nodes
}

function renderPage() {
  return render(
    <Harness>
      <ReadinessTreePage />
    </Harness>,
  )
}

// --- AC-8: узел — маркер + текст-статус + «поздно» + a11y -----------------------


describe('узел дерева (AC-8)', () => {
  it('рендерит маркер, имя, текст-статус всех 5 значений и метку «поздно»', async () => {
    serveTree([
      node('r1', null, 'Альфа', 'RED', true),
      node('r2', null, 'Бета', 'YELLOW'),
      node('r3', null, 'Гамма', 'GREEN'),
      node('r4', null, 'Дельта', 'NEUTRAL'),
      node('r5', null, 'Эпсилон', 'UNKNOWN'),
    ])
    renderPage()
    const alpha = await screen.findByTestId('tree-node-r1')
    expect(within(alpha).getByTestId('tree-marker')).toBeInTheDocument()
    expect(within(alpha).getByText('Альфа')).toBeInTheDocument()
    expect(within(alpha).getByText('не сдано')).toBeInTheDocument()
    expect(within(alpha).getByText('поздно')).toBeInTheDocument()
    // Цвет — не единственный сигнал: состояние доступно скринридеру.
    expect(alpha).toHaveAttribute('aria-label', 'Альфа: не сдано, поздно')

    expect(screen.getByText('расход разошёлся')).toBeInTheDocument()
    expect(screen.getByText('сдано и сходится')).toBeInTheDocument()
    expect(screen.getByText('нет данных')).toBeInTheDocument()
    expect(screen.getByText('неопределён')).toBeInTheDocument()
    // «поздно» — только у late-узла
    expect(screen.getAllByText('поздно')).toHaveLength(1)
    // Маркер — декорация, скрыт от скринридера
    expect(within(alpha).getByTestId('tree-marker')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })
})

// --- AC-9: ленивый DOM, 400 узлов ------------------------------------------------

describe('ленивый DOM (AC-9)', () => {
  it('изначально отрендерены только корни; раскрытие добавляет только детей узла и НЕ ходит в сеть', async () => {
    const requests = serveTree(fourHundredNodes())
    renderPage()
    await screen.findByTestId('tree-node-root-0')
    // строк в DOM = числу корней, не 400
    expect(screen.getAllByTestId(/^tree-node-/)).toHaveLength(8)
    expect(requests()).toBe(1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Раскрыть Корень 0' }),
    )
    // добавились ТОЛЬКО непосредственные дети root-0
    expect(screen.getAllByTestId(/^tree-node-/)).toHaveLength(8 + 49)
    expect(screen.getByTestId('tree-node-root-0-c0')).toBeInTheDocument()
    // повторный запрос в сеть при раскрытии НЕ уходит
    expect(requests()).toBe(1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Свернуть Корень 0' }),
    )
    expect(screen.getAllByTestId(/^tree-node-/)).toHaveLength(8)
  })
})

// --- AC-10: фильтр «только отстающие» --------------------------------------------

describe('фильтр «только отстающие» (AC-10)', () => {
  it('скрывает GREEN/NEUTRAL, оставляет RED/YELLOW/UNKNOWN; выключение возвращает всё', async () => {
    serveTree([
      node('red', null, 'Красный корень', 'RED'),
      node('red-g', 'red', 'Зелёное дитя', 'GREEN'),
      node('red-y', 'red', 'Жёлтое дитя', 'YELLOW'),
      node('yellow', null, 'Жёлтый корень', 'YELLOW'),
      node('unknown', null, 'Смутный корень', 'UNKNOWN'),
      node('green', null, 'Зелёный корень', 'GREEN'),
      node('neutral', null, 'Пустой корень', 'NEUTRAL'),
    ])
    renderPage()
    await screen.findByTestId('tree-node-red')
    expect(screen.getAllByTestId(/^tree-node-/)).toHaveLength(5)

    // labeled control, доступен с клавиатуры (нативный checkbox)
    const toggle = screen.getByRole('checkbox', { name: 'Только отстающие' })
    fireEvent.click(toggle)
    expect(screen.getByTestId('tree-node-red')).toBeInTheDocument()
    expect(screen.getByTestId('tree-node-yellow')).toBeInTheDocument()
    expect(screen.getByTestId('tree-node-unknown')).toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-green')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-neutral')).not.toBeInTheDocument()

    // фильтр действует и на детей раскрытого узла
    fireEvent.click(
      screen.getByRole('button', { name: 'Раскрыть Красный корень' }),
    )
    expect(screen.getByTestId('tree-node-red-y')).toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-red-g')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByTestId('tree-node-green')).toBeInTheDocument()
    expect(screen.getByTestId('tree-node-neutral')).toBeInTheDocument()
  })
})

// --- AC-11: polling + ручной рефреш ----------------------------------------------

describe('обновление (AC-11)', () => {
  it('рефетчится по интервалу 60с; «Обновить» триггерит немедленный refetch; подпись «Обновлено» меняется', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const requests = serveTree([node('r1', null, 'Альфа', 'GREEN')])
    renderPage()
    await screen.findByTestId('tree-node-r1')
    expect(requests()).toBe(1)
    const updatedBefore = screen.getByTestId('updated-at').textContent
    expect(updatedBefore).toMatch(/^Обновлено \d{2}:\d{2}:\d{2}$/)

    // интервальный рефетч (fake timers)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    })
    await waitFor(() => expect(requests()).toBe(2))
    await waitFor(() =>
      expect(screen.getByTestId('updated-at').textContent).not.toBe(
        updatedBefore,
      ),
    )

    // ручной рефетч
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => expect(requests()).toBe(3))
  })
})

// --- AC-12: состояния экрана ------------------------------------------------------

describe('состояния экрана (AC-12)', () => {
  it('показывает индикатор загрузки, пока ответ в полёте', async () => {
    server.use(
      http.get(TREE_PATH, async () => {
        await delay(150)
        return HttpResponse.json({ nodes: [] })
      }),
    )
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка дерева…')
    await screen.findByText('Нет доступных подразделений')
  })

  it('пустой nodes → «нет доступных подразделений», не вечный спиннер', async () => {
    serveTree([])
    renderPage()
    await screen.findByText('Нет доступных подразделений')
    expect(screen.queryByText('Загрузка дерева…')).not.toBeInTheDocument()
  })

  it('доменная ошибка (422) → баннер с сообщением и «Повторить»', async () => {
    const envelope: ErrorEnvelope = {
      error_code: 'REPORT_NO_DATA_FOR_DATE',
      message: 'Запрошена дата до начала данных — нет ни списка, ни статусов.',
      details: {},
      request_id: null,
      timestamp: TIMESTAMP,
    }
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.json(envelope, { status: 422 }),
      ),
    )
    renderPage()
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(
      'Запрошена дата до начала данных — нет ни списка, ни статусов.',
    )
    expect(
      within(banner).getByRole('button', { name: 'Повторить' }),
    ).toBeInTheDocument()
  })

  it('5xx НЕ перехватывается баннером экрана (канал тоста — хук/клиент)', async () => {
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.json(
          {
            error_code: 'INTERNAL_ERROR',
            message: 'Внутренняя ошибка.',
            details: {},
            request_id: null,
            timestamp: TIMESTAMP,
          } satisfies ErrorEnvelope,
          { status: 500 },
        ),
      ),
    )
    renderPage()
    await waitFor(() =>
      expect(screen.queryByText('Загрузка дерева…')).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('очищенная дата → подсказка вместо стейл-дерева; «Обновить» НЕ бьёт в сеть (ревью 10.4)', async () => {
    const requests = serveTree([node('r1', null, 'Альфа', 'GREEN')])
    renderPage()
    await screen.findByTestId('tree-node-r1')
    expect(requests()).toBe(1)

    // Очистка date-input — валидное действие оператора: дерево прежней даты
    // (keepPreviousData) не должно висеть как «текущее» при выключенном polling
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '' } })
    expect(
      screen.getByText('Укажите дату, чтобы увидеть готовность.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-r1')).not.toBeInTheDocument()

    // refetch() в RQ v5 обходит enabled:false → был бы гарантированный 400
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(requests()).toBe(1)
  })

  it('после доменной ошибки интервал 60с НЕ рефетчит детерминированный 4xx (ревью 10.4)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let requests = 0
    server.use(
      http.get(TREE_PATH, () => {
        requests += 1
        return HttpResponse.json(
          {
            error_code: 'REPORT_NO_DATA_FOR_DATE',
            message: 'Запрошена дата до начала данных.',
            details: {},
            request_id: null,
            timestamp: TIMESTAMP,
          } satisfies ErrorEnvelope,
          { status: 422 },
        )
      }),
    )
    renderPage()
    await screen.findByRole('alert')
    expect(requests).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 1000)
    })
    expect(requests).toBe(1)
  })

  it('401 НЕ перехватывается экраном (logout-цепь 8.6 — providers)', async () => {
    server.use(
      http.get(TREE_PATH, () =>
        HttpResponse.json(
          {
            error_code: 'AUTH_REQUIRED',
            message: 'Требуется вход.',
            details: {},
            request_id: null,
            timestamp: TIMESTAMP,
          } satisfies ErrorEnvelope,
          { status: 401 },
        ),
      ),
    )
    renderPage()
    await waitFor(() =>
      expect(screen.queryByText('Загрузка дерева…')).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
