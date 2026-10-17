"use client";

// Транспорт уведомлений раздела ОМ — нативный порт транспорта Smart Josparlau
// (/ws/operations/notifications/): React-free синглтон (состояние в замыкании + Set
// слушателей), статусы idle/connecting/online/reconnecting, экспоненциальный
// backoff с полным джиттером, идемпотентные start/stop, дедуп по кольцу id.
//
// Контракт канала: WS — СИГНАЛ «обнови», истина живёт в REST. Подписчик кадров
// (hooks/use-ops-notifications) на каждый кадр инвалидирует REST-запрос, а не
// строит список из кадров.
//
// ⚠️ Фабрика сокета инжектируется. В мок-режиме реального WS нет и быть не
// может: MSW не перехватывает WebSocket, а Next-rewrites не проксируют его до
// бэкенда. Мок-«сокет» наблюдает стор рейтинг-уведомлений (sessionStorage) и
// выталкивает НОВЫЕ записи кадрами того же конверта {type, payload} — тот же
// провод, другой конец. При появлении реального бэкенда ОМ меняется только
// фабрика.
import { isOpsMockMode } from "@/lib/ops-env";
import { getAccessToken, resetAccessToken } from "@/lib/access-token";

/** Конверт кадра — как у донорского consumer'а: {type, payload}. */
export interface OpsNotificationFrame {
  id: string;
  createdAt: string;
  code: string;
  deepLink: string | null;
}

export type OpsConnectionStatus =
  | "idle"
  | "connecting"
  | "online"
  | "reconnecting";

/** Минимальная поверхность сокета — ровно она подменяется мок-фабрикой. */
export interface OpsSocket {
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Фабрика может быть асинхронной (живой сокет ждёт токен) и вернуть `null`,
 * если подключаться пока не с чем (токена нет) — канал уйдёт в backoff. */
export type OpsSocketFactory = () =>
  | OpsSocket
  | null
  | Promise<OpsSocket | null>;

/** Коды закрытия потребителя раздела (`operations/ws_consumers.py`).
 * 4403 — не пустили (отправляется ДО accept, браузер видит 1006);
 * 4503 — сокет выключен администратором: не переподключаться, лента идёт по
 * REST. */
export const CLOSE_UNAUTHENTICATED = 4403;
export const CLOSE_WS_DISABLED = 4503;

export type OpsMessageListener = (rows: OpsNotificationFrame[]) => void;

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_FACTOR = 2;
export const RECONNECT_CAP_MS = 30_000;
const SEEN_IDS_LIMIT = 500;

// --- состояние канала (замыкание модуля) ---
let status: OpsConnectionStatus = "idle";
let socket: OpsSocket | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
/** Поколение канала: stop() инкрементит его, и поздние коллбэки старого
 * сокета молча выходят. */
let epoch = 0;

const seenIds = new Set<string>();
const seenOrder: string[] = [];
const statusListeners = new Set<() => void>();
const messageListeners = new Set<OpsMessageListener>();

// --- мок-сокет: наблюдатель стора рейтинг-уведомлений ────────────────────

const RATINGS_STORE_KEY = "ops-mock-ratings";
const MOCK_ACTOR = "demo-admin";
const MOCK_POLL_MS = 1200;

function readStoreNotificationIds(): {
  /** Стор ещё не создан (он ленивый — появляется на первом запросе к API
   * рейтинга). Отличается от «создан и пуст»: до появления стора baseline
   * снимать не с чего. */
  exists: boolean;
  ids: Set<string>;
  byId: Map<string, OpsNotificationFrame>;
} {
  const ids = new Set<string>();
  const byId = new Map<string, OpsNotificationFrame>();
  try {
    const raw = sessionStorage.getItem(RATINGS_STORE_KEY);
    if (raw === null) return { exists: false, ids, byId };
    const parsed = JSON.parse(raw) as {
      notifications?: {
        id?: unknown;
        createdAt?: unknown;
        recipientUserId?: unknown;
        code?: unknown;
        deepLink?: unknown;
      }[];
    };
    for (const row of parsed.notifications ?? []) {
      if (typeof row.id !== "string" || typeof row.createdAt !== "string")
        continue;
      // Отбор по адресату — как на сервере: чужие кадры на провод не выходят.
      if (row.recipientUserId !== MOCK_ACTOR) continue;
      ids.add(row.id);
      byId.set(row.id, {
        id: row.id,
        createdAt: row.createdAt,
        code: typeof row.code === "string" ? row.code : "UNKNOWN",
        deepLink: typeof row.deepLink === "string" ? row.deepLink : null,
      });
    }
  } catch {
    // битый стор — пустой список, не краш
    return { exists: false, ids, byId };
  }
  return { exists: true, ids, byId };
}

/**
 * Мок-сокет. «Открывается» асинхронно (как настоящий), затем раз в секунду
 * сверяет стор: новые записи относительно снимка НА МОМЕНТ открытия уезжают
 * кадрами. Сеяные записи кадрами не считаются — SEED, как у транспорта SPA:
 * иначе каждая загрузка страницы выплёвывала бы в поток всю историю.
 */
function createMockSocket(): OpsSocket {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  // Стор ленивый (создаётся первым запросом к API рейтинга): baseline
  // снимается на ПЕРВОМ опросе, застающем стор существующим, — иначе сеяные
  // исторические записи уехали бы кадрами как «новые» (SEED-семантика
  // транспорта SPA: история наружу не идёт).
  let baseline: Set<string> | null = null;
  const mock: OpsSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close() {
      if (pollTimer !== null) clearInterval(pollTimer);
      if (openTimer !== null) clearTimeout(openTimer);
      pollTimer = null;
      openTimer = null;
    },
  };
  openTimer = setTimeout(() => {
    const snapshot = readStoreNotificationIds();
    if (snapshot.exists) baseline = snapshot.ids;
    mock.onopen?.({});
    pollTimer = setInterval(() => {
      const { exists, ids, byId } = readStoreNotificationIds();
      if (!exists) return;
      if (baseline === null) {
        baseline = ids;
        return;
      }
      for (const id of ids) {
        if (baseline.has(id)) continue;
        baseline.add(id);
        const frame = byId.get(id);
        if (frame === undefined) continue;
        // Тот же конверт, что у донорского consumer'а.
        mock.onmessage?.({
          data: JSON.stringify({ type: "notification", payload: frame }),
        });
      }
    }, MOCK_POLL_MS);
  }, 30);
  return mock;
}

