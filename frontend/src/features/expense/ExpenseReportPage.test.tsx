// @vitest-environment jsdom
// Стори 10.5 — экран расхода `/reports`.
//
// Ловушка окружения №2: дефолтный `*/api/core/divisions/` — HttpResponse.error()
// (СЕТЕВОЙ СБОЙ, не пустой список). Любой тест, выбирающий подразделение,
// ОБЯЗАН перекрыть его через server.use — иначе падение «по сети, а не по
// логике». И наоборот: тот же дефолт проверяет AC-8 в чужом тесте лейаута.
//
// Ловушка №1b (из 10.4): providers.tsx гасит ретраи ТОЛЬКО для мутаций, у
// useQuery остаётся дефолт retry: 3 — локальный QueryClient с retry: false
// обязателен, иначе тесты отказов висят ~7 с и выглядят зависшими.
//
// Фикстуры КИРИЛЛИЧЕСКИЕ: латиница дала бы зелёный тест на сломанной кодировке
// (кусало дважды за E9).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearCredential, setCredential } from '../../shared/auth/credential'
import { server } from '../../shared/api/testing/server'
import { issuedExpenseReportFixture } from '../../shared/api/testing/handlers'
import { ToastProvider } from '../../shared/ui/toast'
import { ExpenseReportPage } from './ExpenseReportPage'
import { todayLocalIso } from './expense'

afterEach(() => cleanup())

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const DIVISION_NAME = 'Управление кадров'
const OTHER_DIVISION_ID = '1111aaaa-2222-bbbb-3333-cccc4444dddd'
const TODAY = todayLocalIso()

/**
 * UUID, которого в ответе `divisions` НЕТ — и не может быть: список `laggards`
 * org-wide, а справочник читается только со страницы 1. Фикстура ОБЯЗАНА его
 * содержать, иначе ассерт фолбэка вакуумен: имя резолвилось бы всегда, и
 * мутация «фолбэк → пустая строка» осталась бы зелёной (приём 10.4 AC-2).
 */
const UNKNOWN_LAGGARD_ID = '99999999-8888-7777-6666-555555555555'

function divisionsResponse() {
  return HttpResponse.json({
    count: 2,
    next: null,
    previous: null,
    results: [
      { id: DIVISION_ID, name: DIVISION_NAME, parent: null, is_active: true },
      { id: OTHER_DIVISION_ID, name: 'Штаб', parent: null, is_active: true },
    ],
  })
}

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    error_code: errorCode,
    message,
    details,
    request_id: 'req-10-5',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    // Ловушка №1b: без этого тесты отказов висят на трёх ретраях
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* useApiMutation зовёт useToast — без провайдера падает на монтаже */}
        {/* MemoryRouter добавлен стори 10.7: ссылка «Печатная форма» это
            <Link> (ARCH-FE-012 запрещает голый href), а он без Router-контекста
            падает на монтаже. Ассерты сюиты не менялись. */}
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExpenseReportPage />, { wrapper: Wrapper })
}

/** Выбрать подразделение: до этого запросы расхода не уходят (enabled-гард). */
async function selectDivision(user: ReturnType<typeof userEvent.setup>) {
  const select = await screen.findByLabelText('Подразделение')
  await waitFor(() => expect(select).not.toBeDisabled())
  await user.selectOptions(select, DIVISION_ID)
}

describe('AC-1/AC-8: H1 «Отчёты» безусловен, вне лестницы состояний', () => {
  it('справочник упал по сети → H1 всё равно отрисован', async () => {
    // Дефолт divisions = HttpResponse.error() — НЕ перекрываем намеренно.
    renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Отчёты' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить список подразделений.',
    )
  })

  it('подзаголовок карточки несёт контрактный текст, H1 не тронут', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Отчёты' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Формирование официального расхода ЛС'),
    ).toBeInTheDocument()
  })
})

