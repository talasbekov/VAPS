// Транспорт уведомлений (стори 11.3): единственный клиент /ws/notifications/.
// React-free модуль-синглтон по образцу shared/auth/credential.ts (состояние в
// замыкании + Set слушателей + стабильная ссылка getSnapshot) — ни стора, ни
// ТРЕТЬЕГО Context: ARCH-FE-010 называет ровно два (Auth/Theme). Живёт в
// shared/, а не в features/notifications/, потому что подписчик статуса —
// shared/ui/AppLayout, а shared → features запрещён матрицей boundaries.
//
// Контракт канала: WS — СИГНАЛ «обнови», истина живёт в БД/REST
// (architecture.md#L327). Отсюда дочитка GET /api/notifications/?since= на
// каждый open: уведомление, родившееся при мёртвом сокете (деплой рвёт ВСЕ WS),
// доезжает по REST, а не теряется (FR-35).
//
// Осознанно НЕТ: heartbeat (браузерный WebSocket не умеет протокольный ping,
// а прикладной кадр consumer игнорирует по замыслу — liveness приходит из
// nginx ping/pong + proxy_read_timeout, стори 12.1); ветки по event.code для
// АНОНИМНОГО отказа (4403) — consumer закрывает handshake ДО accept() →
// браузер видит 1006, приватный код на провод не выходит, такая ветка была бы
// зелёной на фейке и мёртвой в проде; цикла дочитки по страницам (AC-9).
//
// Story 11.5a: ЕДИНСТВЕННЫЙ код, реально достижимый браузером, — 4503
// (kill-switch, VAPS_WS_ENABLED=0). Consumer (11.5) делает accept() ПЕРЕД
// close() именно для этого кода — в отличие от 4403 выше, здесь браузер
// получает настоящий CloseEvent{code: 4503, wasClean: true}, поэтому ветка
// по коду ниже безопасна и не повторяет ошибку «зелёная на фейке».
import { apiClient } from '../api/client'
import { ApiError } from '../api/errors'
import type { components } from '../api/schema'
import {
  clearCredential,
  getCredential,
  subscribe as subscribeCredential,
} from '../auth/credential'
import type { Credential } from '../auth/credential'

export type Notification = components['schemas']['Notification']
type Page = components['schemas']['PaginatedNotificationList']

/** Трейлинг-слеш ЗНАЧИМ: APPEND_SLASH для WS не существует, /ws/notifications
 *  не открывает сокет вовсе (test_ws_e2e.py:120-148). */
export const WS_NOTIFICATIONS_PATH = '/ws/notifications/'
/** Константы backoff экспортируются ради тестов с fake timers (образец
 *  TOAST_AUTO_DISMISS_MS): расписание ассертится целиком, а не «ретрай был». */
export const RECONNECT_BASE_MS = 1000
export const RECONNECT_FACTOR = 2
export const RECONNECT_CAP_MS = 30_000
/** Перекрытие окна дочитки (deferred-work.md:509, ревью 5.7c): created_at
 *  ставится на INSERT, видимость строки — на COMMIT, поэтому курсор по видимым
 *  строкам НИКОГДА не получит строку, закоммиченную позже с меньшим created_at.
 *  `>=` вместо `>` это не лечит — лечит только grace + дедуп по id. */
export const SINCE_GRACE_MS = 5000
/** Кольцо дедупа заметно больше страницы дочитки: иначе одна полная страница
 *  вытеснит его целиком вместе с id из grace-хвоста — ровно в том сценарии,
 *  ради которого дедуп заведён. */
export const SEEN_IDS_LIMIT = 1000
export const CATCHUP_LIMIT = 200

/** Пять значений. Статуса `unauthorized` НЕТ: отказ по identity недостижим для
 *  браузера (см. шапку) и ведёт себя как транспортный сбой. `disabled`
 *  (11.5a) — единственное состояние, различающее «WS выключен администратором»
 *  (код 4503, доставка идёт через REST-polling) от `reconnecting` («связи с
 *  сервером реально нет», обычный обрыв/1006). */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'disabled'

