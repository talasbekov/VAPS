// @vitest-environment jsdom
// Ядро слияния и разводка WS→кэш (стори 11.4). Две половины файла разные по
// природе, и это намеренно:
//
// 1) mergeNotificationPage — ЧИСТАЯ функция, тестируется без React вовсе
//    (образец grammar.ts / daySubmission.ts / prefill.ts). Здесь живут правила
//    порядка, дедупа, иммутабельности и обрезки хвоста.
// 2) Интеграция — через НАСТОЯЩИЙ транспорт 11.3: subscribeMessages не
//    мокается, событие проезжает весь путь «кадр WS → emit → setQueryData»
//    (architecture.md#L258 требует буквально «событие → мутация кэша»).
//    Мок на subscribeMessages доказывал бы работу мока.
//
// jsdom — потому что транспорт строит URL из location, а дефолтное окружение
// проекта node; докблок первой строкой (vitest 4 удалил environmentMatchGlobs).
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../api/testing/server'
import { clearCredential, setCredential } from '../auth/credential'
import {
  __notificationsSocketStateForTests,
  configureNotificationsSocket,
  getStatusSnapshot,
  startNotificationsSocket,
} from './notificationsSocket'
import type { NotificationSocket } from './notificationsSocket'
import {
  mergeNotificationPage,
  NOTIFICATIONS_LIMIT,
  NOTIFICATIONS_QUERY_KEY,
  useNotificationsFeed,
} from './useNotificationsFeed'
import type { Notification, NotificationPage } from './useNotificationsFeed'

/** Своя минимальная поверхность сокета (Решение №2 стори 11.3: mock-socket не
 *  ставим — инъекция фабрики даёт то же покрытие без мутации глобала). */
class FakeSocket implements NotificationSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  emitMessage(frame: unknown): void {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(frame) }),
    )
  }
}

// ASCII в credential: нелатиница в значении заголовка X-User-Id отклоняется
// undici ещё до сети (находка дев-прохода 11.3). Кириллица — в ТЕЛАХ фикстур.
const DEV_CREDENTIAL = { kind: 'dev', userId: 'operator-42' } as const

const EARLIER = '2026-07-19T08:00:00+05:00'
const LATER = '2026-07-19T09:00:00+05:00'

const state = __notificationsSocketStateForTests

function makeRow(
  id: number,
  createdAt: string,
  over: Partial<Notification> = {},
): Notification {
  return {
    id,
    recipient: 'Ким Оператор Сергеевич',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-07-19',
    payload: { laggard_division_ids: [] },
    read_at: null,
    created_at: createdAt,
    ...over,
  }
}

function pageOf(rows: Notification[], count = rows.length): NotificationPage {
  return { count, next: null, previous: null, results: rows }
}

function frameOf(row: Notification): unknown {
  // конверт 11.2: {type: <kind>, payload: <проекция NotificationSerializer>}
  return { type: row.kind, payload: row }
}

type Responder = () => Response

let sockets: FakeSocket[] = []
let listUrls: URL[] = []
let feedResponders: Responder[] = []
let catchUpRows: Notification[] = []

/** Свой маршрут поверх дефолтной 502-фикстуры. Дефолтный хендлер НЕ трогаем —
 *  на нём висят client.test.ts и useApiMutation.test.tsx (Ловушка 1).
 *
 *  Ветка по limit обязательна: по одному пути ходят ДВА потребителя —
 *  запрос хука (?limit=50) и дочитка транспорта (?limit=1 на seed, дальше
 *  ?since=). Без разделения тест не смог бы отличить рефетч от дочитки. */
function useNotificationsRoute(): void {
  server.use(
    http.get('*/api/notifications/', ({ request }) => {
      const url = new URL(request.url)
      listUrls.push(url)
      if (url.searchParams.get('limit') !== String(NOTIFICATIONS_LIMIT)) {
        return HttpResponse.json(pageOf(catchUpRows))
      }
      const next = feedResponders.shift()
      return next === undefined
        ? HttpResponse.json(pageOf([]))
        : next()
    }),
  )
}

function feedRequests(): URL[] {
  return listUrls.filter(
    (url) => url.searchParams.get('limit') === String(NOTIFICATIONS_LIMIT),
  )
}

function makeClient(): QueryClient {
  // retry: false в СВОЁМ клиенте — канон DaySubmissionPanel.test.tsx:68-72
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderFeed(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
  return renderHook(() => useNotificationsFeed(), { wrapper: Wrapper })
}

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1)
  if (socket === undefined) throw new Error('сокет не создан')
  return socket
}

/** Транспорт запускает ТЕСТ (в приложении — ConnectionIndicator), а не хук:
 *  ровно это и проверяет test_socket_lifecycle_is_not_touched. */