describe('AC-2: параметры выпуска', () => {
  it('первое подразделение НЕ выбирается автоматически; запросы не уходят', async () => {
    let expenseCalls = 0
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () => {
        expenseCalls += 1
        return HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 })
      }),
    )
    renderPage()

    const select = await screen.findByLabelText('Подразделение')
    await waitFor(() => expect(select).not.toBeDisabled())
    expect(select).toHaveValue('')
    expect(await screen.findByText('Выберите подразделение')).toBeInTheDocument()
    // Авто-выбор чужого подразделения дал бы необъяснимый 403 на выпуске
    expect(expenseCalls).toBe(0)
  })

  it('дата по умолчанию — сегодня в ЛОКАЛЬНОЙ зоне браузера', async () => {
    server.use(http.get('*/api/core/divisions/', () => divisionsResponse()))
    renderPage()
    expect(await screen.findByLabelText('Дата')).toHaveValue(TODAY)
  })
})

describe('AC-3: чтение выпущенного за дату', () => {
  it('200 → номер, год, дата, статус, версия сдачи ДОСЛОВНО из ответа + «Скачать»', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json({
          ...issuedExpenseReportFixture,
          number: 247,
          year: 2026,
          business_date: '2026-07-19',
          submission_version: 3,
          status: 'ISSUED',
        }),
      ),
    )
    renderPage()
    await selectDivision(user)

    expect(await screen.findByText('247 / 2026')).toBeInTheDocument()
    expect(screen.getByText('2026-07-19')).toBeInTheDocument()
    expect(screen.getByText('Выпущен')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать' })).toBeInTheDocument()
  })

  it('status SUPERSEDED показан своей подписью', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json({ ...issuedExpenseReportFixture, status: 'SUPERSEDED' }),
      ),
    )
    renderPage()
    await selectDivision(user)
    expect(await screen.findByText('Заменён')).toBeInTheDocument()
  })

  it('404 ENTITY_NOT_FOUND → ПУСТОЕ состояние (role=status), НЕ role=alert', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'Расход за дату не выпущен.'), {
          status: 404,
        }),
      ),
    )
    renderPage()
    await selectDivision(user)

    const empty = await screen.findByText('Расход за эту дату не выпускался')
    expect(empty).toBeInTheDocument()
    // Мутация «404 → role=alert» обязана краснеть здесь (красная проба №4)
    expect(empty).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Сформировать' }),
    ).toBeEnabled()
  })

  it('НЕ-404 отказ чтения → role=alert с объяснением', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'нет прав'), { status: 403 }),
      ),
    )
    renderPage()
    await selectDivision(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить сведения о расходе.',
    )
  })

  it('будущая дата на ЧТЕНИИ не блокируется: override-документ обязан читаться', async () => {
    const user = userEvent.setup()
    const future = '2030-01-01'
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', ({ request }) => {
        const date = new URL(request.url).searchParams.get('business_date')
        return HttpResponse.json({
          ...issuedExpenseReportFixture,
          business_date: date ?? '',
          number: 900,
        })
      }),
    )
    renderPage()
    await selectDivision(user)
    await user.clear(await screen.findByLabelText('Дата'))
    await user.type(screen.getByLabelText('Дата'), future)

    expect(await screen.findByText('900 / 2026')).toBeInTheDocument()
    expect(screen.getByText(future)).toBeInTheDocument()
  })
})

describe('AC-4: выпуск', () => {
  it('POST уходит с телом РОВНО {division_id, business_date} и ничем больше', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...issuedExpenseReportFixture, number: 512 }, { status: 201 })
      }),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))

    await waitFor(() => expect(body).not.toBeNull())
    // Локальная копия: TS сужает захваченную замыканием переменную до null
    const sent = body as unknown as Record<string, unknown>
    // Фантом №3: «Исх. №» и тумблер ФИНАЛ клиент не подаёт и не может
    expect(Object.keys(sent).sort()).toEqual(['business_date', 'division_id'])
    expect(sent).toEqual({ division_id: DIVISION_ID, business_date: TODAY })
  })

  it('201 → канон-строка «Расход готов. Исх.№ {N}.» и карточка перечитана', async () => {
    const user = userEvent.setup()
    let issued = false
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        issued
          ? HttpResponse.json({ ...issuedExpenseReportFixture, number: 777 })
          : HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () => {
        issued = true
        return HttpResponse.json({ ...issuedExpenseReportFixture, number: 777 }, { status: 201 })
      }),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))

    expect(await screen.findByText('Расход готов. Исх.№ 777.')).toBeInTheDocument()
    // Инвалидация queryKey: карточка чтения появилась
    expect(await screen.findByText('777 / 2026')).toBeInTheDocument()
  })
})

