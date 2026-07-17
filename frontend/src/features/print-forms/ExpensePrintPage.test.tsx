// @vitest-environment jsdom
// Story 10.7 — компонент-тесты печатной формы расхода (AC-1, AC-2, AC-4, AC-5).
// jsdom CSS не парсит (Ловушка 11) — ассертим РАЗМЕТКУ (classList, структура);
// computed styles судит e2e (e2e/print.spec.ts). Тоталы фикстуры НАМЕРЕННО ≠
// Σ строк — различающий ассерт «ИТОГО литерально из totals» (проба (д)).
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ErrorEnvelope } from '../../shared/api/errors'
import { server } from '../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../shared/auth/credential'
import { ExpensePrintPage } from './ExpensePrintPage'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const CHILD_ID = '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f'
const DATE = '2026-07-15'
const PERIOD_PATH = '*/api/operations/expense-reports/period/'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

function columnsFixture(overrides: Record<string, number> = {}) {
  return {
    SICK: 1,
    VACATION: 2,
    COMMAND: 0,
    TRAINING: 0,
    OTHER: 0,
    DETACHED: 0,
    AFTER_DUTY: 0,
    BEFORE_DUTY: 0,
    ON_DUTY: 3,
    PENDING: 0,
    IN_SERVICE: 4,
    ...overrides,
  }
}

// totals (99/88/77/+66) НАМЕРЕННО не сумма строк — фронт не пересчитывает.
function periodFixture() {
  return {
    pages: [
      {
        business_date: DATE,
        totals: {
          staff_total: 99,
          list_total: 88,
          vacancies: 77,
          attached: 66,
          columns: columnsFixture({ IN_SERVICE: 55 }),
        },
        rows: [
          {
            division_id: DIVISION_ID,
            name: 'Управление А',
            staff_total: 12,
            list_total: 10,
            vacancies: 2,
            attached: 1,
            columns: columnsFixture(),
          },
          {
            division_id: CHILD_ID,
            name: 'Отдел Б',
            staff_total: 7,
            list_total: 7,
            vacancies: 0,
            attached: 0,
            columns: columnsFixture({ IN_SERVICE: 1 }),
          },
        ],
      },
    ],
  }
}

function envelope(code: string, message: string): ErrorEnvelope {
  return {
    error_code: code,
    message,
    details: {},
    request_id: null,
    timestamp: '2026-07-15T12:00:00+05:00',
  }
}