/** Приватный close-код kill-switch (Backend/VAPS/apps/notifications/consumers.py,
 *  `CLOSE_WS_DISABLED`) — зеркало числового значения, Python-константу
 *  фронтенд импортировать не может. */
export const CLOSE_WS_DISABLED = 4503

/** Минимальная поверхность WebSocket, которой пользуется модуль: ровно она
 *  подменяется фейком в тестах (Решение №2 — mock-socket не ставим, глобал не
 *  патчим). */
export interface NotificationSocket {
  close(): void
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
}

export type SocketFactory = (url: string) => NotificationSocket

export type MessageListener = (rows: Notification[]) => void

export interface NotificationsSocketConfig {
  socketFactory?: SocketFactory
  random?: () => number
}

// --- состояние канала (замыкание модуля) ---
let status: ConnectionStatus = 'idle'
let socket: NotificationSocket | null = null
let attempt = 0
/** max(created_at) увиденных строк, мс. Grace вычитается при сборке запроса —
 *  так монотонный клэмп работает по сырому максимуму. */
let cursorMs: number | null = null
let seeded = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let catchUpInFlight = false
/** Поколение канала. stop()/смена credential инкрементят его, и дочитка в
 *  полёте после await видит расхождение и молча выходит: у apiClient нет
 *  AbortSignal вовсе (client.ts:31-55), отменить запрос нечем. */
let epoch = 0
let started = false
let lastCredential: Credential | null = getCredential()

const seenIds = new Set<number>()
const seenOrder: number[] = []
const statusListeners = new Set<() => void>()
const messageListeners = new Set<MessageListener>()

// Дефолты инъекций. Тело фабрики НЕ исполняется на импорте — модуль грузится и
// в node-окружении (общий vitest.setup.ts), где WebSocket/location трогать нельзя.
const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url)
let socketFactory: SocketFactory = defaultSocketFactory
let random: () => number = Math.random

// --- статус ---

/** Строковый литерал — ссылка стабильна по построению; объект {status, attempt}
 *  наружу НЕ собирать (контракт getSnapshot, Ловушка 7 стори 8.6). */
export function getStatusSnapshot(): ConnectionStatus {
  return status
}

export function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function subscribeMessages(listener: MessageListener): () => void {
  messageListeners.add(listener)
  return () => {
    messageListeners.delete(listener)
  }
}

function setStatus(next: ConnectionStatus): void {
  if (status === next) return
  status = next
  statusListeners.forEach((listener) => listener())
}

// --- URL ---

/**
 * Адрес собирается из location В РАНТАЙМЕ, а не литералом: size-gate.mjs:88-93
 * флагует схемы ws:/wss: в бандле БЕЗУСЛОВНО, без анализа контекста, и спасает
 * только точное совпадение хоста с localhost/127.0.0.1 — прод-адрес не спасает
 * ничто. При динамической сборке после `//` в бандле стоит подстановка, и
 * регексп EXTERNAL не матчится. Same-origin работает и в dev: vite проксирует
 * '/ws' с ws: true.
 *
 * Query-строка — зеркало credential.ts: браузерный WebSocket физически не умеет
 * заголовок Authorization (ws.py:20-23), поэтому identity уходит параметром
 * ровно так, как её резолвит сервер (ws.py:61-80).
 */
function buildSocketUrl(credential: Credential): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query =
    credential.kind === 'jwt'
      ? `token=${encodeURIComponent(credential.token)}`
      : `user_id=${encodeURIComponent(credential.userId)}`
  return `${scheme}//${location.host}${WS_NOTIFICATIONS_PATH}?${query}`
}

// --- дедуп и курсор ---

function remember(id: number): void {
  seenIds.add(id)
  seenOrder.push(id)
  while (seenOrder.length > SEEN_IDS_LIMIT) {
    const evicted = seenOrder.shift()
    if (evicted !== undefined) seenIds.delete(evicted)
  }
}

/** Монотонный клэмп. Без него курсор откатывается назад в двух реальных
 *  сценариях: WS-строка пришла при дочитке в полёте (резолв перезапишет курсор
 *  своими, более старыми строками) и два перекрывающихся open. */
