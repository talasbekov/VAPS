// @vitest-environment jsdom
// Колокольчик и панель (стори 11.4): бейдж непрочитанных, раскрытие/закрытие,
// клавиатура и фокус, состояния Query, защитный рендер строк.
//
// Свой QueryClient с retry: false (канон DaySubmissionPanel.test.tsx:68-72) —
// иначе дефолтные три ретрая тащили бы ~7 с на каждый негативный кейс.
// Дефолтную 502-фикстуру НЕ переопределяем глобально, только server.use
// внутри своих тестов (Ловушка 1).
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { JsonBodyType } from 'msw'
import { server } from '../api/testing/server'
import { clearCredential, setCredential } from '../auth/credential'
import { NOTIFICATIONS_LIMIT } from '../notifications/useNotificationsFeed'
import type {
  Notification,
  NotificationPage,
} from '../notifications/useNotificationsFeed'
import {
  NOTIFICATION_UNREAD_TEXT,
  NOTIFICATIONS_EMPTY_TEXT,
  NOTIFICATIONS_ERROR_TEXT,
  NOTIFICATIONS_LABEL,
  NOTIFICATIONS_LOADING_LABEL,
  NOTIFICATIONS_LOADING_TEXT,
  NOTIFICATIONS_PANEL_ID,
  NotificationBell,
} from './NotificationBell'

// ASCII в credential (заголовок X-User-Id), кириллица — в телах фикстур
const DEV_CREDENTIAL = { kind: 'dev', userId: 'operator-42' } as const

const OUTSIDE_TEXT = 'Снаружи панели'

function makeRow(id: number, over: Partial<Notification> = {}): Notification {
  return {
    id,
    recipient: 'Ким Оператор Сергеевич',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-07-19',
    payload: { laggard_division_ids: [] },
    read_at: null,
    created_at: '2026-07-19T09:00:00+05:00',
    ...over,
  }
}

function pageOf(rows: Notification[], count = rows.length): NotificationPage {
  return { count, next: null, previous: null, results: rows }
}

/** Ответ списка. results типизирован свободно — защитный рендер обязан
 *  переживать тело, противоречащее схеме (AC-9). */
function respondWith(body: JsonBodyType, status = 200): void {
  server.use(
    http.get('*/api/notifications/', () => HttpResponse.json(body, { status })),
  )
}

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
      <button type="button">{OUTSIDE_TEXT}</button>
    </QueryClientProvider>,
  )
}

function bell(): HTMLElement {
  return screen.getByRole('button', { name: /^Уведомления/ })
}

beforeEach(() => {
  setCredential(DEV_CREDENTIAL)
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('NotificationBell: счётчик непрочитанных (AC-3)', () => {
  it('test_badge_counts_only_unread: считается read_at === null, а не длина списка', async () => {
    respondWith(
      pageOf([
        makeRow(1),
        makeRow(2, { read_at: '2026-07-19T10:00:00+05:00' }),
        makeRow(3),
      ]),
    )
    renderBell()

    await waitFor(() => {
      expect(bell()).toHaveAccessibleName('Уведомления, непрочитанных: 2')
    })
    // число ВИДИМО текстом, а не только цветом (EXPERIENCE.md#L238)
    expect(within(bell()).getByText('2')).toBeInTheDocument()
  })

  it('test_badge_hidden_when_all_read: ноль непрочитанных → бейджа нет вовсе (не «0»)', async () => {
    respondWith(
      pageOf([makeRow(1, { read_at: '2026-07-19T10:00:00+05:00' })]),
    )
    renderBell()

    // дожидаемся, что данные приехали — иначе ассерт был бы про pending
    const user = userEvent.setup()
    await user.click(bell())
    await screen.findByRole('listitem')

    expect(bell()).toHaveAccessibleName(NOTIFICATIONS_LABEL)
    expect(within(bell()).queryByText('0')).not.toBeInTheDocument()
  })

  it('test_badge_shows_plus_when_page_is_capped: за страницей есть ещё непрочитанные → «50+»', async () => {
    const rows = Array.from({ length: NOTIFICATIONS_LIMIT }, (_, index) =>
      makeRow(index + 1),
    )
    respondWith(pageOf(rows, 137))
    renderBell()

    await waitFor(() => {
      expect(bell()).toHaveAccessibleName(
        `Уведомления, непрочитанных: ${NOTIFICATIONS_LIMIT}+`,
      )
    })
    expect(
      within(bell()).getByText(`${NOTIFICATIONS_LIMIT}+`),
    ).toBeInTheDocument()
  })

  it('test_badge_absent_while_loading_and_on_error: числа, которого не знаем, не показываем', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('*/api/notifications/', async () => {
        await gate
        return HttpResponse.json(pageOf([makeRow(1)]))
      }),
    )
    renderBell()

    // pending: ответ ещё удерживается — бейджа нет
    expect(bell()).toHaveAccessibleName(NOTIFICATIONS_LABEL)
    release()
    await waitFor(() => {
      expect(bell()).toHaveAccessibleName('Уведомления, непрочитанных: 1')
    })

    // error: своя изоляция — новый рендер поверх 500
    cleanup()
    respondWith({ detail: 'сбой' }, 500)
    renderBell()
    const user = userEvent.setup()
    await user.click(bell())
    await screen.findByRole('alert', { name: NOTIFICATIONS_ERROR_TEXT })
    expect(bell()).toHaveAccessibleName(NOTIFICATIONS_LABEL)
  })
})

