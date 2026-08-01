// @vitest-environment jsdom
// Транспорт уведомлений 11.3 на ФЕЙКАХ (architecture.md#L258): реконнект с
// backoff и дочитка по REST после reconnect. jsdom — потому что модуль строит
// URL из location, а дефолтное окружение vitest в проекте node (там location
// не существует); докблок первой строкой — vitest 4 удалил environmentMatchGlobs.
//
// Фейковый сокет свой (Решение №2): mock-socket не ставим — он патчит ГЛОБАЛЬНЫЙ
// WebSocket, а инъекция фабрики даёт то же покрытие без глобальной мутации.
//
// Расписание backoff — на fake timers, дочитка — на РЕАЛЬНЫХ: второе подключение
// в тестах дочитки делается парой stop()/start(), а не прокруткой таймера. Путь
// реконнекта покрыт тестами расписания, а тесту дочитки нужна только ветка «ещё
// один open» — так в файле нет ни одного блокирующего тайминга (architecture.md#L246).
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '../api/schema'
import { server } from '../api/testing/server'
import {
  __notificationsSocketStateForTests,
  __resetNotificationsSocketForTests,
  CATCHUP_LIMIT,
  configureNotificationsSocket,
  getStatusSnapshot,
  RECONNECT_BASE_MS,
  RECONNECT_CAP_MS,
  SEEN_IDS_LIMIT,
  startNotificationsSocket,
  stopNotificationsSocket,
  subscribeMessages,
  WS_NOTIFICATIONS_PATH,
} from './notificationsSocket'
import type { NotificationSocket, Notification } from './notificationsSocket'
import {
  clearCredential,
  getCredential,
  setCredential,
} from '../auth/credential'

/** ~40 строк, ноль зависимостей: ровно поверхность NotificationSocket + хелперы. */
class FakeSocket implements NotificationSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false
  readonly url: string

  // поле объявлено явно: parameter properties запрещены erasableSyntaxOnly
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

  emitClose(code: number): void {
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }))
  }

  emitError(): void {
    this.onerror?.(new Event('error'))
  }
}

type Responder = () => Response | Promise<Response>

// ASCII: значение уходит в заголовок X-User-Id, а нелатиница в заголовке
// отклоняется undici ещё до сети (кириллица живёт в фикстурах ОТВЕТА)
const DEV_CREDENTIAL = { kind: 'dev', userId: 'operator-42' } as const

let sockets: FakeSocket[] = []
let catchUpUrls: URL[] = []
let responders: Responder[] = []
let received: Notification[][] = []

const state = __notificationsSocketStateForTests

function makeRow(id: number, createdAt: string): Notification {
  return {
    id,
    recipient: 'Ким Оператор Сергеевич',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-07-19',
    payload: { division: 'Отдел кадров', note: 'сдача просрочена' },
    read_at: null,
    created_at: createdAt,
  }
}

function frameOf(row: Notification): unknown {
  // конверт 11.2: {type: <kind>, payload: <проекция NotificationSerializer>}
  return { type: row.kind, payload: row }
}

/** Тип конверта — ИЗ схемы (ARCH-FE-011): фикстура, противоречащая контракту
 *  read-API, не скомпилируется. */
function pageOf(
  rows: Notification[],
  count = rows.length,
): components['schemas']['PaginatedNotificationList'] {
  return { count, next: null, previous: null, results: rows }
}

/** Наш маршрут поверх дефолтной 502-фикстуры. Дефолтный хендлер НЕ трогаем —
 *  на нём висят client.test.ts и useApiMutation.test.tsx. */
function useNotificationsRoute(): void {
  server.use(
    http.get('*/api/notifications/', async ({ request }) => {
      catchUpUrls.push(new URL(request.url))
      const next = responders.shift()
      return next === undefined ? HttpResponse.json(pageOf([])) : next()
    }),
  )
}

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1)
  if (socket === undefined) throw new Error('сокет не создан')
  return socket
}

/** Открыть текущий сокет и дождаться, что дочитка ОСЕЛА (детерминированно:
 *  запрос ушёл И полёт завершён — не «поспать N мс»). */