describe('AC-5: карта отказов — каждый код СВОИМ текстом', () => {
  async function issueAndFail(
    status: number,
    errorCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope(errorCode, message, details), { status }),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))
    return user
  }

  it('403 → ФИКСИРОВАННАЯ константа, на экране нет голого PERMISSION_DENIED', async () => {
    // Бэк шлёт DomainError без message → errors.ts подставит сам код наружу
    await issueAndFail(403, 'PERMISSION_DENIED', 'PERMISSION_DENIED')
    expect(
      await screen.findByText('Подразделение вне вашей зоны ответственности.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/PERMISSION_DENIED/)).not.toBeInTheDocument()
  })

  it('404 → «Подразделение не найдено»', async () => {
    await issueAndFail(404, 'ENTITY_NOT_FOUND', 'Подразделение не найдено.')
    expect(await screen.findByText('Подразделение не найдено.')).toBeInTheDocument()
  })

  it('409 REPORT_NOT_READY_FOR_DATE → «День не сдан — выпускать нечего»', async () => {
    await issueAndFail(409, 'REPORT_NOT_READY_FOR_DATE', 'Нет сдачи за дату.')
    expect(await screen.findByText('День не сдан — выпускать нечего.')).toBeInTheDocument()
    // Фантом №7: MARKS_INCOMPLETE — 0 raise-сайтов в бэке
    expect(screen.queryByText(/MARKS_INCOMPLETE/)).not.toBeInTheDocument()
  })

  it('409 DOCUMENT_ALREADY_ISSUED → свой текст с номером ИЗ details', async () => {
    await issueAndFail(409, 'DOCUMENT_ALREADY_ISSUED', 'уже', { number: 247, year: 2026 })
    expect(await screen.findByText('Расход уже выпущен: исх.№ 247')).toBeInTheDocument()
    // Не схлопнут с «День не сдан» (красная проба №1)
    expect(screen.queryByText('День не сдан — выпускать нечего.')).not.toBeInTheDocument()
  })

  it('409 DOCUMENT_ALREADY_ISSUED → карточка ПЕРЕЧИТАНА и «Скачать» доступна (ревью 10.5)', async () => {
    // Гонка выпуска: чтение видело 404, а POST отбит «уже выпущен». В details
    // 409-го НЕТ attachment_id — кнопку «Скачать» несёт только перечитанная
    // карточка, без инвалидации read-query она была бы недостижима (единственный
    // путь к этому 409 — из пустого состояния, где report === null).
    const user = userEvent.setup()
    let posted = false
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        posted
          ? HttpResponse.json({ ...issuedExpenseReportFixture, number: 247 })
          : HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () => {
        posted = true
        return HttpResponse.json(
          errorEnvelope('DOCUMENT_ALREADY_ISSUED', 'уже', { number: 247, year: 2026 }),
          { status: 409 },
        )
      }),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))

    expect(await screen.findByText('Расход уже выпущен: исх.№ 247')).toBeInTheDocument()
    // Инвалидация read-query: карточка появилась из СВЕЖЕГО чтения
    expect(await screen.findByText('247 / 2026')).toBeInTheDocument()
    // «Скачать» реально доступна (повторное скачивание — операция, не ошибка, §4)
    expect(screen.getAllByRole('button', { name: 'Скачать' }).length).toBeGreaterThan(0)
  })

  it('422 REPORT_NOT_CONVERGENT → свой текст + ЧИСЛО нарушений из ответа', async () => {
    await issueAndFail(422, 'REPORT_NOT_CONVERGENT', 'не сходится', {
      violations: [{ code: 'STAFF_LT_LIST' }, { code: 'NO_STAFFING_RECORD' }],
      warnings: [],
    })
    expect(await screen.findByText('Расход не сходится — выпуск отказан.')).toBeInTheDocument()
    expect(screen.getByText('Нарушений формул: 2')).toBeInTheDocument()
  })

  it('422 SNAPSHOT_SCHEMA_UNSUPPORTED → ОТДЕЛЬНЫЙ текст, не склеен с несходимостью', async () => {
    await issueAndFail(422, 'SNAPSHOT_SCHEMA_UNSUPPORTED', 'версия схемы')
    expect(
      await screen.findByText(/Снапшот сдачи имеет неподдерживаемую версию схемы/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Расход не сходится — выпуск отказан.')).not.toBeInTheDocument()
  })

  it('400 VALIDATION_ERROR → error.message бэка', async () => {
    await issueAndFail(400, 'VALIDATION_ERROR', 'actor обязателен.')
    expect(await screen.findByText('actor обязателен.')).toBeInTheDocument()
  })

  it('неучтённый 422-код → other с текстом конверта, НИКОГДА не тишина', async () => {
    await issueAndFail(422, 'DATE_BEFORE_DATA_START', 'Дата раньше начала данных.')
    expect(await screen.findByText('Дата раньше начала данных.')).toBeInTheDocument()
  })
})

