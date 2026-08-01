// @vitest-environment jsdom
// Story 10.2 (QA-добор) — AC-5, вторая половина: ПУСТОЙ каталог статус-типов.
//
// Отдельный файл, а не тест в DailyUpdatePage.test.tsx: catalogEmpty выводится
// из импортированной константы, подменить её можно только vi.mock, а он
// поднимается на весь модуль-файл.
//
// Закрывает дефер 9.4 «statusOptions=[] без индикации»: пустой каталог обязан
// (а) сказать об этом вслух, (б) ЗАПРЕТИТЬ отправку — иначе оператор отправил
// бы день, статусы которого не из чего выбрать.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import type { paths } from '../../shared/api/schema'
import { employeesListFixture } from '../../shared/api/testing/handlers'
import { server } from '../../shared/api/testing/server'
import { ToastProvider } from '../../shared/ui/toast'
import { DailyUpdatePage } from './DailyUpdatePage'

// Каталог пуст — ровно тот случай, который сегодня не воспроизводится иначе
// (константа непуста by design; сеть за ней появится в 10.1b).
vi.mock('./statusTypes', () => ({ STATUS_TYPE_OPTIONS: [] }))

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type EmployeesResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']

const origOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
)
const origOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth',
)

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
  if (origOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight)
  if (origOffsetWidth)
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
})

afterEach(() => cleanup())

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const NAMES = ['Абдуллаев Асхат Маратович', 'Бекова Гульмира Ержановна']

it('пустой каталог: role="alert" + отправка ЗАПРЕЩЕНА (ни одного POST)', async () => {
  server.use(
    http.get('*/api/core/divisions/', () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: DIVISION_ID,
            organization: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
            type_code: 'DEPARTMENT',
            name: 'Первый отдел',
            code: 'DIV-1',
          },
        ],
      } satisfies DivisionsResponse),
    ),
    http.get('*/api/core/employees/', () =>
      HttpResponse.json({
        count: NAMES.length,
        next: null,
        previous: null,
        results: NAMES.map((full_name, i) => ({
          ...employeesListFixture.results[0],
          id: `emp-${i}`,
          full_name,
        })),
      } satisfies EmployeesResponse),
    ),
  )
  const bodies: unknown[] = []
  server.use(
    http.post('*/api/operations/statuses/bulk/', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ created: 1 }, { status: 201 })
    }),
  )

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  const user = userEvent.setup()
  render(<DailyUpdatePage />, { wrapper: Wrapper })

  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)
  await screen.findByTestId('changed-counter')

  // (а) сказано вслух, и именно тревогой — не текстом в потоке.
  // Матч по началу строки: реализация ставит точку в конце («…не загружен.»),
  // AC-5 цитирует строку без неё — пунктуация не должна решать судьбу теста.
  const alert = screen.getByText(/^Справочник статусов не загружен/)
  expect(alert).toBeInTheDocument()
  expect(alert).toHaveAttribute('role', 'alert')

  // Дельту делаем через ПЕРИОД: статус в пустом каталоге не выбрать, а дельта
  // нужна — иначе контейнер отсечёт отправку сам (0 дельт → bulk не зовётся) и
  // «ноль POST» ничего бы не доказывал.
  await user.keyboard('{ArrowRight}{Enter}')
  fireEvent.change(screen.getByLabelText('Период'), {
    target: { value: '2026-07-25' },
  })
  await user.keyboard('{Enter}')
  // Положительный контроль: дельта РЕАЛЬНО есть и кнопка живая — значит ноль
  // POST ниже объясняется гардом каталога, а не тем, что нажимать было нечего.
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 1 из 2',
  )

  await user.click(screen.getByText('Сохранить правки'))

  // (б) отправки не было и не будет: ждём и убеждаемся, что тишина устойчива
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(bodies).toHaveLength(0)
  expect(screen.queryByText(/Применено/)).not.toBeInTheDocument()
})
