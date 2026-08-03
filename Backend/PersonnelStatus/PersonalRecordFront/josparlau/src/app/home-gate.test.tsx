// @vitest-environment jsdom
// «/» после входа (Этап 71): живой прогон поймал, что администратор попадал на
// заглушку «Дашборд „Расход" — появится в E9–E10» первым же экраном. Тому,
// кому доступен командный центр, «/» обязан вести туда; заглушка остаётся
// только линии status.view без оперативной посадочной.
//
// ⚠️ Файл обязан лежать в src/app/ (импорт AppRoutes из features запрещён
// boundaries — образец print-placement-routing.test.tsx).
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyLimitOffsetPage } from '../shared/api/testing/envelopes'
import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { AppRoutes } from './App'
import { Providers } from './providers'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

function grantPermissions(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'home-gate-user' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

function renderHome() {
  render(
    <Providers>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('«/» после входа (Этап 71)', () => {
  it('с правом на командный центр «/» уводит на него, а не на заглушку', async () => {
    grantPermissions(['status.view', 'ops.dashboard.view', 'ops.security_event.view'])
    server.use(
      // Командному центру хватает пустого реестра — важен сам переход.
      http.get('*/api/ops/security-events/', () =>
        HttpResponse.json(emptyLimitOffsetPage()),
      ),
    )
    renderHome()
    // Заголовок раздела: «Готовность охранных мероприятий» (kicker — КОМАНДНЫЙ
    // ЦЕНТР). Ждём именно контент чанка — маршрут code-split.
    expect(
      await screen.findByText('Готовность охранных мероприятий'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Экран появится в E9–E10')).not.toBeInTheDocument()
  })

  it('persona с командным центром, но БЕЗ status.view — тоже редирект, а не отказ (ревью Этапа 73)', async () => {
    grantPermissions(['ops.dashboard.view', 'ops.security_event.view'])
    server.use(
      http.get('*/api/ops/security-events/', () =>
        HttpResponse.json(emptyLimitOffsetPage()),
      ),
    )
    renderHome()
    expect(
      await screen.findByText('Готовность охранных мероприятий'),
    ).toBeInTheDocument()
  })

  it('линия status.view без командного центра остаётся на своей заглушке', async () => {
    grantPermissions(['status.view'])
    renderHome()
    expect(await screen.findByText('Экран появится в E9–E10')).toBeInTheDocument()
  })
})
