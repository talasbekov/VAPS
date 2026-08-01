// Центр уведомлений в шапке (стори 11.4): кнопка-колокольчик со счётчиком
// непрочитанных + раскрывающаяся панель последних уведомлений. Данные — из
// useNotificationsFeed (один владелец запроса), живое обновление — оттуда же
// через setQueryData на WS-событие.
//
// Панель — DISCLOSURE, а не меню и не модалка (Решение №2). Radix DropdownMenu
// не переиспользуется намеренно: он навешивает role="menu"/menuitem и
// roving-focus по стрелкам, а список уведомлений — не набор команд (скринридер
// объявил бы «меню, 5 пунктов»), плюс 11.4b добавит в строку кнопку
// «прочитано», а интерактив внутри menuitem некорректен. Побочно disclosure
// тестируется в jsdom без единого полифилла, которых Radix требует пофайлово.
// Модалку не делаем — jsdom не эмулирует модальность, ассерт был бы вакуумным
// (дефер 9.5, подтверждён 9.9, повтор 10.3 Решение №5).
//
// Состояния загрузки/ошибки/пустоты живут ВНУТРИ панели: при закрытом
// колокольчике шапка не приносит в DOM ни лишнего role="status" (их там уже два
// — тост и ConnectionIndicator), ни role="alert" (его ассертит чужой
// app-layout.qa.test.tsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '../lib/cn'
import { useNotificationsFeed } from '../notifications/useNotificationsFeed'
import type { Notification } from '../notifications/useNotificationsFeed'
import { Button } from './Button'

/** Экспорт строк — чтобы тест не дублировал литерал, а смена текста стоила
 *  одну правку. Литералы предложены стори: таблица пустых состояний UX
 *  (EXPERIENCE.md#L196-200) строк для уведомлений не содержит вовсе. */
export const NOTIFICATIONS_LABEL = 'Уведомления'
export const NOTIFICATIONS_PANEL_ID = 'notifications-panel'
export const NOTIFICATIONS_EMPTY_TEXT = 'Уведомлений нет'
export const NOTIFICATIONS_LOADING_TEXT = 'Загрузка уведомлений…'
export const NOTIFICATIONS_LOADING_LABEL = 'Загрузка уведомлений'
export const NOTIFICATIONS_ERROR_TEXT = 'Не удалось загрузить уведомления'
export const NOTIFICATION_UNREAD_TEXT = 'Не прочитано'

/**
 * Человеческая метка типа живёт на клиенте, потому что по проводу едет КОД:
 * API отдаёт KindEnum (schema.d.ts:1364-1365), а verbose_name — в TextChoices
 * бэкенда (models.py:23). Строка не выдумана — она оттуда.
 *
 * Фолбэк на сырой код обязателен: реестр знает 25 типов событий, KindEnum
 * сегодня ОДИН, и как только эпики 14-20 добавят эмиттеров, схема расширится, а
 * карта отстанет. Падать или показывать пусто при этом нельзя.
 */
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  SUBMISSION_LAGGING: 'Отставание по сдаче',
}

/**
 * 'YYYY-MM-DD' → 'DD.MM.YYYY' ПЕРЕСТАНОВКОЙ СТРОКИ, без Date.
 *
 * new Date('2026-07-19') разбирается как UTC-полночь, и в таймзоне западнее
 * Гринвича отрисовалось бы 18-е. Ровно этот класс уже кусал проект (баг теста
 * test_vacancies_endpoint).
 */
export function formatBusinessDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

/**
 * 'YYYY-MM-DDTHH:MM:SS+05:00' → 'HH:MM', взятые ИЗ САМОЙ СТРОКИ.
 *
 * 🔴 new Date(created_at).toLocaleTimeString()/getHours() ЗАПРЕЩЕНЫ: бэкенд
 * рендерит created_at в Asia/Qyzylorda со смещением +05:00 (settings.py:147,
 * байт-в-байт одинаково в REST и в WS-конверте). Date сконвертирует это в
 * таймзону машины — у оператора одно время, в CI (UTC) другое, то есть тест,
 * зелёный локально и бессмысленный в гейте.
 *
 * Intl.* не заводим: в src/ его сегодня нет ни разу, а локале-зависимый рендер
 * ради двух полей — цена без выгоды.
 */