/** В api-режиме — настоящий WebSocket same-origin к потребителю раздела
 * (`/ws/operations/notifications/`, nginx проксирует `/ws/` на бэкенд);
 * в мок-режиме — наблюдатель стора.
 *
 * Токен едет в строке запроса: браузерный `WebSocket` не умеет заголовков, а
 * потребитель проверяет его той же `JWTAuthentication`, что и REST
 * (`operations/ws_auth.py`). Прокси пишет в access-log только путь без
 * аргументов (`log_format contour_path`), поэтому токен в журнал не попадает.
 * Старый `/ws/notifications/` сюда не подходит: он пускает только по
 * Django-сессии, которой у портала (вход по JWT) нет, — отсюда и вечный 403. */
const defaultSocketFactory: OpsSocketFactory = async () => {
  if (isOpsMockMode()) return createMockSocket();
  const token = await getAccessToken();
  if (token === null) return null;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    `${scheme}//${location.host}/ws/operations/notifications/?token=${encodeURIComponent(token)}`
  ) as unknown as OpsSocket;
};

let socketFactory: OpsSocketFactory = defaultSocketFactory;
let random: () => number = Math.random;

// --- статус ---

/** Строковый литерал — ссылка стабильна по построению (контракт getSnapshot). */
export function getOpsWsStatus(): OpsConnectionStatus {
  return status;
}

export function subscribeOpsWsStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function subscribeOpsWsMessages(listener: OpsMessageListener): () => void {
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
}

function setStatus(next: OpsConnectionStatus): void {
  if (status === next) return;
  status = next;
  statusListeners.forEach((listener) => listener());
}

// --- дедуп ---

function remember(id: string): void {
  seenIds.add(id);
  seenOrder.push(id);
  while (seenOrder.length > SEEN_IDS_LIMIT) {
    const evicted = seenOrder.shift();
    if (evicted !== undefined) seenIds.delete(evicted);
  }
}

function emit(rows: OpsNotificationFrame[]): void {
  const fresh: OpsNotificationFrame[] = [];
  for (const row of rows) {
    if (seenIds.has(row.id)) continue;
    remember(row.id);
    fresh.push(row);
  }
  if (fresh.length === 0) return;
  messageListeners.forEach((listener) => listener(fresh));
}

// --- разбор кадра ---