async function openAndSettle(expectedRequests: number): Promise<void> {
  lastSocket().open()
  await vi.waitFor(() => {
    expect(catchUpUrls).toHaveLength(expectedRequests)
    expect(state().catchUpInFlight).toBe(false)
  })
}

/** Ещё одно подключение без прокрутки таймеров (курсор/seeded переживают stop). */
function reopen(): void {
  stopNotificationsSocket()
  startNotificationsSocket()
}

beforeEach(() => {
  __resetNotificationsSocketForTests()
  sockets = []
  catchUpUrls = []
  responders = []
  received = []
  configureNotificationsSocket({
    socketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    // полный джиттер выключен: 0.5 + 1*0.5 = 1.0 → фактическая задержка = расписанию
    random: () => 1,
  })
  useNotificationsRoute()
  subscribeMessages((rows) => received.push(rows))
  setCredential(DEV_CREDENTIAL)
})

afterEach(() => {
  stopNotificationsSocket()
  clearCredential()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notificationsSocket: адрес и identity', () => {
  it('test_url_carries_dev_user_id: dev-credential уходит параметром user_id', () => {
    setCredential({ kind: 'dev', userId: 'опер 42' })
    startNotificationsSocket()

    const url = new URL(lastSocket().url)
    expect(url.pathname).toBe(WS_NOTIFICATIONS_PATH)
    expect(url.pathname.endsWith('/')).toBe(true) // трейлинг-слеш значим
    expect(url.searchParams.get('user_id')).toBe('опер 42')
    expect(url.searchParams.get('token')).toBeNull()
    expect(url.protocol).toBe('ws:')
  })

  it('test_url_carries_jwt_token: jwt-credential уходит параметром token', () => {
    setCredential({ kind: 'jwt', token: 'a+b/c=токен' })
    startNotificationsSocket()

    const url = new URL(lastSocket().url)
    expect(url.pathname).toBe(WS_NOTIFICATIONS_PATH)
    // значение из searchParams уже декодировано: '+' пережил передачу, значит
    // encodeURIComponent на месте (сырой '+' стал бы пробелом)
    expect(url.searchParams.get('token')).toBe('a+b/c=токен')
    expect(url.searchParams.get('user_id')).toBeNull()
  })

  it('без credential сокет не открывается вовсе, статус idle', () => {
    clearCredential()
    startNotificationsSocket()

    expect(sockets).toHaveLength(0)
    expect(getStatusSnapshot()).toBe('idle')
  })

  it('под https схема сокета — wss (ЕДИНСТВЕННАЯ ветка, которая работает в проде)', () => {
    // jsdom по умолчанию отдаёт http://localhost, поэтому все остальные тесты
    // адреса гоняют ТОЛЬКО ветку ws:. Прод — https, и подмена схемы там
    // обязательна: ws: со страницы https браузер блокирует (mixed content), то
    // есть ошибка в этой ветке не ловится ничем вплоть до пилота.
    vi.stubGlobal('location', { protocol: 'https:', host: 'vaps.local' })
    startNotificationsSocket()

    const url = new URL(lastSocket().url)
    expect(url.protocol).toBe('wss:')
    expect(url.host).toBe('vaps.local') // адрес из location, не литерал
    expect(url.pathname).toBe(WS_NOTIFICATIONS_PATH)
  })
})