export function formatCreatedAtTime(value: string): string {
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(value)
  if (match === null) return ''
  return `${match[1]}:${match[2]}`
}

function NotificationRow({ row }: { row: Notification }) {
  const label = NOTIFICATION_KIND_LABELS[row.kind] ?? row.kind
  const time = formatCreatedAtTime(row.created_at)
  const isUnread = row.read_at === null

  return (
    <li className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {/* признак непрочитанного — ТЕКСТОМ, не точкой и не цветом
            (EXPERIENCE.md#L238: цвет не единственный сигнал) */}
        {isUnread && (
          <span className="shrink-0 text-xs font-medium text-destructive">
            {NOTIFICATION_UNREAD_TEXT}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span>{formatBusinessDate(row.business_date)}</span>
        {time !== '' && <span>{time}</span>}
      </div>
    </li>
  )
}

export function NotificationBell() {
  const { notifications, unreadCount, hasMoreUnread, isPending, isError } =
    useNotificationsFeed()
  const [isOpen, setIsOpen] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Бейдж молчит, пока число неизвестно: показывать «0» или врать числом во
  // время загрузки/ошибки хуже, чем не показывать ничего.
  const showBadge = !isPending && !isError && unreadCount > 0
  const badgeText = `${unreadCount}${hasMoreUnread ? '+' : ''}`
  const buttonLabel = showBadge
    ? `${NOTIFICATIONS_LABEL}, непрочитанных: ${badgeText}`
    : NOTIFICATIONS_LABEL

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      // фокус ВОЗВРАЩАЕТСЯ на колокольчик, а не падает в body
      // (EXPERIENCE.md#L219)
      bellRef.current?.focus()
    }

    function handleClick(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      // клик по самой кнопке обрабатывает её onClick — иначе закрытие тут и
      // переключение там взаимно погасились бы
      if (bellRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      setIsOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', handleClick)
    }
  }, [isOpen])

  const rows = useMemo(
    () => notifications.map((row) => <NotificationRow key={row.id} row={row} />),
    [notifications],
  )

  return (
    <div className="relative">
      <Button
        ref={bellRef}
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={buttonLabel}
        aria-expanded={isOpen}
        aria-controls={NOTIFICATIONS_PANEL_ID}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Bell />
        {showBadge && (
          // число ВИДИМО текстом; красный фон — только оформление
          // (макеты key-rashod.html:119-122): цвет не единственный сигнал
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-destructive-foreground">
            {badgeText}
          </span>
        )}
      </Button>
      {isOpen && (
        <div
          ref={panelRef}
          id={NOTIFICATIONS_PANEL_ID}
          role="region"
          aria-label={NOTIFICATIONS_LABEL}
          className={cn(
            'absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
          )}
        >
          {isPending && (
            // различающий aria-label обязателен: role="status" в DOM уже два
            // (тост и ConnectionIndicator), а роль status не берёт имя из
            // содержимого — голый getByRole('status') был бы неоднозначен
            <p
              role="status"
              aria-label={NOTIFICATIONS_LOADING_LABEL}
              className="px-3 py-4 text-sm text-muted-foreground"
            >
              {NOTIFICATIONS_LOADING_TEXT}
            </p>
          )}
          {isError && (
            <p
              role="alert"
              aria-label={NOTIFICATIONS_ERROR_TEXT}
              className="px-3 py-4 text-sm text-destructive"
            >
              {NOTIFICATIONS_ERROR_TEXT}
            </p>
          )}
          {!isPending && !isError && notifications.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {NOTIFICATIONS_EMPTY_TEXT}
            </p>
          )}
          {notifications.length > 0 && (
            <ul className="max-h-96 overflow-y-auto">{rows}</ul>
          )}
        </div>
      )}
    </div>
  )
}