async function connectSocket(): Promise<FakeSocket> {
  startNotificationsSocket()
  const socket = lastSocket()
  socket.open()
  await waitFor(() => {
    expect(state().seeded).toBe(true)
    expect(state().catchUpInFlight).toBe(false)
  })
  return socket
}

beforeEach(() => {
  sockets = []
  listUrls = []
  feedResponders = []
  catchUpRows = []
  configureNotificationsSocket({
    socketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
  })
  useNotificationsRoute()
  setCredential(DEV_CREDENTIAL)
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('mergeNotificationPage: чистое ядро слияния (AC-6)', () => {
  it('test_merge_ignores_undefined_cache: дельта НЕ засеивает пустой кэш', () => {
    // дельта — не список: посеяв её, панель показала бы «всю историю = 1 строка»
    expect(mergeNotificationPage(undefined, [makeRow(1, LATER)])).toBeUndefined()
  })

  it('test_merge_deduplicates_by_id: строка, уже лежащая на странице, не дублируется', () => {
    const known = makeRow(1, EARLIER)
    const prev = pageOf([known])

    const next = mergeNotificationPage(prev, [makeRow(1, EARLIER)])

    expect(next?.results).toHaveLength(1)
  })

  it('test_merge_keeps_server_ordering: created_at DESC, при равенстве — МЕНЬШИЙ id первым', () => {
    // порядок комментатором сервера: order_by("-created_at", "id"),
    // selectors.py:43 — интуитивное b.id - a.id разъехало бы клиент с сервером
    const prev = pageOf([makeRow(5, EARLIER)])

    const next = mergeNotificationPage(prev, [
      makeRow(3, LATER),
      makeRow(4, EARLIER),
    ])

    expect(next?.results.map((row) => row.id)).toEqual([3, 4, 5])
  })

  it('test_merge_returns_same_reference_when_nothing_new: ТА ЖЕ ссылка, не эквивалентный объект', () => {
    // toBe, а не toEqual: пересобранный объект дёргал бы ререндер всей шапки
    // на каждый дубликат из дочитки
    const prev = pageOf([makeRow(1, EARLIER)])

    expect(mergeNotificationPage(prev, [makeRow(1, EARLIER)])).toBe(prev)
    expect(mergeNotificationPage(prev, [])).toBe(prev)
  })

  it('test_merge_increments_count_by_fresh_only: дубликаты счётчик не раздувают', () => {
    const prev = pageOf([makeRow(1, EARLIER)], 7)

    const next = mergeNotificationPage(prev, [
      makeRow(1, EARLIER),
      makeRow(2, LATER),
    ])

    expect(next?.count).toBe(8)
  })

  it('test_merge_trims_to_limit: хвост режется — панель не растёт за долгую сессию', () => {
    const known = Array.from({ length: NOTIFICATIONS_LIMIT }, (_, index) =>
      makeRow(index + 1, EARLIER),
    )
    const prev = pageOf(known)

    const next = mergeNotificationPage(prev, [makeRow(999, LATER)])

    expect(next?.results).toHaveLength(NOTIFICATIONS_LIMIT)
    // новая строка — первой (она свежее), а самая хвостовая выпала
    expect(next?.results[0]?.id).toBe(999)
    expect(next?.results.map((row) => row.id)).not.toContain(
      NOTIFICATIONS_LIMIT,
    )
  })

  it('test_merge_does_not_mutate_previous_page: предыдущая страница неприкосновенна', () => {
    const known = makeRow(1, EARLIER)
    const prev = pageOf([known])
    const previousResults = prev.results

    const next = mergeNotificationPage(prev, [makeRow(2, LATER)])

    expect(prev.results).toBe(previousResults)
    expect(prev.results).toHaveLength(1)
    expect(prev.count).toBe(1)
    expect(next?.results).not.toBe(previousResults)
  })

  it('test_merge_drops_malformed_rows: битые строки отбрасываются, а не роняют панель', () => {
    const prev = pageOf([makeRow(1, EARLIER)])

    const next = mergeNotificationPage(prev, [
      null,
      'строка вместо объекта',
      { id: 'не число', created_at: LATER },
      { id: 2 }, // без created_at
      makeRow(3, LATER),
    ])

    expect(next?.results.map((row) => row.id)).toEqual([3, 1])
    expect(next?.count).toBe(2)
  })

  it('test_merge_drops_malformed_rows: нечитаемый results в кэше не роняет слияние', () => {
    // «Given results не массив» (AC-9): защитный разбор с обеих сторон
    const broken = {
      ...pageOf([]),
      results: 'сервер прислал не то' as unknown as Notification[],
    }

    const next = mergeNotificationPage(broken, [makeRow(1, LATER)])

    expect(next?.results.map((row) => row.id)).toEqual([1])
  })
})

describe('useNotificationsFeed: WS-событие → мутация кэша (AC-6)', () => {
  it('test_ws_row_appears_in_the_cache: кадр проезжает настоящий транспорт до кэша', async () => {
    const known = makeRow(1, EARLIER)
    feedResponders = [() => HttpResponse.json(pageOf([known]))]
    const queryClient = makeClient()
    const { result } = renderFeed(queryClient)
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
    })
    const socket = await connectSocket()

    socket.emitMessage(frameOf(makeRow(2, LATER)))

    await waitFor(() => {
      expect(result.current.notifications.map((row) => row.id)).toEqual([2, 1])
    })
    // счётчик непрочитанных пошёл за содержимым кэша, а не за длиной ответа
    expect(result.current.unreadCount).toBe(2)
  })

  it('test_ws_row_on_empty_cache_triggers_refetch: дельта не сеется, но список перечитывается', async () => {
    // первая загрузка провалилась (retry: false) → кэш пуст
    feedResponders = [
      () => HttpResponse.json({ detail: 'сбой' }, { status: 500 }),
      () => HttpResponse.json(pageOf([makeRow(2, LATER)])),
    ]
    const queryClient = makeClient()
    const { result } = renderFeed(queryClient)
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const socket = await connectSocket()
    expect(feedRequests()).toHaveLength(1)

    socket.emitMessage(frameOf(makeRow(2, LATER)))

    // ПЕРВАЯ половина: сразу после кадра кэш всё ещё пуст — дельта не выдала
    // себя за список (setQueryData синхронен, рефетч ещё не разрешился)
    expect(
      queryClient.getQueryData(NOTIFICATIONS_QUERY_KEY),
    ).toBeUndefined()
    // ВТОРАЯ половина: ушёл повторный запрос, и провалившаяся загрузка чинится
    await waitFor(() => {
      expect(feedRequests()).toHaveLength(2)
      expect(result.current.notifications.map((row) => row.id)).toEqual([2])
    })
  })

  it('test_row_known_to_the_page_is_not_duplicated_by_ws: пересечение каналов реально', async () => {
    // строка приехала в HTTP-ответе хука; транспорту она НЕИЗВЕСТНА (его кольцо
    // дедупа видело только свою дочитку), поэтому он честно доставит её ещё раз
    const shared = makeRow(1, EARLIER)
    feedResponders = [() => HttpResponse.json(pageOf([shared]))]
    const queryClient = makeClient()
    const { result } = renderFeed(queryClient)
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
    })
    const socket = await connectSocket()

    socket.emitMessage(frameOf(shared))

    await waitFor(() => {
      expect(state().catchUpInFlight).toBe(false)
    })
    expect(result.current.notifications).toHaveLength(1)
    expect(
      queryClient.getQueryData<NotificationPage>(NOTIFICATIONS_QUERY_KEY)?.count,
    ).toBe(1)
  })

  it('test_socket_lifecycle_is_not_touched: размонтирование хука НЕ останавливает транспорт', async () => {
    // владелец жизненного цикла один — ConnectionIndicator; второй владелец
    // означал бы, что размонтирование любого из двух убивает сокет обоим
    feedResponders = [() => HttpResponse.json(pageOf([]))]
    const { unmount } = renderFeed(makeClient())
    const socket = await connectSocket()
    expect(getStatusSnapshot()).toBe('online')

    unmount()

    expect(socket.closed).toBe(false)
    expect(getStatusSnapshot()).toBe('online')
  })

  it('test_subscription_is_released_on_unmount: размонтированный хук в кэш больше не пишет', async () => {
    // Обратная сторона предыдущего теста, и она НЕ покрывалась ничем: транспорт
    // хук не трогает — но и хук обязан отцепиться от транспорта. Утечка молчалива
    // по природе: слушатель продолжает писать в кэш уже брошенного клиента, а в
    // приложении AppLayout размонтируется на выходе из сессии — каждая следующая
    // сессия добавляла бы ещё один живой слушатель поверх старых.
    const known = makeRow(1, EARLIER)
    feedResponders = [() => HttpResponse.json(pageOf([known]))]
    const queryClient = makeClient()
    const { result, unmount } = renderFeed(queryClient)
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
    })
    const socket = await connectSocket()

    unmount()
    socket.emitMessage(frameOf(makeRow(2, LATER)))

    // 🔴 Гард от вакуума: сначала доказываем, что кадр РЕАЛЬНО проехал транспорт
    // (курсор канала сдвинулся на его created_at). Без этого ассерт ниже был бы
    // зелёным и на мёртвом сокете — то есть проверял бы ничто.
    await waitFor(() => {
      expect(state().cursorMs).toBe(Date.parse(LATER))
    })
    expect(
      queryClient
        .getQueryData<NotificationPage>(NOTIFICATIONS_QUERY_KEY)
        ?.results.map((row) => row.id),
    ).toEqual([1])
  })
})
