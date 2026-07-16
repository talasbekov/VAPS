// @vitest-environment jsdom
// Story 10.5 — экран №3 «Расход» /reports (AC-6..12): параметры (дата +
// пресет «На завтра» + селект подразделения из history.divisions), текущий
// выпуск за дату (404 = состояние «не выпущен», НЕ ошибка-баннер), выпуск
// (201 → карточка ИЗ ОТВЕТА + инвалидация обеих queries), блок-панель
// «кто не сдал» из 422 TOMORROW_BLOCKED (laggards UUID-only by-design),
// ошибки выпуска по кодам (все non-overridable → mutation.error, ConflictDialog
// НЕ участвует, generic-тост не срабатывает), журнал с цепочкой «взамен»,
// гейт скачивания правом document.view. RTL + msw, Harness из shared-примитивов
// (ARCH-FE-013 — app/Providers сюда не импортировать).
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ErrorEnvelope } from '../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../shared/api/useApiMutation'
import { server } from '../../shared/api/testing/server'
import {
  clearCredential,
  getCredential,
  setCredential,
} from '../../shared/auth/credential'
import { ToastProvider } from '../../shared/ui/toast'
import type {
  ExpenseHistoryResponse,
  HistoryIssue,
  IssuedExpenseReport,
} from './expenseReport'
import { addDaysIso, todayLocalIso } from './expenseReport'
import { ExpenseReportPage } from './ExpenseReportPage'