describe('notificationsSocket: backoff', () => {
  it('test_backoff_follows_the_schedule: задержки идут по расписанию целиком', async () => {
    vi.useFakeTimers()
    startNotificationsSocket()
    expect(sockets).toHaveLength(1)

    // первая пауза — граничной парой (образец toast.test.tsx): ровно, не «примерно»
    lastSocket().emitClose(1006)
    expect(getStatusSnapshot()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS - 1)
    expect(sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(2)

    // остальные — измеряем фактическую задержку и сверяем ПОЛНЫЙ массив:
    // «была хотя бы одна повторная попытка» зелено и на фиксированной задержке
    const delays = [RECONNECT_BASE_MS]
    for (let i = 0; i < 6; i += 1) {
      const before = sockets.length
      lastSocket().emitClose(1006)
      const startedAt = Date.now()
      await vi.advanceTimersToNextTimerAsync()
      delays.push(Date.now() - startedAt)
      expect(sockets).toHaveLength(before + 1)
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('test_error_and_close_schedule_a_single_retry: error + close дают ровно одну попытку', async () => {
    vi.useFakeTimers()
    startNotificationsSocket()

    // браузер при неудачном подключении фаерит ОБА события подряд
    lastSocket().emitError()
    lastSocket().emitClose(1006)

    await vi.advanceTimersByTimeAsync(RECONNECT_CAP_MS * 2)
    expect(sockets).toHaveLength(2) // без гарда здесь было бы 3 (два таймера)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('test_successful_open_resets_the_attempt_counter: после open серия снова с 1000 мс', async () => {
    vi.useFakeTimers()
    startNotificationsSocket()

    // серия 1: два разрыва → 1000, 2000
    lastSocket().emitClose(1006)
    await vi.advanceTimersToNextTimerAsync()
    lastSocket().emitClose(1006)
    const beforeSecond = Date.now()
    await vi.advanceTimersToNextTimerAsync()
    expect(Date.now() - beforeSecond).toBe(2000)
    expect(state().attempt).toBe(2)

    // успешное подключение обнуляет счётчик
    lastSocket().open()
    expect(state().attempt).toBe(0)

    // серия 2 начинается заново с базовой задержки
    lastSocket().emitClose(1006)
    const beforeThird = Date.now()
    await vi.advanceTimersToNextTimerAsync()
    expect(Date.now() - beforeThird).toBe(RECONNECT_BASE_MS)
  })

  it('джиттер реально режет задержку: random → 0 даёт половину расписания', async () => {
    // Все остальные тесты расписания гоняют random → 1, при котором множитель
    // 0.5 + random()*0.5 равен 1.0 — то есть джиттер там НЕ наблюдаем вовсе, и
    // его удаление оставило бы их зелёными. Джиттер — требование AC-4: без него
    // после деплоя все клиенты возвращаются одной секундой в секунду.
    vi.useFakeTimers()
    configureNotificationsSocket({ random: () => 0 })
    startNotificationsSocket()

    lastSocket().emitClose(1006)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS / 2 - 1)
    expect(sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(2)
  })

  it('start() идемпотентен: StrictMode монтирует эффект дважды', () => {
    startNotificationsSocket()
    startNotificationsSocket()

    // без гарда started в dev жили бы два сокета и удвоенная дочитка
    expect(sockets).toHaveLength(1)
  })

  it('test_clearing_credential_stops_everything: ни сокетов, ни таймеров', async () => {
    vi.useFakeTimers()
    startNotificationsSocket()

    // позитивный контроль ТЕМ ЖЕ механизмом: при живом credential разрыв
    // действительно рождает сокет — иначе «не создано» неотличимо от
    // «фабрика вообще не работает»
    lastSocket().emitClose(1006)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(sockets).toHaveLength(2)

    clearCredential()
    const afterClear = sockets.length
    lastSocket().emitClose(1006)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(sockets).toHaveLength(afterClear)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('поздний close УЖЕ ЗАМЕНЁННОГО сокета не рождает фантомный цикл', async () => {
    vi.useFakeTimers()
    startNotificationsSocket()
    const stale = lastSocket()

    // разрыв → реконнект по расписанию → живой сокет №2
    stale.emitClose(1006)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(sockets).toHaveLength(2)
    lastSocket().open()
    expect(getStatusSnapshot()).toBe('online')

    // близнец-close от заменённого сокета: в браузере error и close — пара, и
    // close может опоздать за пределы окна retry-таймера. Эпоха у него ТА ЖЕ,
    // что у преемника, поэтому спасает только отцепление обработчиков в
    // connect(): без него статус флапнул бы в reconnecting при живом №2 и
    // родился бы фантомный сокет №3 (находка ревью 11.3).
    stale.emitClose(1006)

    expect(getStatusSnapshot()).toBe('online')
    await vi.advanceTimersByTimeAsync(RECONNECT_CAP_MS * 2)
    expect(sockets).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('повторный setCredential тем же значением не дёргает сокет', () => {
    startNotificationsSocket()
    expect(sockets).toHaveLength(1)

    // setCredential уведомляет слушателей ВСЕГДА, даже на повторной установке
    // того же значения (credential.ts:71-78) — без сравнения значений живое
    // соединение рвалось бы на каждой перезаписи credential
    setCredential({ ...DEV_CREDENTIAL })
    expect(sockets).toHaveLength(1)

    // позитивный контроль тем же механизмом: РЕАЛЬНАЯ смена сокет пересоздаёт —
    // иначе «сокет не пересоздан» неотличимо от «обработчик мёртв вовсе»
    setCredential({ kind: 'dev', userId: 'operator-77' })
    expect(sockets).toHaveLength(2)
  })
})

describe('notificationsSocket: дочитка', () => {
  it('test_first_open_seeds_the_cursor_without_emitting: первый open только SEED-ит', async () => {
    responders.push(() =>
      HttpResponse.json(
        pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')], 137),
      ),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    // SEED: одна строка, без since, наружу НИЧЕГО
    expect(catchUpUrls[0].searchParams.get('limit')).toBe('1')
    expect(catchUpUrls[0].searchParams.get('since')).toBeNull()
    expect(received).toEqual([])
    expect(state().seeded).toBe(true)

    // а следующий open уже несёт since и полную страницу
    reopen()
    await openAndSettle(2)
    expect(catchUpUrls[1].searchParams.get('since')).not.toBeNull()
    expect(catchUpUrls[1].searchParams.get('limit')).toBe(String(CATCHUP_LIMIT))
  })

  it('test_catchup_uses_cursor_with_grace: since = max(created_at) − 5 c', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    reopen()
    await openAndSettle(2)

    // ЗНАЧЕНИЕ, а не «запрос был»: опечатка в имени параметра молча вернула бы
    // всю историю с 200. 15:04:05+05:00 → 10:04:05Z, минус grace → 10:04:00Z
    expect(catchUpUrls[1].searchParams.get('since')).toBe(
      '2026-07-19T10:04:00.000Z',
    )
  })

  it('test_cursor_never_moves_backwards: WS-строка во время полёта дочитки не откатывает курсор', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T09:00:00+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    // дочитка со СТАРЫМИ строками зависает в полёте
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    responders.push(async () => {
      await gate
      return HttpResponse.json(pageOf([makeRow(2, '2026-07-19T09:00:01+05:00')]))
    })
    reopen()
    lastSocket().open()
    await vi.waitFor(() => {
      expect(catchUpUrls).toHaveLength(2)
    })

    // пока она в полёте, по WS приходит строка НОВЕЕ
    lastSocket().emitMessage(frameOf(makeRow(9, '2026-07-19T12:00:00+05:00')))
    release()
    await vi.waitFor(() => {
      expect(state().catchUpInFlight).toBe(false)
    })

    // следующий since — по НОВОЙ строке (12:00:00+05 → 07:00:00Z − 5 c)
    reopen()
    await openAndSettle(3)
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      '2026-07-19T06:59:55.000Z',
    )
  })

  it('test_empty_catchup_keeps_the_cursor: пустой ответ не двигает курсор и не роняет канал', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    responders.push(() => HttpResponse.json(pageOf([])))
    reopen()
    await openAndSettle(2)

    // сокет жив, статус не поехал (Math.max([]) = -Infinity → RangeError был бы
    // проглочен catch'ем и дочитка не заработала бы больше никогда)
    expect(getStatusSnapshot()).toBe('online')
    expect(lastSocket().closed).toBe(false)

    reopen()
    await openAndSettle(3)
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      catchUpUrls[1].searchParams.get('since'),
    )
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      '2026-07-19T10:04:00.000Z',
    )
  })

  it('test_duplicate_id_is_emitted_once: одна строка по WS и в дочитке отдаётся один раз', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    const row = makeRow(5, '2026-07-19T15:04:05+05:00')
    lastSocket().emitMessage(frameOf(row))

    // та же строка возвращается дочиткой (grace-окно перекрывается по построению)
    responders.push(() => HttpResponse.json(pageOf([row])))
    reopen()
    await openAndSettle(2)

    expect(received.flat().filter((r) => r.id === 5)).toHaveLength(1)
  })

  it('test_catchup_rows_are_emitted_oldest_first: ответ -created_at разворачивается', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    responders.push(() =>
      HttpResponse.json(
        pageOf([
          makeRow(3, '2026-07-19T12:00:03+05:00'),
          makeRow(2, '2026-07-19T12:00:02+05:00'),
          makeRow(1, '2026-07-19T12:00:01+05:00'),
        ]),
      ),
    )
    reopen()
    await openAndSettle(2)

    expect(received.flat().map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('test_catchup_failure_keeps_the_socket_and_the_cursor: 502 не трогает сокет', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    // дефолтная фикстура */api/notifications/ отдаёт 502 HTML — берём её как есть
    server.resetHandlers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reopen()
    lastSocket().open()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled()
      expect(state().catchUpInFlight).toBe(false)
    })

    expect(sockets).toHaveLength(2) // backoff НЕ стартовал
    expect(lastSocket().closed).toBe(false)
    expect(getStatusSnapshot()).toBe('online')
    warn.mockRestore()

    // курсор не сдвинулся — следующая дочитка идёт с прежним since
    useNotificationsRoute()
    responders.push(() => HttpResponse.json(pageOf([])))
    reopen()
    await openAndSettle(2)
    expect(catchUpUrls[1].searchParams.get('since')).toBe(
      '2026-07-19T10:04:00.000Z',
    )
  })

  it('test_catchup_401_clears_the_credential: протухшая identity гасит канал', async () => {
    responders.push(
      () =>
        new HttpResponse(
          JSON.stringify({
            error_code: 'NOT_AUTHENTICATED',
            message: 'Учётные данные не предоставлены',
            details: {},
            request_id: null,
            timestamp: '2026-07-19T15:00:00+05:00',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    startNotificationsSocket()
    lastSocket().open()

    await vi.waitFor(() => {
      expect(getCredential()).toBeNull()
    })
    warn.mockRestore()
  })

  it('test_credential_change_resets_the_cursor: курсор не переживает смену пользователя', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)
    expect(state().cursorMs).not.toBeNull()

    // курсор пользователя A, доживший до сессии B, отфильтровал бы дочитку B
    // по чужому времени и молча съел его уведомления
    setCredential({ kind: 'dev', userId: 'operator-77' })
    expect(state().cursorMs).toBeNull()
    expect(state().seeded).toBe(false)

    expect(lastSocket().url).toContain('user_id=operator-77')
    await openAndSettle(2)
    expect(catchUpUrls[1].searchParams.get('since')).toBeNull()
    expect(catchUpUrls[1].searchParams.get('limit')).toBe('1') // снова SEED
  })

  it('test_oversized_gap_advances_cursor_without_paging: >200 пропущенных не запускают цикл', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    // страница приходит -created_at: [0] — самая новая
    const newest = Date.parse('2026-07-19T12:00:00+05:00')
    const bulk = Array.from({ length: CATCHUP_LIMIT }, (_, i) =>
      makeRow(1000 + i, new Date(newest - i * 60_000).toISOString()),
    )
    responders.push(() => HttpResponse.json(pageOf(bulk, 500)))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reopen()
    await openAndSettle(2)

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('пропущено больше'),
    )
    expect(catchUpUrls).toHaveLength(2) // второй страницы НЕ запрашивали
    expect(received.flat()).toHaveLength(CATCHUP_LIMIT)
    warn.mockRestore()

    // курсор всё равно сдвинут к самой новой строке
    reopen()
    await openAndSettle(3)
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      new Date(newest - 5000).toISOString(),
    )
  })

  it('битый кадр WS не роняет обработчик и не эмитит', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    lastSocket().onmessage?.(
      new MessageEvent('message', { data: 'не json вовсе' }),
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    // кадр без payload игнорируется молча
    lastSocket().emitMessage({ type: 'SUBMISSION_LAGGING' })
    // кадр без строкового type — не конверт 11.2, даже с валидным payload
    // (форма {type, payload} проверяется целиком — находка ревью 11.3)
    lastSocket().emitMessage({ payload: makeRow(8, '2026-07-19T16:00:00+05:00') })
    expect(received).toEqual([])
    expect(getStatusSnapshot()).toBe('online')
  })

  it('SEED на пустой базе: следующая дочитка идёт БЕЗ since и эмитит', async () => {
    // Краевой случай Решения №7: на момент SEED строк не было вовсе, поэтому
    // курсор остаётся пустым при seeded === true. Если бы такая дочитка не
    // эмитила, уведомление, родившееся в ПЕРВЫЙ ЖЕ разрыв нового пользователя,
    // терялось бы навсегда — а это ровно тот сценарий, ради которого стори.
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)
    expect(state().seeded).toBe(true)
    expect(state().cursorMs).toBeNull()

    const row = makeRow(7, '2026-07-19T15:04:05+05:00')
    responders.push(() => HttpResponse.json(pageOf([row])))
    reopen()
    await openAndSettle(2)

    expect(catchUpUrls[1].searchParams.get('since')).toBeNull()
    expect(catchUpUrls[1].searchParams.get('limit')).toBe(String(CATCHUP_LIMIT))
    expect(received.flat().map((r) => r.id)).toEqual([7])
  })

  it('вторая дочитка не стартует, пока первая в полёте', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    responders.push(async () => {
      await gate
      return HttpResponse.json(pageOf([]))
    })
    startNotificationsSocket()
    lastSocket().open()
    await vi.waitFor(() => {
      expect(catchUpUrls).toHaveLength(1)
    })

    // Ещё open, пока первая дочитка висит в полёте. У одного actor реально
    // бывает несколько сокетов (реконнект поверх живого — test_ws_e2e.py:201-222),
    // и каждый их open ведёт в ОДИН catchUp: без гарда получились бы две
    // параллельные дочитки и два расходящихся курсора.
    lastSocket().open()
    lastSocket().open()
    expect(catchUpUrls).toHaveLength(1)

    // позитивный контроль: когда первая осела, следующий open запрос ДЕЛАЕТ —
    // иначе «второго запроса нет» неотличимо от «запросы вообще не уходят»
    release()
    await vi.waitFor(() => {
      expect(state().catchUpInFlight).toBe(false)
    })
    responders.push(() => HttpResponse.json(pageOf([])))
    lastSocket().open()
    await vi.waitFor(() => {
      expect(catchUpUrls).toHaveLength(2)
    })
  })

  it('stop() в полёте дочитки: осиротевший ответ не эмитит и не двигает курсор', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let served = false
    responders.push(async () => {
      await gate
      served = true
      return HttpResponse.json(
        pageOf([makeRow(9, '2026-07-19T20:00:00+05:00')]),
      )
    })
    reopen()
    lastSocket().open()
    await vi.waitFor(() => {
      expect(catchUpUrls).toHaveLength(2)
    })

    // Размонтирование посреди полёта. Отменить запрос НЕЧЕМ — у apiClient нет
    // AbortSignal вовсе (client.ts:31-55), спасает только гард по epoch.
    stopNotificationsSocket()
    release()
    await vi.waitFor(() => {
      expect(served).toBe(true)
    })

    expect(received).toEqual([]) // в отписанных слушателей не эмитим

    // курсор остался на строке ПЕРВОЙ дочитки, а не на осиротевшей 20:00
    startNotificationsSocket()
    await openAndSettle(3)
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      '2026-07-19T10:04:00.000Z',
    )
  })

  it('обрыв сети не гасит credential и не трогает сокет', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    responders.push(() => HttpResponse.error()) // HTTP-ответа нет вовсе
    reopen()
    lastSocket().open()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled()
      expect(state().catchUpInFlight).toBe(false)
    })
    warn.mockRestore()

    // NetworkError НЕ наследует ApiError (errors.ts:102-108): наивный catch,
    // гасящий credential на любой ошибке, выкидывал бы оператора из системы при
    // первом же обрыве сети — а обрыв здесь ожидаемое состояние, не исключение
    expect(getCredential()).not.toBeNull()
    expect(sockets).toHaveLength(2) // backoff не стартовал
    expect(lastSocket().closed).toBe(false)
    expect(getStatusSnapshot()).toBe('online')
  })

  it('невалидное тело дочитки = пустая дочитка, а не краш', async () => {
    responders.push(() =>
      HttpResponse.json(pageOf([makeRow(1, '2026-07-19T15:04:05+05:00')])),
    )
    startNotificationsSocket()
    await openAndSettle(1)

    // AC-8 называет три класса сбоя (5xx / NetworkError / невалидное тело);
    // «results не массив» — единственный, который проходит МИМО catch: разбор
    // обязан деградировать сам, иначе курсор двинулся бы по мусору
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    responders.push(() =>
      HttpResponse.json({
        count: 3,
        next: null,
        previous: null,
        results: 'не массив',
      }),
    )
    reopen()
    await openAndSettle(2)
    warn.mockRestore()

    expect(received).toEqual([])
    expect(getStatusSnapshot()).toBe('online')
    expect(lastSocket().closed).toBe(false)

    reopen()
    await openAndSettle(3)
    expect(catchUpUrls[2].searchParams.get('since')).toBe(
      '2026-07-19T10:04:00.000Z',
    )
  })

  it('битая строка внутри страницы отбрасывается, соседние доезжают', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    const good = makeRow(4, '2026-07-19T12:00:04+05:00')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    responders.push(() =>
      HttpResponse.json({
        count: 2,
        next: null,
        previous: null,
        // id строкой вместо числа сломал бы дедуп (Set по смешанному типу) и
        // Date.parse(undefined) — курсор ушёл бы в NaN
        results: [good, { id: 'не число', created_at: null }],
      }),
    )
    reopen()
    await openAndSettle(2)

    expect(received.flat().map((r) => r.id)).toEqual([4])
    expect(getStatusSnapshot()).toBe('online')
    // count == СЫРОЙ длине results: защитный отсев битой строки не должен
    // выдавать ложное «пропущено больше 200» (находка ревью 11.3)
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('пропущено больше'),
    )
    warn.mockRestore()
  })

  it('полная страница дочитки НЕ вытесняет кольцо дедупа', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    const row = makeRow(7, '2026-07-19T08:00:00+05:00')
    lastSocket().emitMessage(frameOf(row))
    expect(received.flat().filter((r) => r.id === 7)).toHaveLength(1)

    // страница дочитки на ПОЛНЫЙ CATCHUP_LIMIT
    const newest = Date.parse('2026-07-19T12:00:00+05:00')
    const bulk = Array.from({ length: CATCHUP_LIMIT }, (_, i) =>
      makeRow(2000 + i, new Date(newest - i * 60_000).toISOString()),
    )
    responders.push(() => HttpResponse.json(pageOf(bulk)))
    reopen()
    await openAndSettle(2)

    // Та же строка снова приходит в grace-хвосте — кольцо обязано её ПОМНИТЬ.
    // Будь SEEN_IDS_LIMIT не больше страницы, одна дочитка вымыла бы кольцо
    // целиком ровно в том сценарии, ради которого дедуп заведён.
    responders.push(() => HttpResponse.json(pageOf([row])))
    reopen()
    await openAndSettle(3)
    expect(received.flat().filter((r) => r.id === 7)).toHaveLength(1)
  })

  it('кольцо дедупа ограничено SEEN_IDS_LIMIT: самый старый id вытесняется', async () => {
    responders.push(() => HttpResponse.json(pageOf([])))
    startNotificationsSocket()
    await openAndSettle(1)

    const oldest = makeRow(7, '2026-07-19T08:00:00+05:00')
    lastSocket().emitMessage(frameOf(oldest))

    // ровно SEEN_IDS_LIMIT новых id вытесняют его: кольцо обязано быть
    // ОГРАНИЧЕННЫМ — безграничный Set на долгой сессии оператора это утечка
    for (let i = 0; i < SEEN_IDS_LIMIT; i += 1) {
      lastSocket().emitMessage(
        frameOf(makeRow(3000 + i, '2026-07-19T09:00:00+05:00')),
      )
    }

    lastSocket().emitMessage(frameOf(oldest))
    expect(received.flat().filter((r) => r.id === 7)).toHaveLength(2)
  })
})