function advanceCursor(ms: number): void {
  cursorMs = cursorMs === null ? ms : Math.max(cursorMs, ms)
}

/**
 * ЕДИНСТВЕННЫЙ вход канала: и WS-кадр, и дочитка идут сюда. Две ветки означали
 * бы два расходящихся курсора и дедуп, работающий только на одной из них.
 *
 * `deliver: false` — SEED первого подключения: строки нужны только чтобы
 * инициализировать курсор и кольцо, наружу они не идут (иначе каждая загрузка
 * страницы выплёвывала бы в поток всю видимую историю).
 */
function emit(rows: Notification[], deliver: boolean): void {
  const fresh: Notification[] = []
  for (const row of rows) {
    if (seenIds.has(row.id)) continue
    remember(row.id)
    const ms = Date.parse(row.created_at)
    // Date.parse, а не лексикографика: формат на проводе +05:00, и равенство
    // смещений у всех строк — не контракт.
    if (!Number.isNaN(ms)) advanceCursor(ms)
    fresh.push(row)
  }
  if (!deliver || fresh.length === 0) return
  messageListeners.forEach((listener) => listener(fresh))
}

// --- защитный разбор ---

function asNotification(value: unknown): Notification | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'number') return null
  if (typeof row.created_at !== 'string') return null
  // payload в схеме — unknown (schema.d.ts:1353); 11.3 его не читает, только
  // переносит, типизировать доменную форму не пытаемся.
  return value as Notification
}

/** Тело read-API разбираем защитно (образец parseSubmissionList): не массив
 *  results — это пустая дочитка, а не краш. */
function readPage(body: unknown): {
  rows: Notification[]
  count: number
  served: number
} {
  if (typeof body !== 'object' || body === null)
    return { rows: [], count: 0, served: 0 }
  const page = body as Record<string, unknown>
  if (!Array.isArray(page.results)) return { rows: [], count: 0, served: 0 }
  const rows: Notification[] = []
  for (const item of page.results) {
    const row = asNotification(item)
    if (row !== null) rows.push(row)
  }
  return {
    rows,
    // count сверяется с СЫРОЙ длиной results (served), а не с rows после
    // защитного отсева: иначе одна битая строка в странице давала бы ложное
    // «пропущено больше 200» при count == results.length.
    count: typeof page.count === 'number' ? page.count : rows.length,
    served: page.results.length,
  }
}

/** В лог — только класс сбоя: ни ПДн, ни токена (он же в URL сокета). */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return `${error.name} ${error.status}`
  if (error instanceof Error) return error.name
  return 'UnknownError'
}

// --- дочитка ---

function buildCatchUpQuery(): string {
  if (!seeded) {
    // SEED: одна строка — только чтобы поставить курсор.
    return 'limit=1'
  }
  if (cursorMs === null) {
    // За всю сессию строк не было: since не добавляем, и эмитить можно всё —
    // на момент seed'а этих строк не существовало.
    return `limit=${CATCHUP_LIMIT}`
  }
  // toISOString (UTC, Z) + encodeURIComponent: сырое +05:00 без кодирования
  // превратит + в пробел → 400, и catch ниже проглотил бы это молча.
  const since = new Date(cursorMs - SINCE_GRACE_MS).toISOString()
  return `since=${encodeURIComponent(since)}&limit=${CATCHUP_LIMIT}`
}

/**
 * Дочитка best-effort (AC-8): её сбой не трогает сокет, не двигает курсор и не
 * запускает backoff — сигнальный канал не имеет права ронять то, что работает.
 */
