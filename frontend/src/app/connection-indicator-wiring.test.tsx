// @vitest-environment jsdom
// Разводка индикатора связи в РЕАЛЬНОЙ композиции Providers + AppRoutes
// (стори 11.3, AC-10).
//
// Зачем отдельно от ConnectionIndicator.test.tsx: тот доказывает, что компонент
// умеет показать «нет связи», но НЕ то, что он смонтирован в шапке приложения и
// что транспорт запускает именно приложение. Ровно эта дыра ловилась ревью
// 10.2/10.3 находкой «гард стоит не там, где путь реально проходит»: юнит
// зелёный, а в приложении путь не проходит вовсе. Удаление <ConnectionIndicator />
// из AppLayout сегодня не роняет ни одного теста.
//
// Отдельный файл, а не правка AppLayout.test.tsx: AC-14 требует, чтобы тот
// оставался зелёным БЕЗ изменений.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import {
  __resetNotificationsSocketForTests,
  configureNotificationsSocket,
  stopNotificationsSocket,
} from '../shared/notifications/notificationsSocket'
import type { NotificationSocket } from '../shared/notifications/notificationsSocket'
import {
  CONNECTION_INDICATOR_LABEL,
  CONNECTION_LOST_TEXT,
} from '../shared/ui/ConnectionIndicator'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

/** Инъекция фабрики вместо инертной из общего setup: тесту нужен управляемый
 *  разрыв, а не «сокет, который никогда ничего не делает». */
class FakeSocket implements NotificationSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  close(): void {}

  emitClose(code: number): void {
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }))
  }
}

let sockets: FakeSocket[] = []

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
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions: ['status.view'] }),
    ),
  )
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  stopNotificationsSocket()
  clearCredential()
  sessionStorage.clear()
  vi.useRealTimers()
})

describe('AppLayout: разводка индикатора связи (AC-10)', () => {
  it('шапка приложения запускает транспорт и показывает «нет связи» на разрыве', async () => {
    render(
      <Providers>
        <MemoryRouter initialEntries={[ROUTES.home]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )

    // дожидаемся самой шапки — по её постоянному элементу, а не по таймауту
    expect(
      await screen.findByRole('button', {
        name: 'Уведомления (появятся в E11)',
      }),
    ).toBeInTheDocument()

    // транспорт запущен ПРИЛОЖЕНИЕМ, а не тестом
    expect(sockets).toHaveLength(1)
    // до разрыва индикатора нет: иначе «нет связи» мигало бы на каждой загрузке
    expect(
      screen.queryByRole('status', { name: CONNECTION_INDICATOR_LABEL }),
    ).toBeNull()

    act(() => {
      sockets[0].emitClose(1006)
    })

    // в DOM теперь ДВА role="status" (постоянный у ToastProvider) — именно
    // поэтому индикатор запрашивается по accessible name
    expect(screen.getAllByRole('status').length).toBeGreaterThan(1)
    expect(
      screen.getByRole('status', { name: CONNECTION_INDICATOR_LABEL }),
    ).toHaveTextContent(CONNECTION_LOST_TEXT)
  })
})