function Harness({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

configure({ asyncUtilTimeout: 3000 })

// jsdom не реализует URL.createObjectURL — стаб per-file (download-канал).
URL.createObjectURL = vi.fn(() => 'blob:mock-url')
URL.revokeObjectURL = vi.fn()

beforeEach(() => {
  // usePermissions гейтится credential-ом (useMe enabled) — без него запрос
  // ['me'] не уходит вовсе.
  setCredential({ kind: 'dev', userId: 'orgd-1' })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

// --- Фикстуры ------------------------------------------------------------------

const TIMESTAMP = '2026-07-16T09:00:00+05:00'
const TODAY = todayLocalIso()
const TOMORROW = addDaysIso(TODAY, 1)
const DIV_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const DIV_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const ATT_1 = 'cccccccc-0000-0000-0000-000000000003'
const ISSUE_1 = 'dddddddd-0000-0000-0000-000000000004'
const ISSUE_2 = 'dddddddd-0000-0000-0000-000000000005'
const ISSUE_3 = 'dddddddd-0000-0000-0000-000000000006'
const LAG_1 = '11111111-0000-0000-0000-00000000000a'
const LAG_2 = '22222222-0000-0000-0000-00000000000b'

const HISTORY_PATH = '*/api/operations/expense-reports/history/'
const EXPENSE_PATH = '*/api/operations/expense-reports/'
const PERMISSIONS_PATH = '*/api/operations/my-permissions/'

function envelope(
  error_code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error_code, message, details, request_id: null, timestamp: TIMESTAMP }
}

const notIssuedEnvelope = envelope(
  'ENTITY_NOT_FOUND',
  'Расход за дату не выпущен.',
)

function makeIssue(overrides: Partial<HistoryIssue> = {}): HistoryIssue {
  return {
    id: ISSUE_1,
    doc_type: 'расход',
    number: 1,
    year: 2026,
    business_date: TODAY,
    division_id: DIV_A,
    submission_id: 7,
    submission_version: 1,
    status: 'ISSUED',
    attachment_id: ATT_1,
    sha256: 'a'.repeat(64),
    reason: '',
    created_at: TIMESTAMP,
    supersedes: null,
    ...overrides,
  }
}

function makeCurrent(
  overrides: Partial<IssuedExpenseReport> = {},
): IssuedExpenseReport {
  return {
    id: ISSUE_1,
    doc_type: 'расход',
    number: 1,
    year: 2026,
    business_date: TODAY,
    division_id: DIV_A,
    submission_id: 7,
    submission_version: 1,
    status: 'ISSUED',
    attachment_id: ATT_1,
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

function oneDivisionHistory(
  issues: HistoryIssue[] = [],
  count: number = issues.length,
): ExpenseHistoryResponse {
  return {
    divisions: [{ division_id: DIV_A, name: 'Отдел А' }],
    count,
    issues,
  }
}

/** Права экрана: generate (роут) + document.view (скачивание) по умолчанию. */
function servePermissions(
  permissions: string[] = ['daily_report.generate', 'document.view'],
) {
  server.use(
    http.get(PERMISSIONS_PATH, () => HttpResponse.json({ permissions })),
  )
}

function serveHistory(fixture: () => ExpenseHistoryResponse): () => number {
  let requests = 0
  server.use(
    http.get(HISTORY_PATH, () => {
      requests += 1
      return HttpResponse.json(fixture())
    }),
  )
  return () => requests
}

/** GET point-lookup: последовательность ответов (последний повторяется). */
function serveCurrent(
  ...responses: Array<IssuedExpenseReport | 'not-issued'>
): void {
  let call = 0
  server.use(
    http.get(EXPENSE_PATH, () => {
      const response = responses[Math.min(call, responses.length - 1)]
      call += 1
      if (response === 'not-issued') {
        return HttpResponse.json(notIssuedEnvelope, { status: 404 })
      }
      return HttpResponse.json(response)
    }),
  )
}

/** POST выпуск: фиксирует тела; ответ — фабрикой (статус/конверт). */
function servePost(
  respond: () => Response | Promise<Response>,
): () => unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post(EXPENSE_PATH, async ({ request }) => {
      bodies.push(await request.json())
      return respond()
    }),
  )
  return () => bodies
}

function renderPage() {
  return render(
    <Harness>
      <ExpenseReportPage />
    </Harness>,
  )
}

async function findIssueButton() {
  return await screen.findByRole('button', { name: 'Сформировать' })
}

// --- AC-6: параметры и текущий выпуск --------------------------------------------

describe('параметры (AC-6)', () => {
  it('date-input дефолт сегодня; «На завтра» ставит завтрашнюю дату', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    renderPage()

    const dateInput = await screen.findByLabelText('Дата')
    expect(dateInput).toHaveValue(TODAY)
    fireEvent.click(screen.getByRole('button', { name: 'На завтра' }))
    expect(dateInput).toHaveValue(TOMORROW)
  })

  it('селект из history.divisions; единственное видимое → автовыбор', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    renderPage()

    const select = await screen.findByLabelText('Подразделение')
    await waitFor(() => expect(select).toHaveValue(DIV_A))
    expect(
      within(select as HTMLElement).getByText('Отдел А'),
    ).toBeInTheDocument()
  })

  it('несколько видимых → селект без автовыбора (явный выбор, зеркало 10.3)', async () => {
    servePermissions()
    serveHistory(() => ({
      divisions: [
        { division_id: DIV_A, name: 'Отдел А' },
        { division_id: DIV_B, name: 'Отдел Б' },
      ],
      count: 0,
      issues: [],
    }))
    renderPage()

    const select = await screen.findByLabelText('Подразделение')
    expect(select).toHaveValue('')
    expect(
      screen.getByText('Выберите подразделение, чтобы увидеть выпуск за дату.'),
    ).toBeInTheDocument()
  })
})

describe('текущий выпуск за дату (AC-6)', () => {
  it('point-lookup 200 → карточка выпуска + «Скачать .docx»; sha256 не показывается', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue({ number: 3 })]))
    serveCurrent(makeCurrent({ number: 3 }))
    renderPage()

    expect(await screen.findByText('Выпущен: Исх.№ 3/2026')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Скачать .docx' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
  })

  it('404 ENTITY_NOT_FOUND → состояние «не выпущен» + активная «Сформировать», БЕЗ ошибки-баннера', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    renderPage()

    expect(
      await screen.findByText('Расход за дату не выпущен.'),
    ).toBeInTheDocument()
    expect(await findIssueButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// --- AC-7: выпуск успешен ----------------------------------------------------------

describe('выпуск (AC-7)', () => {
  it('201 → карточка ИЗ ОТВЕТА, обе queries инвалидируются, ровно один POST с телом {division_id, business_date}', async () => {
    servePermissions()
    let issued = false
    const historyCalls = serveHistory(() =>
      issued ? oneDivisionHistory([makeIssue({ number: 5 })]) : oneDivisionHistory(),
    )
    serveCurrent('not-issued')
    const bodies = servePost(() => {
      issued = true
      return HttpResponse.json(makeCurrent({ number: 5 }), { status: 201 })
    })
    renderPage()

    fireEvent.click(await findIssueButton())

    // Карточка из 201-ответа (point-lookup остаётся 404 — не источник).
    expect(await screen.findByText('Выпущен: Исх.№ 5/2026')).toBeInTheDocument()
    expect(bodies()).toEqual([
      { division_id: DIV_A, business_date: TODAY },
    ])
    // Инвалидация history: журнал показывает новую строку.
    const journal = await screen.findByTestId('issues-journal')
    expect(
      await within(journal).findByText('Исх.№ 5/2026'),
    ).toBeInTheDocument()
    expect(historyCalls()).toBeGreaterThanOrEqual(2)
  })

  it('кнопка disabled на isPending', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(async () => {
      await delay(150)
      return HttpResponse.json(makeCurrent(), { status: 201 })
    })
    renderPage()

    const button = await findIssueButton()
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(await screen.findByText('Выпущен: Исх.№ 1/2026')).toBeInTheDocument()
  })
})

describe('гонка смены контекста при POST в полёте (ревью 10.5, blind+edge)', () => {
  it('201 пришёл ПОСЛЕ смены даты → карточка чужого контекста НЕ показывается', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    let postResolved = false
    servePost(async () => {
      await delay(150)
      postResolved = true
      return HttpResponse.json(makeCurrent({ number: 9 }), { status: 201 })
    })
    renderPage()

    fireEvent.click(await findIssueButton())
    // До прихода 201 пользователь уводит контекст на завтра.
    fireEvent.change(screen.getByLabelText('Дата'), {
      target: { value: TOMORROW },
    })
    await waitFor(() => expect(postResolved).toBe(true))

    // Новый контекст: «не выпущен»; стейл-карточка за TODAY не всплывает.
    expect(
      await screen.findByText('Расход за дату не выпущен.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Выпущен: Исх.№ 9/2026'),
    ).not.toBeInTheDocument()
  })
})

