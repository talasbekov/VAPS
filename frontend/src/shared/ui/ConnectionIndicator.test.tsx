// @vitest-environment jsdom
// Индикатор связи (стори 11.3). jest-dom импортируется per-file: общий setup
// гоняется и в node-тестах. Статус меняем через ЖИВОЙ транспорт с инъекцией
// фейкового сокета — не мокая модуль: иначе тест доказывал бы, что компонент
// умеет читать мок, а не что связка «разрыв → текст» работает.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setCredential, clearCredential } from '../auth/credential'
import {
  __resetNotificationsSocketForTests,
  configureNotificationsSocket,
  RECONNECT_BASE_MS,
  stopNotificationsSocket,
} from '../notifications/notificationsSocket'
import type { NotificationSocket } from '../notifications/notificationsSocket'
import {
  CONNECTION_INDICATOR_LABEL,
  CONNECTION_LOST_TEXT,
  ConnectionIndicator,
  NOTIFICATIONS_DISABLED_LABEL,
  NOTIFICATIONS_DISABLED_TEXT,
} from './ConnectionIndicator'
import { CLOSE_WS_DISABLED } from '../notifications/notificationsSocket'
import { ToastProvider } from './toast'

class FakeSocket implements NotificationSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  close(): void {}

  open(): void {
    this.onopen?.(new Event('open'))
  }

  emitClose(code: number): void {
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }))
  }
}

let sockets: FakeSocket[] = []
/** Дочитка на open уходит в дефолтную 502-фикстуру и логируется best-effort —
 *  для индикатора это шум, глушим осознанно. */
let warn: ReturnType<typeof vi.spyOn>

function indicator(): HTMLElement | null {
  return screen.queryByRole('status', { name: CONNECTION_INDICATOR_LABEL })
}

beforeEach(() => {
  __resetNotificationsSocketForTests()
  sockets = []
  configureNotificationsSocket({
    socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    random: () => 1,
  })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  setCredential({ kind: 'dev', userId: 'operator-42' })
})

afterEach(() => {
  cleanup()
  stopNotificationsSocket()
  clearCredential()
  warn.mockRestore()
  vi.useRealTimers()
})

describe('ConnectionIndicator', () => {
  it('до первого open индикатора НЕТ (анти-мигание на каждой загрузке страницы)', () => {
    render(<ConnectionIndicator />)

    // статус connecting — не reconnecting: иначе «нет связи» вспыхивало бы
    // при каждом старте приложения
    expect(indicator()).toBeNull()
    expect(sockets).toHaveLength(1)
  })

  it('разрыв показывает текст «нет связи», успешный open его убирает', async () => {
    vi.useFakeTimers()
    render(<ConnectionIndicator />)

    act(() => {
      sockets[0].emitClose(1006)
    })
    const shown = indicator()
    expect(shown).not.toBeNull()
    // текстом, а не только цветом (EXPERIENCE.md#L238)
    expect(shown).toHaveTextContent(CONNECTION_LOST_TEXT)
    expect(shown).toHaveAttribute('aria-live', 'polite')

    // реконнект по расписанию → новый сокет → успешный open
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    })
    expect(sockets).toHaveLength(2)
    act(() => {
      sockets[1].open()
    })

    expect(indicator()).toBeNull()
  })

  it('не конфликтует с постоянным role="status" тоста (запрос по имени)', () => {
    render(
      <ToastProvider>
        <ConnectionIndicator />
      </ToastProvider>,
    )
    act(() => {
      sockets[0].emitClose(1006)
    })

    // в DOM ДВА role="status" — голый getByRole здесь бы упал на неоднозначности
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(indicator()).toHaveTextContent(CONNECTION_LOST_TEXT)
  })

  it('размонтирование останавливает транспорт (cleanup эффекта)', () => {
    const view = render(<ConnectionIndicator />)
    expect(sockets).toHaveLength(1)

    view.unmount()

    // висящий таймер после размонтирования открыл бы сокет заново
    act(() => {
      sockets[0].emitClose(1006)
    })
    expect(sockets).toHaveLength(1)
  })

  it('kill-switch (4503) показывает спокойный текст, НЕ «нет связи» (11.5a)', () => {
    render(<ConnectionIndicator />)

    act(() => {
      sockets[0].emitClose(CLOSE_WS_DISABLED)
    })

    const shown = screen.queryByRole('status', {
      name: NOTIFICATIONS_DISABLED_LABEL,
    })
    expect(shown).not.toBeNull()
    expect(shown).toHaveTextContent(NOTIFICATIONS_DISABLED_TEXT)
    // Оба блока не должны показаться разом — регресс «ветки перепутались».
    expect(shown).not.toHaveTextContent(CONNECTION_LOST_TEXT)
    expect(
      screen.queryByRole('status', { name: CONNECTION_INDICATOR_LABEL }),
    ).toBeNull()
    // НЕ деструктивная семантика: реально работающая доставка (REST) — не «нет связи».
    expect(shown).not.toHaveClass('text-destructive')
  })
})
