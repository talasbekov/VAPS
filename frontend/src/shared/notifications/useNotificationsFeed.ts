// Владелец запроса уведомлений (стори 11.4): единственное место, где объявлен
// useQuery с ключом ['notifications'], и единственная точка, где WS-поток 11.3
// дотекает до кэша. ARCH-FE-010 предписывает буквально «уведомления = WS →
// queryClient.setQueryData» — ни стора, ни копии серверных данных в useState.
//
// Живёт в shared/, а не в features/notifications/, по той же причине, что и
// транспорт 11.3: монтирует потребителя shared/ui/AppLayout, а shared →
// features запрещён матрицей boundaries (ARCH-FE-013).
//
// Хук вызывается РОВНО ОДИН РАЗ — из NotificationBell. Два useQuery с одним
// ключом и разными queryFn/enabled — известная ловушка react-query, уже
// зафиксированная в репозитории (DailyUpdatePage.tsx:196-199, 10.3 Решение №7):
// «один владелец, вниз — данные».
//
// Осознанно НЕТ: отметки прочтения (бэкенд-поверхности не существует — GET-only,
// см. schema.d.ts:793-807; адреса выноса — 11.4a бэк + 11.4b UI-мутация);
// start/stopNotificationsSocket — жизненным циклом транспорта владеет
// ConnectionIndicator, второй владелец убил бы сокет обоим.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { components } from '../api/schema'
import {
  getStatusSnapshot,
  subscribeMessages,
  subscribeStatus,
} from './notificationsSocket'

export type Notification = components['schemas']['Notification']
export type NotificationPage =
  components['schemas']['PaginatedNotificationList']

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const
/** Экспортируется, чтобы тест не хардкодил число, а обрезка хвоста в merge и
 *  строка запроса не разъехались между собой. */
export const NOTIFICATIONS_LIMIT = 50
/** Интервал REST-опроса, когда WS выключен kill-switch'ем (11.5a) — зеркало
 *  TRAFFIC_LIGHT_POLL_MS (TrafficLightTreePage.tsx). НЕ всегда-включённый (в
 *  отличие от трафик-света): пока WS жив, второй параллельный канал
 *  обновлений не нужен — polling включается РОВНО в статусе 'disabled'. */
export const NOTIFICATIONS_POLL_MS = 30_000

/**
 * Защитный разбор строки (образец notificationsSocket.ts::asNotification и
 * daySubmission.ts::parseSubmissionList). Битая строка не роняет панель — её
 * отбрасывают: реестр знает 25 типов событий, KindEnum сегодня один, и рано или
 * поздно по проводу приедет что-то незнакомое.
 */
function isNotification(value: unknown): value is Notification {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'number' && typeof row.created_at === 'string'
}

/** Date.parse, а не лексикографика: на проводе смещение +05:00, и равенство
 *  смещений у всех строк — не контракт (та же причина, что в транспорте 11.3).
 *  Неразбираемая дата уезжает в конец, а не роняет сортировку через NaN. */