describe('AC-6: экран «кто не сдал» (422 TOMORROW_BLOCKED)', () => {
  async function blockedRender() {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(
          errorEnvelope('TOMORROW_BLOCKED', 'заблокировано', {
            // ДВА id: один резолвится в имя, второй — принципиально нет
            laggards: [OTHER_DIVISION_ID, UNKNOWN_LAGGARD_ID],
          }),
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))
    return user
  }

  it('блокирующий блок «Не готово» со списком laggards', async () => {
    await blockedRender()
    expect(await screen.findByText('Не готово')).toBeInTheDocument()
    expect(screen.getByText('Не сдали:')).toBeInTheDocument()
  })

  it('известный id → ИМЯ подразделения; неизвестный → сам UUID (фолбэк)', async () => {
    await blockedRender()
    await screen.findByText('Не сдали:')
    // Скоуп на СПИСОК обязателен: «Штаб» есть ещё и в <option> селекта, и
    // незаскоупленный ассерт прошёл бы на нём, ничего не доказав про список.
    const list = within(screen.getByRole('list'))
    // Резолвится: id есть в ответе divisions
    expect(list.getByText('Штаб')).toBeInTheDocument()
    // НЕ резолвится: org-wide список, вне скоупа/страницы 1 — рендерим UUID.
    // Это КОРРЕКТНОЕ поведение, а не баг (красная проба №2).
    expect(list.getByText(UNKNOWN_LAGGARD_ID)).toBeInTheDocument()
  })

  it('фантом №5: ни «отв.:», ни «Напомнить», ни per-лист светофора', async () => {
    await blockedRender()
    await screen.findByText('Не готово')
    expect(screen.queryByText(/отв\.:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Напомнить/ })).not.toBeInTheDocument()
  })

  it('laggards пришли мусором → блок отрисован, список пуст, экран не падает', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(
          errorEnvelope('TOMORROW_BLOCKED', 'заблокировано', { laggards: 'не массив' }),
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))

    expect(await screen.findByText('Не готово')).toBeInTheDocument()
    expect(screen.queryByText('Не сдали:')).not.toBeInTheDocument()
  })
})