describe('деградация queries (ревью 10.5, blind+edge)', () => {
  it('5xx point-lookup → явная ошибка с «Повторить», НЕ вечная «Загрузка выпуска…»', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    let call = 0
    server.use(
      http.get(EXPENSE_PATH, () => {
        call += 1
        if (call === 1) {
          return HttpResponse.json(
            envelope('INTERNAL_ERROR', 'Внутренняя ошибка.'),
            { status: 500 },
          )
        }
        return HttpResponse.json(notIssuedEnvelope, { status: 404 })
      }),
    )
    renderPage()

    expect(
      await screen.findByText('Не удалось загрузить выпуск за дату.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Загрузка выпуска…')).not.toBeInTheDocument()
    // «Повторить» бьёт в тот же ключ — второй ответ 404 → состояние «не выпущен».
    fireEvent.click(screen.getByRole('button', { name: 'Повторить запрос' }))
    expect(
      await screen.findByText('Расход за дату не выпущен.'),
    ).toBeInTheDocument()
  })

  it('5xx на ПЕРВОЙ загрузке журнала → сообщение с «Повторить», не тупик «Данные недоступны.»', async () => {
    servePermissions()
    let call = 0
    server.use(
      http.get(HISTORY_PATH, () => {
        call += 1
        if (call === 1) {
          return HttpResponse.json(
            envelope('INTERNAL_ERROR', 'Внутренняя ошибка.'),
            { status: 500 },
          )
        }
        return HttpResponse.json(oneDivisionHistory())
      }),
    )
    serveCurrent('not-issued')
    renderPage()

    expect(
      await screen.findByText('Не удалось загрузить журнал.'),
    ).toBeInTheDocument()
    const journal = screen.getByTestId('issues-journal')
    fireEvent.click(within(journal).getByRole('button', { name: 'Повторить' }))
    expect(
      await screen.findByText('Расходы ещё не формировались'),
    ).toBeInTheDocument()
  })

  it('очищенный date-input → «Укажите дату», НЕ вечная «Загрузка выпуска…»', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    renderPage()

    const dateInput = await screen.findByLabelText('Дата')
    await screen.findByText('Расход за дату не выпущен.')
    fireEvent.change(dateInput, { target: { value: '' } })
    expect(
      await screen.findByText('Укажите дату, чтобы увидеть выпуск.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Загрузка выпуска…')).not.toBeInTheDocument()
  })

  it('загрузка point-lookup — индикатор «Загрузка выпуска…» (AC-12)', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    server.use(
      http.get(EXPENSE_PATH, async () => {
        await delay(120)
        return HttpResponse.json(notIssuedEnvelope, { status: 404 })
      }),
    )
    renderPage()

    expect(await screen.findByText('Загрузка выпуска…')).toBeInTheDocument()
    expect(
      await screen.findByText('Расход за дату не выпущен.'),
    ).toBeInTheDocument()
  })
})