describe('NotificationBell: раскрытие, клавиатура и фокус (AC-4, AC-5)', () => {
  it('test_panel_opens_and_closes_on_click: disclosure, а не меню', async () => {
    respondWith(pageOf([makeRow(1)]))
    const user = userEvent.setup()
    renderBell()

    // закрыто: панели в DOM нет, aria-expanded отражает состояние
    expect(bell()).toHaveAttribute('aria-expanded', 'false')
    expect(bell()).toHaveAttribute('aria-controls', NOTIFICATIONS_PANEL_ID)
    // это НЕ меню (Решение №2): Radix-семантика сюда не приезжает
    expect(bell()).not.toHaveAttribute('aria-haspopup')
    expect(
      screen.queryByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).not.toBeInTheDocument()

    await user.click(bell())

    const panel = screen.getByRole('region', { name: NOTIFICATIONS_LABEL })
    expect(panel).toHaveAttribute('id', NOTIFICATIONS_PANEL_ID)
    expect(bell()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(bell())

    expect(
      screen.queryByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).not.toBeInTheDocument()
    expect(bell()).toHaveAttribute('aria-expanded', 'false')
  })

  it('test_escape_closes_and_returns_focus_to_the_bell: фокус не падает в body', async () => {
    respondWith(pageOf([makeRow(1)]))
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())
    expect(
      screen.getByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).toBeInTheDocument()

    // 🔴 УВОДИМ ФОКУС С КОЛОКОЛЬЧИКА ДО Escape — без этого шага тест вакуумен:
    // click уже оставил фокус на кнопке, и «возврат» проходил бы туда, где
    // фокус и так стоит. Красная проба это поймала (мутация «Escape закрывает,
    // но фокус не возвращает» оставалась ЗЕЛЁНОЙ) — ровно форма вакуума №3
    // ретро E9. Tab панель не закрывает: она disclosure, а не модалка.
    await user.tab()
    const outside = screen.getByRole('button', { name: OUTSIDE_TEXT })
    expect(document.activeElement).toBe(outside)

    await user.keyboard('{Escape}')

    expect(
      screen.queryByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).not.toBeInTheDocument()
    // ТОЛЬКО toBe(колокольчик): activeElement?.closest(...) !== null был бы
    // зелёным при фокусе в никуда (инцидент 9.9)
    expect(document.activeElement).toBe(bell())
  })

  it('test_outside_click_closes_the_panel: клик мимо панели закрывает', async () => {
    respondWith(pageOf([makeRow(1)]))
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())
    expect(
      screen.getByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: OUTSIDE_TEXT }))

    expect(
      screen.queryByRole('region', { name: NOTIFICATIONS_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('NotificationBell: строка и защитный рендер (AC-8, AC-9)', () => {
  it('test_row_renders_kind_label_and_dates: время берётся ИЗ СТРОКИ, без таймзонной конверсии', async () => {
    // 🔴 Две строки с ОДИНАКОВЫМ настенным временем и РАЗНЫМИ смещениями:
    // они разнесены на 8 часов абсолютного времени, поэтому любой рендер через
    // new Date(...).getHours()/toLocaleTimeString() покажет два РАЗНЫХ времени
    // при ЛЮБОЙ таймзоне машины. Ассерт «оба показывают 23:30» краснеет и
    // локально, и в UTC-гейте — иначе проба зависела бы от TZ прогона.
    respondWith(
      pageOf([
        makeRow(1, { created_at: '2026-07-19T23:30:00+05:00' }),
        makeRow(2, {
          created_at: '2026-07-19T23:30:00-03:00',
          business_date: '2026-07-19',
        }),
      ]),
    )
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    for (const item of items) {
      // метка типа — из TextChoices бэкенда (models.py:23), не выдумана
      expect(within(item).getByText('Отставание по сдаче')).toBeInTheDocument()
      // business_date перестановкой строки: 'YYYY-MM-DD' → 'DD.MM.YYYY'
      expect(within(item).getByText('19.07.2026')).toBeInTheDocument()
      expect(within(item).getByText('23:30')).toBeInTheDocument()
      expect(
        within(item).getByText(NOTIFICATION_UNREAD_TEXT),
      ).toBeInTheDocument()
    }
  })

  it('test_unknown_kind_falls_back_to_raw_code: реестр знает 25 типов, KindEnum — один', async () => {
    respondWith(
      pageOf([
        makeRow(1, {
          kind: 'ROSTER_MISMATCH' as Notification['kind'],
        }),
      ]),
    )
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())

    const item = await screen.findByRole('listitem')
    // сырой код, а не пусто и не падение
    expect(within(item).getByText('ROSTER_MISMATCH')).toBeInTheDocument()
  })

  it('test_malformed_rows_do_not_crash_the_panel: битые строки отбрасываются', async () => {
    respondWith({
      count: 5,
      next: null,
      previous: null,
      results: [
        null,
        'строка вместо объекта',
        { id: 'не число', created_at: '2026-07-19T09:00:00+05:00' },
        // прошла защитный разбор (id + created_at), но без business_date —
        // рендер обязан пережить и это
        { id: 7, kind: 'SUBMISSION_LAGGING', created_at: '2026-07-19T09:00:00+05:00', read_at: null },
        makeRow(9),
      ],
    })
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // «+» здесь ЧЕСТЕН, а не артефакт: сервер заявил count = 5, а до панели
    // доехали 2 строки — за пределами показанного действительно есть ещё
    expect(bell()).toHaveAccessibleName('Уведомления, непрочитанных: 2+')
  })
})

describe('NotificationBell: состояния Query внутри панели (AC-7)', () => {
  it('test_empty_error_loading_states: запрос ПО ACCESSIBLE NAME, не голый getByRole', async () => {
    // пусто
    respondWith(pageOf([]))
    const user = userEvent.setup()
    renderBell()
    await user.click(bell())
    expect(
      await screen.findByText(NOTIFICATIONS_EMPTY_TEXT),
    ).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()

    // загрузка: ответ удерживается до release — тайминга нет, есть ворота
    cleanup()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('*/api/notifications/', async () => {
        await gate
        return HttpResponse.json(pageOf([]))
      }),
    )
    renderBell()
    await user.click(bell())
    // role="status" в приложении уже двое (тост и ConnectionIndicator), и роль
    // не берёт имя из содержимого — различающий aria-label обязателен
    const loading = screen.getByRole('status', {
      name: NOTIFICATIONS_LOADING_LABEL,
    })
    expect(loading).toHaveTextContent(NOTIFICATIONS_LOADING_TEXT)
    release()
    await screen.findByText(NOTIFICATIONS_EMPTY_TEXT)

    // ошибка: шапка и колокольчик при этом живы
    cleanup()
    respondWith({ detail: 'сбой' }, 500)
    renderBell()
    await user.click(bell())
    const alert = await screen.findByRole('alert', {
      name: NOTIFICATIONS_ERROR_TEXT,
    })
    expect(alert).toHaveTextContent(NOTIFICATIONS_ERROR_TEXT)
    expect(bell()).toBeEnabled()
  })
})