describe('Story 10.5a: обход блокировки «на завтра»', () => {
  beforeEach(() => setCredential({ kind: 'dev', userId: 'admin-1' }))
  afterEach(() => clearCredential())

  function grantOverridePermission() {
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json({ permissions: ['daily_report.override_block'] }),
      ),
    )
  }

  async function blockedRender() {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(
          errorEnvelope('TOMORROW_BLOCKED', 'заблокировано', { laggards: [] }),
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))
    await screen.findByText('Не готово')
    return user
  }

  it('AC-1: кнопка «Обойти блокировку» видна ТОЛЬКО держателю права', async () => {
    grantOverridePermission()
    await blockedRender()
    expect(
      await screen.findByRole('button', { name: 'Обойти блокировку' }),
    ).toBeInTheDocument()
  })

  it('AC-1: без права кнопки НЕТ (дефолтная фикстура прав не несёт override_block)', async () => {
    await blockedRender()
    // Дать `['me']` время догрузиться, прежде чем утверждать отсутствие.
    await screen.findByText('Не готово')
    expect(
      screen.queryByRole('button', { name: 'Обойти блокировку' }),
    ).not.toBeInTheDocument()
  })

  it('AC-2: клик открывает инлайн-форму с полем «Причина»', async () => {
    grantOverridePermission()
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))

    expect(
      await screen.findByRole('form', { name: 'Обход блокировки' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Причина')).toBeInTheDocument()
  })

  it('AC-3: РОВНО один POST, тело СТРОГО {business_date, reason} — БЕЗ division_id', async () => {
    grantOverridePermission()
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(
          { business_date: TODAY, overridden_by: 'admin-1', reason: 'Пилот уходит рано' },
          { status: 201 },
        )
      }),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Пилот уходит рано')
    await user.click(screen.getByRole('button', { name: 'Подтвердить обход' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ business_date: TODAY, reason: 'Пилот уходит рано' })
    expect(bodies[0]).not.toHaveProperty('division_id')
  })

  it('AC-4: 201 → подтверждение ДОСЛОВНО из ответа, форма закрыта', async () => {
    grantOverridePermission()
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', () =>
        HttpResponse.json(
          { business_date: TODAY, overridden_by: 'капитан Иванов', reason: 'Учения' },
          { status: 201 },
        ),
      ),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Учения')
    await user.click(screen.getByRole('button', { name: 'Подтвердить обход' }))

    const confirmation = await screen.findByTestId('tomorrow-block-overridden')
    expect(confirmation).toHaveTextContent('капитан Иванов')
    expect(confirmation).toHaveTextContent('Учения')
    expect(
      screen.queryByRole('form', { name: 'Обход блокировки' }),
    ).not.toBeInTheDocument()
  })

  it('AC-5: 409 уже обойдено → инлайн-текст, форма ОСТАЁТСЯ открытой', async () => {
    grantOverridePermission()
    // Дефолт-хендлер (Task 4) уже отдаёт этот 409 — явный `server.use` здесь
    // не нужен, но пишем явно для читаемости теста.
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', () =>
        HttpResponse.json(errorEnvelope('TOMORROW_BLOCK_ALREADY_OVERRIDDEN', 'уже есть'), {
          status: 409,
        }),
      ),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Причина')
    await user.click(screen.getByRole('button', { name: 'Подтвердить обход' }))

    expect(
      await screen.findByText('Обход на эту дату уже существует.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('form', { name: 'Обход блокировки' }),
    ).toBeInTheDocument()
  })

  it('AC-6: 403 → инлайн «Нет права...», экран не падает', async () => {
    grantOverridePermission()
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'нет права'), { status: 403 }),
      ),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Причина')
    await user.click(screen.getByRole('button', { name: 'Подтвердить обход' }))

    expect(
      await screen.findByText('Нет права на обход блокировки.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Не готово')).toBeInTheDocument()
  })

  it('AC-7: 400 → инлайн-текст ИЗ ОТВЕТА, форма ОСТАЁТСЯ открытой', async () => {
    grantOverridePermission()
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', () =>
        HttpResponse.json(
          errorEnvelope('VALIDATION_ERROR', 'Дата обхода дальше +31 дней — проверьте год.'),
          { status: 400 },
        ),
      ),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Причина')
    await user.click(screen.getByRole('button', { name: 'Подтвердить обход' }))

    expect(
      await screen.findByText('Дата обхода дальше +31 дней — проверьте год.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('form', { name: 'Обход блокировки' }),
    ).toBeInTheDocument()
  })

  it('AC-8: регресс — «Не готово»/список и «Сформировать» переживают открытую форму обхода', async () => {
    grantOverridePermission()
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))

    expect(screen.getByText('Не готово')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сформировать' })).toBeInTheDocument()
  })

  it('«Отмена» закрывает форму, POST не шлёт', async () => {
    grantOverridePermission()
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post('*/api/operations/expense-reports/override-tomorrow-block/', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(
          { business_date: TODAY, overridden_by: 'x', reason: 'y' },
          { status: 201 },
        )
      }),
    )
    const user = await blockedRender()
    await user.click(await screen.findByRole('button', { name: 'Обойти блокировку' }))
    await user.type(screen.getByLabelText('Причина'), 'Черновик причины')
    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(
      screen.queryByRole('form', { name: 'Обход блокировки' }),
    ).not.toBeInTheDocument()
    expect(bodies).toHaveLength(0)
    // Кнопка-открывашка вернулась: путь не стал тупиком.
    expect(screen.getByRole('button', { name: 'Обойти блокировку' })).toBeInTheDocument()
  })
})