// --- AC-8: блокировка «на завтра» ---------------------------------------------------

describe('блокировка «на завтра» (AC-8)', () => {
  it('422 TOMORROW_BLOCKED → блок-панель: сообщение бэка + список UUID + счётчик; НЕ generic-alert, ConflictDialog закрыт', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(
        envelope('TOMORROW_BLOCKED', 'Выпуск «на завтра» заблокирован.', {
          laggards: [LAG_1, LAG_2],
        }),
        { status: 422 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    const panel = await screen.findByTestId('laggards-panel')
    expect(panel).not.toHaveAttribute('role', 'alert')
    expect(
      within(panel).getByText('Выпуск «на завтра» заблокирован.'),
    ).toBeInTheDocument()
    expect(within(panel).getByText(`подразделение ${LAG_1}`)).toBeInTheDocument()
    expect(within(panel).getByText(`подразделение ${LAG_2}`)).toBeInTheDocument()
    expect(within(panel).getByText('Не сдали: 2')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument()
  })
})

// --- AC-9: ошибки выпуска по кодам ---------------------------------------------------

describe('ошибки выпуска (AC-9)', () => {
  it('409 REPORT_NOT_READY_FOR_DATE → панель «не сдало день», не тост и не диалог', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(
        envelope('REPORT_NOT_READY_FOR_DATE', 'Сдачи за дату нет.'),
        { status: 409 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(
      await screen.findByText(/не сдало день на эту дату/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument()
  })

  it('409 DOCUMENT_ALREADY_ISSUED → НЕ тупик: рефетч point-lookup → карточка «выпущен» + сообщение', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue({ number: 4 })]))
    // Первый GET — 404 (кнопка активна), после 409 рефетч отдаёт выпуск.
    serveCurrent('not-issued', makeCurrent({ number: 4 }))
    servePost(() =>
      HttpResponse.json(
        envelope('DOCUMENT_ALREADY_ISSUED', 'Документ уже выпущен.'),
        { status: 409 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(await screen.findByText('Выпущен: Исх.№ 4/2026')).toBeInTheDocument()
    expect(screen.getByText(/уже выпущен/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('422 REPORT_NOT_CONVERGENT → баннер несходимости + список из details', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(
        envelope(
          'REPORT_NOT_CONVERGENT',
          'Формулы сходимости расхода нарушены — выпуск отказан.',
          {
            violations: [
              {
                reason: 'staff_lt_list',
                division_id: DIV_A,
                staff_total: 2,
                list_total: 3,
              },
            ],
            warnings: [],
          },
        ),
        { status: 422 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(
      await screen.findByText(
        'Формулы сходимости расхода нарушены — выпуск отказан.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/staff_lt_list/)).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument()
  })

  it('422 REPORT_NO_DATA_FOR_DATE → баннер с сообщением бэка', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(
        envelope('REPORT_NO_DATA_FOR_DATE', 'Дата раньше начала данных.'),
        { status: 422 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(
      await screen.findByText('Дата раньше начала данных.'),
    ).toBeInTheDocument()
  })

  it('400 → сообщение формы', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(
        envelope('VALIDATION_ERROR', 'Проверьте заполнение формы.', {
          business_date: ['Неверный формат.'],
        }),
        { status: 400 },
      ),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(
      await screen.findByText('Запрос отклонён: проверьте данные формы.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument()
  })
})

// --- AC-10: журнал выпусков -----------------------------------------------------------

describe('журнал выпусков (AC-10)', () => {
  it('цепочка №3(ISSUED, взамен №2) ← №2(SUPERSEDED, взамен №1) ← №1(SUPERSEDED): строки, бейджи, подписи «взамен», reason', async () => {
    servePermissions()
    serveHistory(() =>
      oneDivisionHistory([
        makeIssue({
          id: ISSUE_3,
          number: 3,
          status: 'ISSUED',
          reason: 'пересдача после amendment v3',
          supersedes: { id: ISSUE_2, number: 2, year: 2026 },
        }),
        makeIssue({
          id: ISSUE_2,
          number: 2,
          status: 'SUPERSEDED',
          reason: 'пересдача после amendment v2',
          supersedes: { id: ISSUE_1, number: 1, year: 2026 },
        }),
        makeIssue({ id: ISSUE_1, number: 1, status: 'SUPERSEDED' }),
      ]),
    )
    serveCurrent(makeCurrent({ id: ISSUE_3, number: 3 }))
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    const row3 = await within(journal).findByTestId(`issue-row-${ISSUE_3}`)
    expect(within(row3).getByText('Исх.№ 3/2026')).toBeInTheDocument()
    expect(within(row3).getByText('Выпущен')).toBeInTheDocument()
    expect(within(row3).getByText('взамен исх.№ 2/2026')).toBeInTheDocument()
    expect(
      within(row3).getByText('пересдача после amendment v3'),
    ).toBeInTheDocument()

    const row2 = within(journal).getByTestId(`issue-row-${ISSUE_2}`)
    expect(within(row2).getByText('Заменён')).toBeInTheDocument()
    expect(within(row2).getByText('взамен исх.№ 1/2026')).toBeInTheDocument()

    const row1 = within(journal).getByTestId(`issue-row-${ISSUE_1}`)
    expect(within(row1).getByText('Заменён')).toBeInTheDocument()
    expect(within(row1).queryByText(/взамен/)).not.toBeInTheDocument()
  })

  it('пустой журнал → «Расходы ещё не формировались» (не вечный спиннер)', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    renderPage()

    expect(
      await screen.findByText('Расходы ещё не формировались'),
    ).toBeInTheDocument()
  })

  // Ревью E10: бэк пагинирует журнал (default_limit 50), конверт несёт count —
  // усечённая страница обязана быть видимой, а не выдавать себя за полный журнал.
  it('count > issues.length → индикация «Показаны N из M»', async () => {
    servePermissions()
    serveHistory(() =>
      oneDivisionHistory(
        [makeIssue({ id: ISSUE_2, number: 2 }), makeIssue({ id: ISSUE_1, number: 1 })],
        5,
      ),
    )
    serveCurrent('not-issued')
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    expect(
      await within(journal).findByText(
        'Показаны 2 из 5 — старые выпуски за кадром.',
      ),
    ).toBeInTheDocument()
  })

  it('count == issues.length → индикации усечения нет', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue()]))
    serveCurrent('not-issued')
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    await within(journal).findByText('Исх.№ 1/2026')
    expect(within(journal).queryByText(/Показаны \d+ из/)).not.toBeInTheDocument()
  })
})

// --- AC-11: скачивание -------------------------------------------------------------

describe('скачивание (AC-11)', () => {
  it('с document.view: клик «Скачать» бьёт в download-канал вложения', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue()]))
    serveCurrent('not-issued')
    let downloads = 0
    server.use(
      http.get(`*/api/documents/attachments/${ATT_1}/download/`, () => {
        downloads += 1
        return new HttpResponse('docx-bytes', {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      }),
    )
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    fireEvent.click(
      await within(journal).findByRole('button', {
        name: 'Скачать Исх.№ 1/2026',
      }),
    )
    await waitFor(() => expect(downloads).toBe(1))
  })

  it('без document.view: кнопки disabled с подсказкой, запрос НЕ уходит', async () => {
    servePermissions(['daily_report.generate'])
    serveHistory(() => oneDivisionHistory([makeIssue()]))
    serveCurrent(makeCurrent())
    let downloads = 0
    server.use(
      http.get('*/api/documents/attachments/:id/download/', () => {
        downloads += 1
        return new HttpResponse('x', { status: 200 })
      }),
    )
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    const rowButton = await within(journal).findByRole('button', {
      name: 'Скачать Исх.№ 1/2026',
    })
    await waitFor(() => expect(rowButton).toBeDisabled())
    expect(rowButton).toHaveAttribute('title', 'Нет права на скачивание')
    const cardButton = screen.getByRole('button', { name: 'Скачать .docx' })
    expect(cardButton).toBeDisabled()
    fireEvent.click(rowButton)
    expect(downloads).toBe(0)
  })

  it('download 401 → цепь 8.6 (credential очищен), НЕ баннер экрана', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue()]))
    serveCurrent('not-issued')
    server.use(
      http.get(`*/api/documents/attachments/${ATT_1}/download/`, () =>
        HttpResponse.json(envelope('AUTH_REQUIRED', 'Требуется вход.'), {
          status: 401,
        }),
      ),
    )
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    fireEvent.click(
      await within(journal).findByRole('button', {
        name: 'Скачать Исх.№ 1/2026',
      }),
    )
    // Канон 401 (providers.handle401): clearCredential + сброс ['me'];
    // сырой баннер «Не удалось скачать файл» цепь дублировать не должен.
    await waitFor(() => expect(getCredential()).toBeNull())
    expect(
      screen.queryByText(/Не удалось скачать файл/),
    ).not.toBeInTheDocument()
  })

  it('download не-2xx → сообщение об ошибке (не молчание)', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory([makeIssue()]))
    serveCurrent('not-issued')
    server.use(
      http.get(`*/api/documents/attachments/${ATT_1}/download/`, () =>
        HttpResponse.json(
          envelope('ENTITY_NOT_FOUND', 'Вложение не найдено.'),
          { status: 404 },
        ),
      ),
    )
    renderPage()

    const journal = await screen.findByTestId('issues-journal')
    fireEvent.click(
      await within(journal).findByRole('button', {
        name: 'Скачать Исх.№ 1/2026',
      }),
    )
    expect(
      await screen.findByText(/Не удалось скачать файл/),
    ).toBeInTheDocument()
  })
})