function Harness({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderPage(search = `?division_id=${DIVISION_ID}&date=${DATE}`) {
  setCredential({ kind: 'dev', userId: 'print-tester' })
  return render(
    <Harness>
      <MemoryRouter initialEntries={[`/print/expense${search}`]}>
        <ExpensePrintPage />
      </MemoryRouter>
    </Harness>,
  )
}

function mockPeriod(body: unknown) {
  server.use(http.get(PERIOD_PATH, () => HttpResponse.json(body as never)))
}

async function findTitle() {
  return screen.findByText(
    'Управление А ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ',
  )
}

describe('ExpensePrintPage: рендер по контракту секции 77 (AC-1)', () => {
  it('заголовок, шапка (фикс + 12 колонок канона), строки, ИТОГО из totals, ATTACHED «+N»', async () => {
    mockPeriod(periodFixture())
    renderPage()
    expect(await findTitle()).toBeInTheDocument()

    const headers = Array.from(document.querySelectorAll('thead th')).map(
      (th) => th.textContent,
    )
    expect(headers).toEqual([
      '№',
      'Управление',
      'По штату',
      'По списку',
      'Вакансии',
      'В строю',
      'На дежурстве',
      'После дежурства',
      'В командировке',
      'Учёба/соревнования/конференция',
      'В отпуске',
      'На больничном',
      'Прикомандирован',
      'Откомандирован',
      'Перед дежурством',
      'Иное',
      'Уточняется',
    ])

    const bodyRows = Array.from(document.querySelectorAll('tbody tr')).map(
      (tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
    )
    expect(bodyRows).toEqual([
      // № | имя | штат | список | вакансии | 12 колонок (ATTACHED — «+1»)
      ['1', 'Управление А', '12', '10', '2',
        '4', '3', '0', '0', '0', '2', '1', '+1', '0', '0', '0', '0'],
      ['2', 'Отдел Б', '7', '7', '0',
        '1', '3', '0', '0', '0', '2', '1', '+0', '0', '0', '0', '0'],
    ])

    // ИТОГО в tfoot — ЛИТЕРАЛЬНО из totals (99/88/77 ≠ суммам строк 19/17/2)
    const tfootCells = Array.from(
      document.querySelectorAll('tfoot td'),
    ).map((td) => td.textContent)
    expect(tfootCells).toEqual([
      '', 'ИТОГО', '99', '88', '77',
      '55', '3', '0', '0', '0', '2', '1', '+66', '0', '0', '0', '0',
    ])

    // примечание 8pt про неофициальность
    expect(document.querySelector('.print-note')?.textContent).toContain(
      'не официальный документ',
    )
  })
})

describe('ExpensePrintPage: печатный канон (AC-2)', () => {
  it('classList КАЖДОГО элемента ⊆ /^print-/ — ни одного UI-класса на бумаге', async () => {
    mockPeriod(periodFixture())
    renderPage()
    await findTitle()
    const offenders = Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => !/^print-/.test(cls))
    expect(offenders).toEqual([])
  })

  it('экранная подсказка (Ctrl+P, альбомная) несёт print-screen-hint — на бумагу не попадает', async () => {
    mockPeriod(periodFixture())
    renderPage()
    await findTitle()
    const hint = screen.getByText(/Ctrl\+P/)
    expect(hint).toHaveClass('print-screen-hint')
    expect(hint.textContent).toContain('альбомная')
  })
})

describe('ExpensePrintPage: параметры и ошибки (AC-4)', () => {
  it('битые/отсутствующие query-параметры → подсказка, запрос НЕ уходит, таблицы нет', async () => {
    const calls: string[] = []
    server.use(
      http.get(PERIOD_PATH, ({ request }) => {
        calls.push(request.url)
        return HttpResponse.json(periodFixture() as never)
      }),
    )
    for (const search of [
      '',
      '?division_id=не-uuid&date=2026-07-15',
      `?division_id=${DIVISION_ID}&date=15.07.2026`,
      `?division_id=${DIVISION_ID}`,
    ]) {
      renderPage(search)
      expect(
        await screen.findByText(/Неверные или отсутствующие параметры/),
      ).toHaveClass('print-screen-hint')
      expect(document.querySelector('table')).not.toBeInTheDocument()
      cleanup()
    }
    // flush: даём гипотетическому ошибочному запросу дойти до msw-хендлера —
    // негативный ассерт без слива был бы гоночным (ревью BH#5).
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([])
  })

  it('возврат фокуса окна (Ctrl+P) НЕ перезапрашивает данные (ревью BH#1/ECH#9)', async () => {
    const calls: string[] = []
    server.use(
      http.get(PERIOD_PATH, ({ request }) => {
        calls.push(request.url)
        return HttpResponse.json(periodFixture() as never)
      }),
    )
    renderPage()
    await findTitle()
    expect(calls).toHaveLength(1)
    // эмуляция потери/возврата фокуса диалогом печати (focusManager RQ
    // слушает visibilitychange/focus на window)
    window.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toHaveLength(1)
  })

  it('422 REPORT_NO_DATA_FOR_DATE → message бэка на экране, таблицы нет', async () => {
    server.use(
      http.get(PERIOD_PATH, () =>
        HttpResponse.json(
          envelope(
            'REPORT_NO_DATA_FOR_DATE',
            'Запрошена дата до начала данных — нет ни списка, ни статусов.',
          ),
          { status: 422 },
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText(/дата до начала данных/),
    ).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('404 DIVISION_NOT_FOUND → message бэка, таблицы нет (ревью F1)', async () => {
    server.use(
      http.get(PERIOD_PATH, () =>
        HttpResponse.json(
          envelope('DIVISION_NOT_FOUND', 'Подразделение не найдено.'),
          { status: 404 },
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText(/Подразделение не найдено/),
    ).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('403 PERMISSION_DENIED → message бэка, таблицы нет', async () => {
    server.use(
      http.get(PERIOD_PATH, () =>
        HttpResponse.json(
          envelope('PERMISSION_DENIED', 'Нет права на подразделение.'),
          { status: 403 },
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText(/Нет права на подразделение/),
    ).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('400 VALIDATION_ERROR (будущая дата) → message бэка, таблицы нет', async () => {
    server.use(
      http.get(PERIOD_PATH, () =>
        HttpResponse.json(
          envelope('VALIDATION_ERROR', 'Период не может уходить в будущее.'),
          { status: 400 },
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText(/не может уходить в будущее/),
    ).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('loading-состояние: экранная подсказка «Загрузка», таблицы нет', async () => {
    server.use(http.get(PERIOD_PATH, () => delay('infinite')))
    renderPage()
    const loading = await screen.findByText(/Загрузка данных/)
    expect(loading).toHaveClass('print-screen-hint')
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })
})

describe('ExpensePrintPage: STOP на дрейфе shape (AC-5)', () => {
  it('отсутствующий ключ канона в columns → ошибка контракта, НЕ нули/частичная таблица', async () => {
    const page = periodFixture().pages[0]
    delete (page.rows[0].columns as Record<string, unknown>).ON_DUTY
    mockPeriod({ pages: [page] })
    renderPage()
    expect(
      await screen.findByText(/не соответствуют контракту|не соответствует контракту/),
    ).toBeInTheDocument()
    expect(document.querySelector('table')).not.toBeInTheDocument()
  })

  it('пустые rows → заголовок без имени + экранная пометка (имя не выдумывается)', async () => {
    const fixture = periodFixture()
    fixture.pages[0].rows = []
    mockPeriod(fixture)
    renderPage()
    expect(
      await screen.findByText('ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ'),
    ).toBeInTheDocument()
    const note = screen.getByText(/Имя подразделения не получено/)
    expect(note).toHaveClass('print-screen-hint')
    await waitFor(() =>
      expect(document.querySelector('tbody tr')).not.toBeInTheDocument(),
    )
  })
})