describe('AC-9: защитный разбор + доказанное отсутствие фантомов', () => {
  it('мусорный ответ чтения → карточка не строится, экран жив', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json({ number: 'двести сорок семь', status: 'DRAFT' }),
      ),
    )
    renderPage()
    await selectDivision(user)

    // 200, но разбор отверг → падаем в пустое состояние, а не в «Исх.№ undefined»
    expect(await screen.findByText('Расход за эту дату не выпускался')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Скачать' })).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('ответ без attachment_id → кнопка скачивания НЕ рисуется', async () => {
    const user = userEvent.setup()
    const withoutAttachment: Record<string, unknown> = {
      ...issuedExpenseReportFixture,
    }
    delete withoutAttachment.attachment_id
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(withoutAttachment),
      ),
    )
    renderPage()
    await selectDivision(user)

    await screen.findByText('Расход за эту дату не выпускался')
    expect(screen.queryByRole('button', { name: 'Скачать' })).not.toBeInTheDocument()
  })

  it('НЕТ переключателя формата: ни .xlsx, ни .pdf (фантом №1)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
    )
    renderPage()
    await selectDivision(user)
    await screen.findByRole('button', { name: 'Скачать' })

    // Красная проба №5: добавленная кнопка «.xlsx» обязана уронить этот ассерт
    expect(screen.queryByText(/\.xlsx/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\.pdf/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\.docx/i)).not.toBeInTheDocument()
  })

  it('НЕТ журнала выпусков и цепочки «взамен исх.№» (фантом №2)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
    )
    renderPage()
    await selectDivision(user)
    await screen.findByRole('button', { name: 'Скачать' })

    expect(screen.queryByText(/взамен/i)).not.toBeInTheDocument()
    // Строка журнала зарезервирована за 10.5c — здесь её быть не должно
    expect(screen.queryByText('Расходы ещё не формировались')).not.toBeInTheDocument()
  })

  it('НЕТ поля «Исх. №» и тумблера «черновик/ФИНАЛ» (фантом №3)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
    )
    renderPage()
    await selectDivision(user)
    await screen.findByRole('button', { name: 'Сформировать' })

    // Номер выдаёт DocumentSequence на бэке — поля ввода не существует
    expect(screen.queryByRole('textbox', { name: /Исх/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/черновик/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ФИНАЛ/)).not.toBeInTheDocument()
  })

  it('НЕТ прогресс-бара и «Повторить»: генерация синхронна (фантом №6)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture, { status: 201 }),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))
    await screen.findByText(/Расход готов/)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Повторить/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Формируется/)).not.toBeInTheDocument()
  })
})

describe('Смена контекста: состояние не переживает ремаунт', () => {
  it('сообщение отказа исчезает при смене даты (ремаунт по key)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(
          errorEnvelope('REPORT_NOT_READY_FOR_DATE', 'нет сдачи'),
          { status: 409 },
        ),
      ),
    )
    renderPage()
    await selectDivision(user)
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))
    expect(await screen.findByText('День не сдан — выпускать нечего.')).toBeInTheDocument()

    // Находка ревью 10.4 была ровно класса «флаг переживает смену контекста»
    await user.clear(screen.getByLabelText('Дата'))
    await user.type(screen.getByLabelText('Дата'), '2026-06-01')

    await waitFor(() =>
      expect(
        screen.queryByText('День не сдан — выпускать нечего.'),
      ).not.toBeInTheDocument(),
    )
  })
})