/** Кадр живого сервера (`operations/notify_service.py`): `id` — число,
 * момент — `created_at`, код вида — `kind`. Мок-сокет шлёт донорскую форму
 * (`createdAt`/`code`); принимаются обе, чтобы один разборщик обслуживал оба
 * конца провода. */
function asFrame(value: unknown): OpsNotificationFrame | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const id =
    typeof row.id === "string"
      ? row.id
      : typeof row.id === "number"
        ? String(row.id)
        : null;
  if (id === null) return null;
  const createdAt =
    typeof row.createdAt === "string"
      ? row.createdAt
      : typeof row.created_at === "string"
        ? row.created_at
        : null;
  if (createdAt === null) return null;
  const code =
    typeof row.code === "string"
      ? row.code
      : typeof row.kind === "string"
        ? row.kind
        : "UNKNOWN";
  return {
    id,
    createdAt,
    code,
    deepLink: typeof row.deepLink === "string" ? row.deepLink : null,
  };
}

function handleFrame(event: { data: unknown }): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
  } catch {
    // битый кадр игнорируется — реестр событий будет расти, и по проводу рано
    // или поздно приедет что-то незнакомое
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.type !== "string") return;
  const row = asFrame(envelope.payload);
  if (row === null) return;
  emit([row]);
}

// --- соединение ---

function clearRetryTimer(): void {
  if (retryTimer === null) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function closeSocket(): void {
  if (socket === null) return;
  const dead = socket;
  socket = null;
  dead.onopen = null;
  dead.onmessage = null;
  dead.onclose = null;
  dead.onerror = null;
  dead.close();
}

/** ИДЕМПОТЕНТНО: браузер при неудачном подключении фаерит error, а СЛЕДОМ
 * close — без гарда это два таймера, два сокета, и дальше 4, 8, 16. Потолка
 * попыток нет: деплой рвёт все сокеты, клиент обязан вернуться сам. */
function scheduleReconnect(): void {
  if (retryTimer !== null) return;
  const delay = Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * RECONNECT_FACTOR ** attempt
  );
  attempt += 1;
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      connect();
    },
    delay * (0.5 + random() * 0.5)
  );
}

function connect(): void {
  closeSocket();
  setStatus("connecting");
  const myEpoch = epoch;
  void (async () => {
    let fresh: OpsSocket | null;
    try {
      fresh = await socketFactory();
    } catch {
      fresh = null;
    }
    if (epoch !== myEpoch) {
      // stop() успел отработать, пока ждали токен: сокет никому не нужен.
      fresh?.close();
      return;
    }
    if (fresh === null) {
      // Токена пока нет (сессия ещё грузится или истекла) — обычный backoff.
      setStatus("reconnecting");
      scheduleReconnect();
      return;
    }
    socket = fresh;
    fresh.onopen = () => {
      if (epoch !== myEpoch) return;
      attempt = 0;
      setStatus("online");
    };
    fresh.onmessage = (event) => {
      if (epoch !== myEpoch) return;
      handleFrame(event);
    };
    fresh.onclose = (event) => {
      if (epoch !== myEpoch) return;
      const code = (event as { code?: unknown } | null)?.code;
      if (code === CLOSE_WS_DISABLED) {
        // Решение администратора, не авария: лента живёт по REST, а
        // переподключение в выключенный сокет — шум в журнале.
        socket = null;
        setStatus("idle");
        return;
      }
      // Отказ рукопожатия (4403 → в браузере 1006) чаще всего значит
      // просроченный или сменившийся токен: следующая попытка обязана
      // спросить сессию заново, а не переиспользовать кэш.
      resetAccessToken();
      setStatus("reconnecting");
      scheduleReconnect();
    };
    fresh.onerror = () => {
      if (epoch !== myEpoch) return;
      setStatus("reconnecting");
      scheduleReconnect();
    };
  })();
}

/** Идемпотентен: layout монтирует под StrictMode, эффект отработает дважды. */
export function startOpsWs(): void {
  if (started) return;
  started = true;
  connect();
}

/** Идемпотентен и обязан снимать retryTimer — иначе висящий таймер откроет
 * сокет уже после размонтирования. */
export function stopOpsWs(): void {
  started = false;
  epoch += 1;
  clearRetryTimer();
  closeSocket();
  setStatus("idle");
}

export function configureOpsWs(config: {
  socketFactory?: OpsSocketFactory;
  random?: () => number;
}): void {
  if (config.socketFactory !== undefined) socketFactory = config.socketFactory;
  if (config.random !== undefined) random = config.random;
}