async function catchUp(): Promise<void> {
  if (catchUpInFlight) return // вторая дочитка не стартует, пока первая в полёте
  catchUpInFlight = true
  const myEpoch = epoch
  const wasSeeded = seeded
  try {
    const body = await apiClient.get<Page>(
      `/api/notifications/?${buildCatchUpQuery()}`,
    )
    if (epoch !== myEpoch) return // stop()/смена credential во время полёта
    const { rows, count, served } = readPage(body)
    if (count > served && wasSeeded) {
      // Догонять страницы через offset НЕ пытаемся: истина — REST/БД, центр
      // уведомлений читает полный список штатной пагинацией, а цикл дочитки —
      // ровно тот код, который на ревью 10.2 уронил воркер по OOM.
      console.warn(
        `notifications: за разрыв пропущено больше ${CATCHUP_LIMIT} уведомлений (всего ${count}) — в поток попали только последние`,
      )
    }
    // Ответ приходит -created_at, значит разворачиваем. [...].reverse(), НЕ
    // toReversed(): toReversed — Firefox 115, цель сборки firefox100, а
    // eslint-plugin-compat методы Array не покрывает.
    emit([...rows].reverse(), wasSeeded)
    seeded = true
  } catch (error) {
    // NetworkError вне иерархии ApiError (errors.ts:102-108) — ловим всё,
    // по типу не ветвимся; единственная ветка — канон 401-семантики.
    if (error instanceof ApiError && error.status === 401) clearCredential()
    console.warn(
      `notifications: дочитка не удалась (best-effort, сокет не тронут): ${describeFailure(error)}`,
    )
  } finally {
    if (epoch === myEpoch) catchUpInFlight = false
  }
}

// --- соединение ---

function clearRetryTimer(): void {
  if (retryTimer === null) return
  clearTimeout(retryTimer)
  retryTimer = null
}

function closeSocket(): void {
  if (socket === null) return
  const dead = socket
  socket = null
  dead.onopen = null
  dead.onmessage = null
  dead.onclose = null
  dead.onerror = null
  dead.close()
}

/**
 * ИДЕМПОТЕНТНО. Браузер при неудачном подключении фаерит error, а СЛЕДОМ close —
 * без гарда это два таймера, два сокета, и дальше 4, 8, 16.
 *
 * Потолка попыток нет: деплой рвёт все сокеты, клиент обязан вернуться сам.
 * Джиттер полный (0.5..1.0), random инъектируется ради детерминизма тестов.
 */
function scheduleReconnect(): void {
  if (retryTimer !== null) return
  const delay = Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * RECONNECT_FACTOR ** attempt,
  )
  attempt += 1
  retryTimer = setTimeout(
    () => {
      retryTimer = null
      connect()
    },
    delay * (0.5 + random() * 0.5),
  )
}

function handleDrop(): void {
  setStatus('reconnecting')
  scheduleReconnect()
}

function handleFrame(event: MessageEvent): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof event.data === 'string' ? event.data : '')
  } catch {
    console.warn('notifications: битый кадр WS проигнорирован')
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  // Конверт {type, payload} описан руками: WS вне OpenAPI. payload — та же
  // проекция NotificationSerializer, что и в read-API (запинено бэком), поэтому
  // строки из WS и из дочитки льются в один поток без нормализации. Кадр без
  // строкового type — не конверт 11.2, игнорируется (клиент type-agnostic по
  // ЗНАЧЕНИЮ, но не по форме).
  const envelope = parsed as Record<string, unknown>
  if (typeof envelope.type !== 'string') return
  const row = asNotification(envelope.payload)
  if (row === null) return
  emit([row], true)
}

function connect(): void {
  // Заменяемый сокет отцепляется ЗДЕСЬ, а не полагается на epoch: у него та же
  // эпоха, и его поздний close (в браузере error и close — пара, close может
  // опоздать за пределы окна retry-таймера) флапал бы статус и плодил бы
  // фантомный реконнект при уже живом преемнике.
  closeSocket()
  const credential = getCredential()
  if (credential === null) {
    // Без credential сокет не открывается вовсе: сервер всё равно откажет.
    setStatus('idle')
    return
  }
  setStatus('connecting')
  const myEpoch = epoch
  const fresh = socketFactory(buildSocketUrl(credential))
  socket = fresh
  fresh.onopen = () => {
    if (epoch !== myEpoch) return
    attempt = 0
    setStatus('online')
    void catchUp()
  }
  fresh.onmessage = (event) => {
    if (epoch !== myEpoch) return
    handleFrame(event)
  }
  fresh.onclose = (event) => {
    if (epoch !== myEpoch) return
    // 11.5a: kill-switch — терминальное состояние ДЛЯ ЭТОГО соединения, не
    // транспортный сбой. НЕ проходит через handleDrop()/scheduleReconnect():
    // долбить backoff-таймером по флагу, который сменит администратор (не
    // сеть), было бы бессмысленно (AC-2/AC-6). Единственный выход —
    // stop()+start() (перезагрузка страницы).
    if (event.code === CLOSE_WS_DISABLED) {
      setStatus('disabled')
      return
    }
    handleDrop()
  }
  fresh.onerror = () => {
    if (epoch !== myEpoch) return
    handleDrop()
  }
}