describe('Story 10.5c: журнал выпусков', () => {
  function journalPage(
    results: Record<string, unknown>[],
    over: Record<string, unknown> = {},
  ) {
    return { count: results.length, next: null, previous: null, results, ...over }
  }

  function docRow(over: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      doc_type: 'EXPENSE',
      number: 1,
      year: 2026,
      business_date: '2026-07-19',
      division_id: DIVISION_ID,
      submission_id: 512,
      submission_version: 1,
      status: 'ISSUED',
      attachment_id: 'c3d4e5f6-0718-492a-b3c4-d5e6f7081920',
      sha256: 'e3b0',
      reason: '',
      supersedes_number: null,
      supersedes_year: null,
      ...over,
    }
  }

  it('AC-1: журнал НЕ перезапрашивается при смене даты (свой ключ, не зависит от businessDate)', async () => {
    let calls = 0
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/journal/', () => {
        calls += 1
        return HttpResponse.json(journalPage([]))
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)
    await screen.findByText('Выпусков ещё не было')
    await waitFor(() => expect(calls).toBe(1))

    await user.clear(screen.getByLabelText('Дата'))
    await user.type(screen.getByLabelText('Дата'), '2026-06-01')

    // Дать ExpenseReportPanel время перемонтироваться под новой датой.
    await screen.findByRole('button', { name: 'Сформировать' })
    expect(calls).toBe(1)
  })

  it('AC-2: строка с цепочкой и причиной рендерится дословно', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(
          journalPage([
            docRow({
              id: 'd2',
              number: 2,
              status: 'ISSUED',
              reason: 'правка ростера',
              supersedes_number: 1,
              supersedes_year: 2026,
            }),
          ]),
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    const list = await screen.findByTestId('expense-journal-list')
    expect(within(list).getByText(/Исх\.№ 2\/2026/)).toBeInTheDocument()
    expect(within(list).getByText(/Выпущен/)).toBeInTheDocument()
    expect(within(list).getByText('взамен исх.№ 1/2026')).toBeInTheDocument()
    expect(within(list).getByText('правка ростера')).toBeInTheDocument()
  })

  it('AC-3: пустой журнал → role="status", не alert', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/journal/', () => HttpResponse.json(journalPage([]))),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    expect(await screen.findByText('Выпусков ещё не было')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('AC-4: ошибка журнала (403) → инлайн, кнопка «Сформировать» остаётся рабочей', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'нет'), { status: 403 }),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    expect(
      await screen.findByText('Не удалось загрузить журнал выпусков.'),
    ).toBeInTheDocument()
    // Панель выпуска не задета ошибкой журнала — независимые запросы (AC-4).
    expect(await screen.findByRole('button', { name: 'Сформировать' })).toBeInTheDocument()
  })

  it('AC-5: next непустой → «последние N из count»', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(
          journalPage([docRow()], {
            count: 51,
            next: 'http://testserver/api/operations/expense-reports/journal/?limit=50&offset=50',
          }),
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    expect(
      await screen.findByText('Показаны последние 1 из 51'),
    ).toBeInTheDocument()
  })

  it('ревью-фикс: next: null, но валидных строк меньше count (мусор отброшен) → текст всё равно показан', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(
          journalPage([docRow(), { garbage: true }], { count: 2, next: null }),
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    expect(
      await screen.findByText('Показаны последние 1 из 2'),
    ).toBeInTheDocument()
  })

  it('ревью-фикс: успешный выпуск инвалидирует журнал', async () => {
    let journalBody = journalPage([])
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(journalBody),
      ),
      http.post('*/api/operations/expense-reports/', () =>
        HttpResponse.json(docRow({ id: 'new-doc' }), { status: 201 }),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)
    await screen.findByText('Выпусков ещё не было')

    // «Сервер» теперь отдаёт свежую строку — до инвалидации клиент об этом
    // не знает (react-query кэширует по queryKey).
    journalBody = journalPage([docRow({ id: 'new-doc' })])
    await user.click(await screen.findByRole('button', { name: 'Сформировать' }))

    expect(await screen.findByTestId('expense-journal-list')).toBeInTheDocument()
    expect(screen.queryByText('Выпусков ещё не было')).not.toBeInTheDocument()
  })

  it('AC-8: регресс — журнал и панель выпуска сосуществуют, ни один не гасит другой', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет'), { status: 404 }),
      ),
      http.get('*/api/operations/expense-reports/journal/', () =>
        HttpResponse.json(journalPage([docRow()])),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await selectDivision(user)

    expect(await screen.findByRole('button', { name: 'Сформировать' })).toBeInTheDocument()
    expect(await screen.findByTestId('expense-journal-list')).toBeInTheDocument()
  })
})