function timeOf(row: Notification): number {
  const ms = Date.parse(row.created_at)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Порядок КОМАНДУЕТ СЕРВЕР, а не интуиция «новые сверху»: селектор отдаёт
 * order_by("-created_at", "id") (selectors.py:43), то есть при равном created_at
 * МЕНЬШИЙ id идёт первым. Интуитивное b.id - a.id разъехало бы клиент с
 * сервером — список «прыгал» бы на каждом рефетче.
 */
function compareNotifications(a: Notification, b: Notification): number {
  return timeOf(b) - timeOf(a) || a.id - b.id
}

/**
 * Чистое ядро слияния (образец «чистое ядро + 1:1 тест»: grammar.ts,
 * daySubmission.ts, prefill.ts) — тестируется напрямую, без React.
 *
 * prev === undefined → кэш НЕ засеивать: дельта не список, и посеяв её, панель
 * показала бы «всю историю = 1 строка». Дочитку запускает вызывающий хук
 * (invalidateQueries), потому что истина — REST/БД, а WS лишь сигнал «обнови».
 *
 * Дедуп по id обязателен ЗДЕСЬ, а не «уже сделан в 11.3»: кольцо seenIds
 * транспорта дедуплицирует свой канал, а строка, приехавшая в HTTP-ответе
 * useQuery, транспорту неизвестна — его дочитка ?since= с grace-окном 5 с
 * честно принесёт её ещё раз. Пересечение каналов — замысел, не баг.
 */
export function mergeNotificationPage(
  prev: NotificationPage | undefined,
  rows: readonly unknown[],
): NotificationPage | undefined {
  if (prev === undefined) return prev

  const known = Array.isArray(prev.results)
    ? prev.results.filter(isNotification)
    : []
  const seen = new Set<number>(known.map((row) => row.id))

  const fresh: Notification[] = []
  for (const row of rows) {
    if (!isNotification(row)) continue
    if (seen.has(row.id)) continue
    seen.add(row.id) // дедуп и ВНУТРИ пачки, а не только против кэша
    fresh.push(row)
  }

  // Ту же ССЫЛКУ, а не эквивалентный объект: иначе каждый дубликат из дочитки
  // дёргал бы ререндер всей шапки.
  if (fresh.length === 0) return prev

  return {
    ...prev,
    // ровно на число НОВЫХ строк: дубликаты счётчик не раздувают
    count: prev.count + fresh.length,
    // сортируем КОПИЮ: поля Notification readonly, да и react-query полагается
    // на смену ссылки. Хвост режем — панель не растёт за долгую сессию.
    results: [...known, ...fresh]
      .sort(compareNotifications)
      .slice(0, NOTIFICATIONS_LIMIT),
  }
}

export interface NotificationsFeed {
  notifications: Notification[]
  unreadCount: number
  /** Непрочитанных БОЛЬШЕ, чем видно на странице → к числу дорисовывается «+».
   *  Честнее, чем врать точным числом про то, что за пределами страницы. */
  hasMoreUnread: boolean
  isPending: boolean
  isError: boolean
}

export function useNotificationsFeed(): NotificationsFeed {
  const queryClient = useQueryClient()

  // ЧТЕНИЕ статуса, не владение (11.5a): тот же стор, что уже читает
  // ConnectionIndicator — start/stopNotificationsSocket остаются ТОЛЬКО там
  // (второй владелец жизненного цикла убил бы сокет обоим, докстринг выше).
  const status = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getStatusSnapshot,
  )

  // enabled-гард не нужен: AppLayout смонтирован под <RequireAuth> (App.tsx:36-39),
  // без credential до колокольчика не доходит вовсе. retry: false — канал
  // best-effort ровно как дочитка 11.3; самовосстановление даёт
  // refetchOnWindowFocus и ветка инвалидейта ниже (Решение №4).
  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () =>
      apiClient.get<NotificationPage>(
        `/api/notifications/?limit=${NOTIFICATIONS_LIMIT}`,
      ),
    retry: false,
    // 11.5a AC-3: polling ТОЛЬКО пока WS выключен kill-switch'ем — иначе два
    // параллельных источника обновлений без нужды. Фоновая вкладка не платит
    // за картину, которую никто не смотрит (refetchIntervalInBackground не
    // включаем, тот же довод, что у TRAFFIC_LIGHT_POLL_MS).
    refetchInterval: status === 'disabled' ? NOTIFICATIONS_POLL_MS : false,
  })

  useEffect(() => {
    // Подписка ровно одна: StrictMode монтирует эффект дважды, поэтому
    // unsubscribe в cleanup обязателен (Ловушка 7 стори 8.5).
    return subscribeMessages((rows) => {
      const had = queryClient.getQueryData<NotificationPage>(
        NOTIFICATIONS_QUERY_KEY,
      )
      queryClient.setQueryData<NotificationPage>(
        NOTIFICATIONS_QUERY_KEY,
        (prev) => mergeNotificationPage(prev, rows),
      )
      // Пустой кэш: дельту не сеем (см. mergeNotificationPage), но просим
      // список — это же чинит и провалившуюся первую загрузку (retry: false).
      // Зациклиться не может: после успешной дочитки prev определён.
      if (had === undefined) {
        void queryClient.invalidateQueries({
          queryKey: NOTIFICATIONS_QUERY_KEY,
        })
      }
    })
  }, [queryClient])

  const page = query.data
  return useMemo(() => {
    const notifications = Array.isArray(page?.results)
      ? page.results.filter(isNotification)
      : []
    const unreadCount = notifications.filter(
      (row) => row.read_at === null,
    ).length
    return {
      notifications,
      unreadCount,
      // «+» только когда за страницей ТОЧНО есть ещё непрочитанные: сервер
      // счётчика unread не отдаёт (его заведёт 11.4a), поэтому уверенность есть
      // лишь если непрочитано ВСЁ загруженное, а всего строк больше.
      hasMoreUnread:
        page !== undefined &&
        unreadCount > 0 &&
        unreadCount === notifications.length &&
        page.count > notifications.length,
      isPending: query.isPending,
      isError: query.isError,
    }
  }, [page, query.isPending, query.isError])
}