/** Идемпотентен: main.tsx монтирует под StrictMode, эффект отработает дважды. */
export function startNotificationsSocket(): void {
  if (started) return
  started = true
  connect()
}

/** Идемпотентен и обязан снимать retryTimer — иначе висящий таймер откроет
 *  сокет уже после размонтирования. */
export function stopNotificationsSocket(): void {
  started = false
  epoch += 1
  catchUpInFlight = false
  clearRetryTimer()
  closeSocket()
  setStatus('idle')
}

export function configureNotificationsSocket(
  config: NotificationsSocketConfig,
): void {
  if (config.socketFactory !== undefined) socketFactory = config.socketFactory
  if (config.random !== undefined) random = config.random
}

/**
 * Только для тестов: точка СИНХРОНИЗАЦИИ («дочитка осела»), а не замена
 * ассертам. Курсор проверяется по ЗНАЧЕНИЮ since в URL запроса — опечатка в
 * имени параметра молча вернула бы всю историю со статусом 200
 * (deferred-work.md:524), и ассерт по внутреннему полю это пропустил бы.
 */
export function __notificationsSocketStateForTests(): {
  status: ConnectionStatus
  attempt: number
  seeded: boolean
  cursorMs: number | null
  catchUpInFlight: boolean
} {
  return { status, attempt, seeded, cursorMs, catchUpInFlight }
}

/**
 * Сброс состояния между тестами. Инъекции (socketFactory/random) НАМЕРЕННО не
 * восстанавливаются: общий vitest.setup.ts ставит инертную фабрику один раз на
 * уровне модуля, и возврат к настоящему WebSocket увёл бы чужие тесты в сеть.
 */
export function __resetNotificationsSocketForTests(): void {
  stopNotificationsSocket()
  attempt = 0
  cursorMs = null
  seeded = false
  seenIds.clear()
  seenOrder.length = 0
  lastCredential = getCredential()
  statusListeners.clear()
  messageListeners.clear()
}

/**
 * Смена credential перезапускает канал И СБРАСЫВАЕТ ВСЁ его состояние. Сброс
 * курсора — самостоятельное требование: курсор пользователя A, доживший до
 * сессии B, отфильтровал бы дочитку B по чужому времени и молча съел его
 * уведомления (класс «фантомный флаг переживает смену контекста», ловившийся
 * ревью 10.2 и 10.3).
 *
 * Подписка регистрируется на импорте, а модуль импортируется общим
 * vitest.setup.ts → он загружен в КАЖДОМ тест-файле, включая окружение node,
 * где location не существует. Поэтому при started === false обработчик только
 * чистит состояние и НЕ трогает location/WebSocket.
 */
subscribeCredential(() => {
  const next = getCredential()
  // setCredential уведомляет ВСЕГДА, даже при повторной установке того же
  // значения (credential.ts:71-78) — на no-op сокет не дёргаем.
  if (credentialKey(next) === credentialKey(lastCredential)) return
  lastCredential = next
  epoch += 1
  catchUpInFlight = false
  clearRetryTimer()
  closeSocket()
  attempt = 0
  cursorMs = null
  seeded = false
  seenIds.clear()
  seenOrder.length = 0
  if (!started) {
    setStatus('idle')
    return
  }
  connect()
})

function credentialKey(credential: Credential | null): string {
  if (credential === null) return ''
  return credential.kind === 'jwt'
    ? `jwt:${credential.token}`
    : `dev:${credential.userId}`
}