// --- AC-12: каналы и состояния --------------------------------------------------------

describe('каналы и состояния (AC-12)', () => {
  it('загрузка history — индикатор', async () => {
    servePermissions()
    server.use(
      http.get(HISTORY_PATH, async () => {
        await delay(120)
        return HttpResponse.json(oneDivisionHistory())
      }),
    )
    serveCurrent('not-issued')
    renderPage()

    expect(screen.getByText('Загрузка журнала…')).toBeInTheDocument()
    expect(
      await screen.findByText('Расходы ещё не формировались'),
    ).toBeInTheDocument()
  })

  it('доменная ошибка history (403) → баннер, не тост', async () => {
    servePermissions()
    server.use(
      http.get(HISTORY_PATH, () =>
        HttpResponse.json(envelope('PERMISSION_DENIED', 'Недостаточно прав.'), {
          status: 403,
        }),
      ),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Недостаточно прав.',
    )
    expect(screen.queryByText(GENERIC_FAILURE_MESSAGE)).not.toBeInTheDocument()
  })

  it('5xx на мутации → generic-тост хука, экран не дублирует ветвление', async () => {
    servePermissions()
    serveHistory(() => oneDivisionHistory())
    serveCurrent('not-issued')
    servePost(() =>
      HttpResponse.json(envelope('INTERNAL_ERROR', 'Внутренняя ошибка.'), {
        status: 500,
      }),
    )
    renderPage()

    fireEvent.click(await findIssueButton())

    expect(
      await screen.findByText(GENERIC_FAILURE_MESSAGE),
    ).toBeInTheDocument()
    expect(screen.queryByText('Внутренняя ошибка.')).not.toBeInTheDocument()
  })
})
