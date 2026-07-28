// @vitest-environment jsdom
// Story 10.2 — экран массового обновления на ЖИВОМ bulk-роуте (10.1a).
//
// Ловушка окружения №1: дефолтная MSW-фикстура `*/api/core/divisions/` отдаёт
// HttpResponse.error() (сетевой обрыв) — без server.use тест падал бы «сетью», а
// не логикой. onUnhandledRequest: 'error' роняет любой незамоканный путь,
// включая POST statuses/bulk/ — его мокаем явно в каждом отправляющем тесте.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import type { paths } from '../../shared/api/schema'
import { clearCredential, setCredential } from '../../shared/auth/credential'
import { employeesListFixture } from '../../shared/api/testing/handlers'
import { server } from '../../shared/api/testing/server'
import { GENERIC_FAILURE_MESSAGE } from '../../shared/api/useApiMutation'
import { ToastProvider } from '../../shared/ui/toast'
import { todayLocalIso } from './daySubmission'
import type { DaySubmission } from './daySubmission'
import { DailyUpdatePage } from './DailyUpdatePage'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type EmployeesResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']

// jsdom НЕ реализует <dialog> методы (Ловушка 3, ConflictDialog.test.tsx) —
// 10.2a рендерит ConflictDialog внутри этой страницы, тот же минимальный
// полифилл (только open-семантика).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

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

// clearCredential — в afterEach, а не в хвосте теста (ревью 10.6): упавший до
// своей последней строки тест иначе протащил бы credential в соседей файла.
afterEach(() => {
  cleanup()
  clearCredential()
})

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const SECOND_DIVISION_ID = 'b1b2b3b4-c5c6-d7d8-e9ea-fbfcfdfe0102'

const divisionsFixture: DivisionsResponse = {
  count: 2,
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
    {
      id: 'b1b2b3b4-c5c6-d7d8-e9ea-fbfcfdfe0102',
      organization: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
      type_code: 'DEPARTMENT',
      name: 'Второй отдел',
      code: 'DIV-2',
    },
  ],
}

// Кириллица во всех фикстурах — урок E9: латинские имена дают «зелёный тест на
// сломанном» (type-ahead и toLocaleLowerCase('ru') ведут себя иначе)
const NAMES = [
  'Абдуллаев Асхат Маратович',
  'Бекова Гульмира Ержановна',
  'Валиев Тимур Русланович',
]

/** Employee-фикстура схемы + подмена id/ФИО: тело остаётся schema-валидным. */
function employeeFixtures(): EmployeesResponse['results'] {
  const base = employeesListFixture.results[0]
  return NAMES.map((full_name, i) => ({ ...base, id: `emp-${i}`, full_name }))
}

function mockDivisions() {
  server.use(
    http.get('*/api/core/divisions/', () => HttpResponse.json(divisionsFixture)),
  )
}

function mockEmployees(results = employeeFixtures()) {
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json({
        count: results.length,
        next: null,
        previous: null,
        results,
      } satisfies EmployeesResponse),
    ),
  )
}

/** Тела ушедших POST — источник истины «сколько отправок и с чем». */
function captureBulk(
  respond: () => Response | Promise<Response>,
): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.post('*/api/operations/statuses/bulk/', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>)
      return respond()
    }),
  )
  return bodies
}

// ── Стори 10.3: сдача дня ────────────────────────────────────────────────────
// Дефолтный MSW-хендлер GET daily-submissions отдаёт «день не сдан» — тесты,
// которым нужен сданный день, перекрывают его явно.

const TODAY_ISO = todayLocalIso()

function daySubmissionFixture(over: Partial<DaySubmission> = {}): DaySubmission {
  return {
    id: 77,
    division_id: DIVISION_ID,
    business_date: TODAY_ISO,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    ...over,
  }
}

/** Состояние дня: сдан (строка с is_current) либо не сдан (пустой конверт). */
function mockDayState(rows: DaySubmission[]) {
  server.use(
    http.get('*/api/operations/daily-submissions/', () =>
      HttpResponse.json({
        count: rows.length,
        next: null,
        previous: null,
        results: rows,
      }),
    ),
  )
}

/** Тела POST daily-submissions — «сдача дня реально ушла или нет». */
function captureSubmissions(): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.post('*/api/operations/daily-submissions/', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json(daySubmissionFixture(), { status: 201 })
    }),
  )
  return bodies
}

function envelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
) {
  return {
    error_code: errorCode,
    message,
    details,
    request_id: 'req-10-2',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

function renderPage() {
  // Свежий клиент на тест (кэш не протекает); retry: false — тест ошибки не
  // должен ждать бэкоффы. Локальная обёртка вместо app/providers: features →
  // app запрещён матрицей слоёв (ARCH-FE-013).
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
  return render(<DailyUpdatePage />, { wrapper: Wrapper })
}

function rowOf(fullName: string): HTMLElement {
  const row = screen.getByText(fullName).closest<HTMLElement>('[data-grid-row]')
  if (!row) throw new Error(`Строка «${fullName}» не найдена`)
  return row
}

/** Выбор подразделения → грид с составом. Возвращает user-event сессию. */
async function selectDivision() {
  const user = userEvent.setup()
  const select = await screen.findByLabelText('Подразделение')
  // Ждём ЗАГРУЗКУ списка: до неё селект пуст и disabled — селект по id иначе
  // падает «option not found», а не по логике экрана
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)
  await screen.findByTestId('changed-counter')
  return user
}

/** Правка статуса текущей строки с клавиатуры + коммит (Enter вниз). */
async function editCurrentRow(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.keyboard('{Enter}')
  await user.selectOptions(screen.getByLabelText('Статус'), code)
  await user.keyboard('{Enter}')
}

it('загрузка: селект подразделений заполнен; выбор → грид со всем составом в «В строю» + плашка преднабора', async () => {
  mockDivisions()
  mockEmployees()
  renderPage()

  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  // «— выберите —» + два реальных подразделения; автовыбора первого НЕТ:
  // список не отфильтрован по scope оператора, молчаливый выбор чужого
  // подразделения дал бы 403 на отправке без объяснения
  expect(within(select).getAllByRole('option')).toHaveLength(3)
  expect(select).toHaveValue('')
  expect(screen.getByText('Выберите подразделение')).toBeInTheDocument()
  expect(screen.queryByTestId('changed-counter')).not.toBeInTheDocument()

  await selectDivision()

  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 3',
  )
  for (const name of NAMES) {
    expect(within(rowOf(name)).getByText('В строю')).toBeInTheDocument()
  }
  expect(
    screen.getByText(/Преднабор со вчера недоступен/),
  ).toBeInTheDocument()
})

it('отправка: правка 2 строк → «Сохранить правки» → РОВНО один POST с телом из двух дельт', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() =>
    HttpResponse.json({ created: 2 }, { status: 201 }),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION') // строка 0, Enter уводит на строку 1
  await editCurrentRow(user, 'SICK_LEAVE') // строка 1
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 2 из 3',
  )

  await user.click(screen.getByText('Сохранить правки'))

  await waitFor(() => expect(bodies).toHaveLength(1))
  const body = bodies[0] as { business_date: string; rows: unknown[] }
  // Дата — выбранная на экране (сегодня локально), НЕ пустая строка
  expect(body.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  // Ровно две дельты — третья, нетронутая строка в тело не попадает
  expect(body.rows).toEqual([
    {
      employee_id: 'emp-0',
      status_type_code: 'VACATION',
      date_start: body.business_date,
      date_end: expect.any(String),
    },
    {
      employee_id: 'emp-1',
      status_type_code: 'SICK_LEAVE',
      date_start: body.business_date,
      date_end: expect.any(String),
    },
  ])
  // scope резолвит бэк из RBAC — division_id в теле нет и быть не должно
  expect(body).not.toHaveProperty('division_id')
})

it('успех: счётчик «Применено N» из ТЕЛА ОТВЕТА; база сдвинулась, значения на экране целы', async () => {
  mockDivisions()
  mockEmployees()
  // created=7 намеренно ≠ длине дельт (2): число обязано прийти из ответа
  captureBulk(() => HttpResponse.json({ created: 7 }, { status: 201 }))
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await editCurrentRow(user, 'SICK_LEAVE')
  await user.click(screen.getByText('Сохранить правки'))

  expect(await screen.findByText('Применено 7 отклонений')).toBeInTheDocument()
  // База сдвинулась ⇒ грязного состояния больше нет…
  await waitFor(() =>
    expect(screen.getByTestId('changed-counter')).toHaveTextContent(
      'Изменено 0 из 3',
    ),
  )
  // …а введённые значения на экране остались (это НЕ сброс грида)
  expect(within(rowOf(NAMES[0])).getByText('В отпуске')).toBeInTheDocument()
  expect(within(rowOf(NAMES[1])).getByText('На больничном')).toBeInTheDocument()
  expect(within(rowOf(NAMES[2])).getByText('В строю')).toBeInTheDocument()
})

it('409 mixed (hard-строка в агрегате): инлайн-панель со ФИО и причинами; ConflictDialog НЕ открывается; ввод не потерян', async () => {
  // 10.2a: чисто-soft агрегат ТЕПЕРЬ открывает ConflictDialog (см. тест ниже)
  // — этот тест доказывает, что mixed/hard-агрегат (код НЕ в OVERRIDABLE_CODES,
  // здесь буквально другой код) по-прежнему остаётся инлайн-only каналом.
  mockDivisions()
  mockEmployees()
  captureBulk(() =>
    HttpResponse.json(
      envelope(
        'OVERLAPPING_HARD_STATUS',
        'Массовое обновление отклонено: см. detail.rows.',
        {
          rows: [
            {
              index: 0,
              employee_id: 'emp-0',
              code: 'OVERLAPPING_HARD_STATUS',
              http_status: 422,
              message: 'Статус конфликтует с hard-статусом сотрудника.',
            },
            {
              index: 1,
              employee_id: 'emp-1',
              code: 'STATUS_OVERLAP_WARNING',
              http_status: 409,
              message: 'Отпуск уже открыт с 15.07.2026.',
            },
          ],
        },
      ),
      { status: 422 },
    ),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await editCurrentRow(user, 'SICK_LEAVE')
  await user.click(screen.getByText('Сохранить правки'))

  // Построчная детализация: номер строки 1-based + ФИО, резолвнутое по id
  expect(
    await screen.findByText(
      `Строка 1 · ${NAMES[0]} · Статус конфликтует с hard-статусом сотрудника.`,
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText(`Строка 2 · ${NAMES[1]} · Отпуск уже открыт с 15.07.2026.`),
  ).toBeInTheDocument()
  // Цвет не единственный сигнал — текстовая метка обязательна
  expect(screen.getByText(/^Нельзя:/)).toBeInTheDocument()

  // OVERLAPPING_HARD_STATUS не в OVERRIDABLE_CODES ⇒ conflict-стейт не
  // поднимается, ConflictDialog не открывается (hard никогда не обходится).
  expect(document.querySelector('dialog')).toBeNull()
  expect(screen.queryByText('Подтвердить оверрайд')).not.toBeInTheDocument()

  // Сервис атомарен: 0 записей в БД ⇒ база НЕ сдвигается, ввод остаётся правимым
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 2 из 3',
  )
  expect(within(rowOf(NAMES[0])).getByText('В отпуске')).toBeInTheDocument()
  expect(screen.queryByText(/Применено/)).not.toBeInTheDocument()
})

it('409 чисто-soft: ConflictDialog открывается; «Подтвердить оверрайд» шлёт override:true+причину; успех обновляет счётчик как обычно (10.2a)', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() => {
    // captureBulk push'ит тело ДО вызова этого коллбэка — на первый запрос
    // bodies.length уже 1, на второй — 2.
    const call = bodies.length
    if (call === 1) {
      return HttpResponse.json(
        envelope(
          'STATUS_OVERLAP_WARNING',
          'Массовое обновление отклонено: см. detail.rows.',
          {
            rows: [
              {
                index: 0,
                employee_id: 'emp-0',
                code: 'STATUS_OVERLAP_WARNING',
                http_status: 409,
                message: 'Статус пересекает soft-статус сотрудника.',
              },
            ],
          },
        ),
        { status: 409 },
      )
    }
    return HttpResponse.json({ created: 1 }, { status: 201 })
  })
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  // Чисто-soft агрегат: STATUS_OVERLAP_WARNING в OVERRIDABLE_CODES ⇒
  // useApiMutation поднимает conflict-стейт ⇒ ConflictDialog рендерится.
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/^Конфликт:/)).toBeInTheDocument()
  // Инлайн-панель НЕ дублирует канал, пока диалог открыт.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  const confirmButton = within(dialog).getByText('Подтвердить оверрайд')
  expect(confirmButton).toBeDisabled() // причина ещё пуста (10–500)

  await user.type(
    within(dialog).getByLabelText('Причина (10–500 символов)'),
    'Согласовано с руководителем устно',
  )
  expect(confirmButton).toBeEnabled()
  await user.click(confirmButton)

  // Повторный POST — исходное тело + override:true/override_reason (спред
  // confirmOverride, useApiMutation 8.5 — эта стори его НЕ переписывает).
  await waitFor(() => expect(bodies).toHaveLength(2))
  expect(bodies[1]).toMatchObject({
    business_date: bodies[0].business_date,
    override: true,
    override_reason: 'Согласовано с руководителем устно',
  })

  // Успех — тот же путь, что обычный bulk-успех: диалог закрывается,
  // счётчик применённых обновляется, база сдвигается.
  await waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 3',
  )
})

it('«Отмена» в ConflictDialog закрывает диалог без повторной отправки', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() =>
    HttpResponse.json(
      envelope(
        'STATUS_OVERLAP_WARNING',
        'Массовое обновление отклонено: см. detail.rows.',
        {
          rows: [
            {
              index: 0,
              employee_id: 'emp-0',
              code: 'STATUS_OVERLAP_WARNING',
              http_status: 409,
              message: 'Статус пересекает soft-статус сотрудника.',
            },
          ],
        },
      ),
      { status: 409 },
    ),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByText('Отмена'))

  expect(document.querySelector('dialog')).toBeNull()
  expect(bodies).toHaveLength(1) // без ретрая
})

it('403 → инлайн про status.manage; 500 → инлайна НЕТ, только общий тост', async () => {
  mockDivisions()
  mockEmployees()
  const statuses = [403, 500]
  server.use(
    http.post('*/api/operations/statuses/bulk/', () => {
      const status = statuses.shift() ?? 500
      return status === 403
        ? HttpResponse.json(
            envelope('PERMISSION_DENIED', 'Недостаточно прав.', {}),
            { status: 403 },
          )
        : HttpResponse.json(
            envelope('INTERNAL_ERROR', 'Внутренняя ошибка сервера.', {}),
            { status: 500 },
          )
    }),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  expect(
    await screen.findByText(/Требуется право status\.manage/),
  ).toBeInTheDocument()

  // Второй заход — 5xx: канал уже обслужен тостом, экран НЕ дублирует
  await user.click(screen.getByText('Сохранить правки'))
  expect(await screen.findByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
  expect(screen.queryByText(/Требуется право status\.manage/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Ничего не сохранено/)).not.toBeInTheDocument()
})

it('двойная отправка при isPending → РОВНО один POST', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(async () => {
    await delay(60) // ответ в полёте — второй клик приходится на isPending
    return HttpResponse.json({ created: 1 }, { status: 201 })
  })
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  const submit = screen.getByText('Сохранить правки')
  await user.click(submit)
  expect(await screen.findByText('Отправка…')).toBeInTheDocument()
  await user.click(submit)

  expect(await screen.findByText('Применено 1 отклонений')).toBeInTheDocument()
  expect(bodies).toHaveLength(1)
})

it('клавиатурный путь: правка + Ctrl+Enter → POST ушёл, мышь не использована, правка ячейки НЕ открылась', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  const submissions = captureSubmissions()
  const user = userEvent.setup()
  renderPage()

  // Подразделение выбираем тоже с клавиатуры-совместимого API (без click)
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)
  await screen.findByTestId('changed-counter')

  await editCurrentRow(user, 'VACATION')
  await user.keyboard('{Control>}{Enter}{/Control}')

  await waitFor(() => expect(bodies).toHaveLength(1))
  // Ctrl+Enter перехвачен экраном в capture-фазе: грид НЕ получил Enter и не
  // вошёл в правку (select статуса рендерится только в режиме EDIT).
  expect(screen.queryByLabelText('Статус')).not.toBeInTheDocument()
  // 10.3 AC-11: Ctrl+Enter СОХРАНЯЕТ правки и день НЕ сдаёт — сдача
  // клавиатурного шортката не получает намеренно («сдача — осознанное
  // действие»). Кнопка сдачи на месте и день по-прежнему не сдан.
  expect(submissions).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Сдать день' })).toBeInTheDocument()
})

it('смена даты при dirty: подтверждение; отказ → дата прежняя и дельты целы; согласие → грид чист', async () => {
  mockDivisions()
  mockEmployees()
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
  const originalDate = dateInput.value

  fireEvent.change(dateInput, { target: { value: '2026-07-25' } })

  // Регистр «счёт + глагол»; формулировка «У вас есть несохранённые изменения»
  // запрещена канон-строками (EXPERIENCE.md#L94)
  expect(
    screen.getByText(/Изменено 1 из 3\. Сменить дату\? Правки будут потеряны\./),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/У вас есть несохранённые изменения/),
  ).not.toBeInTheDocument()

  await user.click(screen.getByText('Отмена'))
  expect(dateInput.value).toBe(originalDate)
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 1 из 3',
  )
  expect(within(rowOf(NAMES[0])).getByText('В отпуске')).toBeInTheDocument()

  // Подтверждение: дата сменилась, грид ремаунчен ⇒ дельты сброшены
  fireEvent.change(dateInput, { target: { value: '2026-07-25' } })
  await user.click(screen.getByText('Сменить дату'))
  expect(dateInput.value).toBe('2026-07-25')
  await waitFor(() =>
    expect(screen.getByTestId('changed-counter')).toHaveTextContent(
      'Изменено 0 из 3',
    ),
  )
})

it('ошибка загрузки состава → role=alert, грид не монтируется', async () => {
  mockDivisions()
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json(
        envelope('INTERNAL_ERROR', 'Внутренняя ошибка сервера.', {}),
        { status: 500 },
      ),
    ),
  )
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  expect(
    await screen.findByText('Не удалось загрузить личный состав.'),
  ).toBeInTheDocument()
  expect(screen.queryByTestId('changed-counter')).not.toBeInTheDocument()
})

it('пустое подразделение → канон-строка пустого состояния', async () => {
  mockDivisions()
  mockEmployees([])
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  expect(
    await screen.findByText('Личный состав не загружен'),
  ).toBeInTheDocument()
})

it('состав длиннее cap 1000 → ВИДИМОЕ сообщение, а не молчаливая усечка', async () => {
  mockDivisions()
  const base = employeesListFixture.results[0]
  // 1200 сотрудников одной страницей: дочитка обязана упереться в MAX_BULK_ROWS
  const huge = Array.from({ length: 1200 }, (_, i) => ({
    ...base,
    id: `emp-${i}`,
    full_name: `Сотрудник ${i} Тестович`,
  }))
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json({
        count: huge.length,
        next: null,
        previous: null,
        results: huge,
      } satisfies EmployeesResponse),
    ),
  )
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  expect(
    await screen.findByText(/Показаны первые 1000 сотрудников/),
  ).toBeInTheDocument()
  // Усечка ровно по cap сериализатора 10.1a — грид не «почти всё», а известное число
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 1000',
  )
})

it('пустая дата: рантайм-гард запрещает отправку — в business_date не уедет пустая строка', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  renderPage()
  const user = await selectDivision()

  const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
  fireEvent.change(dateInput, { target: { value: '' } })

  expect(
    await screen.findByText(/Укажите дату в формате ГГГГ-ММ-ДД/),
  ).toBeInTheDocument()
  // Гард — в НЕМОНТИРОВАНИИ грида, а не в обработчике отправки: контейнер зовёт
  // toBulkRequest ДО onBulkSubmit, а тот на пустой дате падает RangeError
  // (prefill.ts:96, addDaysIso('')). Нет грида — нет ни кнопки, ни падения.
  expect(screen.queryByTestId('changed-counter')).not.toBeInTheDocument()
  expect(screen.queryByText('Сохранить правки')).not.toBeInTheDocument()
  // И панель сдачи при негодной дате тоже молчит целиком (10.3 AC-2): сдавать
  // нечего, а канон-кнопка на экране без даты была бы обманкой.
  expect(screen.queryByText('Сдать день')).not.toBeInTheDocument()
  await user.keyboard('{Control>}{Enter}{/Control}')

  // Положительный контроль в ТОМ ЖЕ тесте — иначе «ноль запросов» нечем
  // отличить от «запрос ещё в полёте»: ставим годную дату и сдаём по-настоящему.
  fireEvent.change(dateInput, { target: { value: '2026-07-25' } })
  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  await waitFor(() => expect(bodies).toHaveLength(1))
  // Ровно ОДИН POST, и он — с валидной датой: на пустой дате не ушло ничего
  // (закрытие defer 9.7 «'' просочится в business_date»)
  expect(bodies[0].business_date).toBe('2026-07-25')
})

it('состав дочитывается по next до конца (пагинация 50 на страницу)', async () => {
  mockDivisions()
  const all = Array.from({ length: 3 }, (_, i) => ({
    ...employeesListFixture.results[0],
    id: `emp-${i}`,
    full_name: NAMES[i],
  }))
  const requested: string[] = []
  server.use(
    http.get('*/api/core/employees/', ({ request }) => {
      const url = new URL(request.url)
      requested.push(url.search)
      const page = url.searchParams.get('page')
      if (page === '2') {
        return HttpResponse.json({
          count: 3,
          next: null,
          previous: null,
          results: all.slice(2),
        } satisfies EmployeesResponse)
      }
      return HttpResponse.json({
        count: 3,
        next: 'http://localhost/api/core/employees/?page=2',
        previous: null,
        results: all.slice(0, 2),
      } satisfies EmployeesResponse)
    }),
  )
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  // Все три строки на экране — вторая страница дочитана, а не потеряна
  expect(await screen.findByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 3',
  )
  expect(requested).toHaveLength(2)
  expect(requested[0]).toContain(`division_id=${DIVISION_ID}`)
  expect(requested[0]).toContain('page_size=50')
  expect(requested[1]).toContain('page=2')
})

// ───────────────────────── QA-добор 10.2 ─────────────────────────
// Ветки, реализованные в стори, но не имевшие теста: локальная зона дефолтной
// даты, подтверждение смены ПОДРАЗДЕЛЕНИЯ, обратный маппинг периода, 422-hard,
// 400-validation, сам beforeunload, чужой хост в `next`, состояния загрузки.

// Зона рантайма решает, различимы ли «сегодня локально» и «сегодня по UTC».
// На UTC-раннере они СОВПАДАЮТ при любой реализации — там тест был бы вакуумным
// (обе ветки зелёные), поэтому честнее пропустить, чем показать ложный зелёный.
const TZ_OFFSET_MIN = -new Date().getTimezoneOffset()

it.skipIf(TZ_OFFSET_MIN === 0)(
  'дефолт даты — сегодня в ЛОКАЛЬНОЙ зоне, а не UTC-срез (AC-2)',
  async () => {
    // Инстант подобран под знак смещения так, что локальная и UTC даты заведомо
    // РАЗНЫЕ: на +05:00 это 04:30 утра (UTC ещё вчера), на −05:00 — 19:30
    // (UTC уже завтра). Без такого подбора ассерт не отличал бы реализации.
    const instant =
      TZ_OFFSET_MIN > 0
        ? new Date(Date.UTC(2026, 6, 18, 23, 30))
        : new Date(Date.UTC(2026, 6, 19, 0, 30))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(instant)
    try {
      mockDivisions()
      renderPage()

      const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
      const pad = (n: number) => String(n).padStart(2, '0')
      const localToday = `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`

      expect(dateInput.value).toBe(localToday)
      // Дискриминатор: реализация через toISOString().slice(0,10) дала бы ИМЕННО
      // это значение — оператор увидел бы соседние сутки и сдал бы не тот день.
      expect(dateInput.value).not.toBe(instant.toISOString().slice(0, 10))
    } finally {
      vi.useRealTimers()
    }
  },
)

it('смена ПОДРАЗДЕЛЕНИЯ при dirty: подтверждение; отказ → селект прежний, дельты целы (AC-3)', async () => {
  mockDivisions()
  mockEmployees()
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  const select = screen.getByLabelText('Подразделение') as HTMLSelectElement
  expect(select.value).toBe(DIVISION_ID)

  fireEvent.change(select, { target: { value: SECOND_DIVISION_ID } })

  // Тот же регистр «счёт + глагол», что у даты; запрещённая формулировка не
  // проникает и сюда (EXPERIENCE.md#L94)
  expect(
    screen.getByText(
      /Изменено 1 из 3\. Сменить подразделение\? Правки будут потеряны\./,
    ),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/У вас есть несохранённые изменения/),
  ).not.toBeInTheDocument()

  await user.click(screen.getByText('Отмена'))
  // Контрол управляемый ⇒ вернулся к прежнему значению сам, состав не перезапрошен
  expect(select.value).toBe(DIVISION_ID)
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 1 из 3',
  )
  expect(within(rowOf(NAMES[0])).getByText('В отпуске')).toBeInTheDocument()

  // Согласие: подразделение сменилось, состав перезапрошен, дельты сброшены
  fireEvent.change(select, { target: { value: SECOND_DIVISION_ID } })
  await user.click(screen.getByText('Сменить подразделение'))
  expect(select.value).toBe(SECOND_DIVISION_ID)
  await waitFor(() =>
    expect(screen.getByTestId('changed-counter')).toHaveTextContent(
      'Изменено 0 из 3',
    ),
  )
  expect(within(rowOf(NAMES[0])).getByText('В строю')).toBeInTheDocument()
})

it('успех: строка с ЯВНЫМ периодом не остаётся грязной — обратный маппинг [start,end) (AC-8)', async () => {
  mockDivisions()
  mockEmployees()
  const bodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  renderPage()
  const user = await selectDivision()

  // Дата фиксируется ЯВНО: при businessDate == 2026-07-25 период «по 25-е»
  // схлопнулся бы в однодневный date_end и тест зависел бы от календаря прогона.
  const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
  fireEvent.change(dateInput, { target: { value: '2026-07-20' } })
  await screen.findByTestId('changed-counter')

  // Правим ПЕРИОД строки 0: NAVIGATE(status) → ArrowRight(period) → Enter(редактор)
  await user.keyboard('{ArrowRight}{Enter}')
  fireEvent.change(screen.getByLabelText('Период'), {
    target: { value: '2026-07-25' },
  })
  await user.keyboard('{Enter}')
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 1 из 3',
  )

  await user.click(screen.getByText('Сохранить правки'))

  await waitFor(() => expect(bodies).toHaveLength(1))
  const body = bodies[0] as { rows: { date_end: string }[] }
  // UI «по 25-е включительно» → полуинтервал бэка [20-е, 26-е) (ARCH-DATA-023)
  expect(body.rows[0].date_end).toBe('2026-07-26')

  expect(await screen.findByText('Применено 1 отклонений')).toBeInTheDocument()
  // База сдвинулась ОБРАТНЫМ маппингом (date_end − 1д). Ошибка на день оставила
  // бы строку грязной навсегда: экран показывает 25-е, база помнила бы 26-е.
  await waitFor(() =>
    expect(screen.getByTestId('changed-counter')).toHaveTextContent(
      'Изменено 0 из 3',
    ),
  )
  expect(within(rowOf(NAMES[0])).getByText('2026-07-25')).toBeInTheDocument()
})

it('422 hard: метка «Нельзя», неизвестный employee_id показан как сам id (AC-9)', async () => {
  mockDivisions()
  mockEmployees()
  captureBulk(() =>
    HttpResponse.json(
      envelope(
        'OVERLAPPING_HARD_STATUS',
        'Массовое обновление отклонено: см. detail.rows.',
        {
          rows: [
            {
              index: 0,
              employee_id: 'emp-0',
              code: 'OVERLAPPING_HARD_STATUS',
              http_status: 422,
              message: 'Статус конфликтует с hard-статусом сотрудника.',
            },
            {
              index: 1,
              // Сотрудника нет в загруженном составе: ФИО резолвить не из чего
              employee_id: 'emp-404',
              code: 'EMPLOYEE_NOT_FOUND',
              http_status: 422,
              message: 'Сотрудник не найден на дату статуса.',
            },
          ],
        },
      ),
      { status: 422 },
    ),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await editCurrentRow(user, 'SICK_LEAVE')
  await user.click(screen.getByText('Сохранить правки'))

  // hard-отказ маркируется ИНАЧЕ, чем soft: цвет не единственный сигнал, метка
  // обязана меняться вместе с ним (EXPERIENCE.md#L238)
  expect(await screen.findByText(/^Нельзя:/)).toBeInTheDocument()
  expect(screen.queryByText(/^Конфликт:/)).not.toBeInTheDocument()

  expect(
    screen.getByText(
      `Строка 1 · ${NAMES[0]} · Статус конфликтует с hard-статусом сотрудника.`,
    ),
  ).toBeInTheDocument()
  // Неизвестный id не прячется и не роняет панель — показывается как есть
  expect(
    screen.getByText('Строка 2 · emp-404 · Сотрудник не найден на дату статуса.'),
  ).toBeInTheDocument()

  // Атомарность: ввод остаётся правимым, база не сдвинулась
  expect(screen.getByTestId('changed-counter')).toHaveTextContent(
    'Изменено 2 из 3',
  )
  expect(document.querySelector('dialog')).toBeNull()
})

it('400 VALIDATION_ERROR → инлайн-список причин из details (AC-10)', async () => {
  mockDivisions()
  mockEmployees()
  captureBulk(() =>
    HttpResponse.json(
      envelope('VALIDATION_ERROR', 'Проверьте заполнение формы.', {
        rows: ['Не более 1000 строк.', 'Дубликат сотрудника в payload.'],
        business_date: 'Обязательное поле.',
      }),
      { status: 400 },
    ),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  expect(
    await screen.findByText(/^Нельзя: Проверьте заполнение формы\./),
  ).toBeInTheDocument()
  // Причины по полям — списком, а не свалкой в одну строку
  expect(screen.getByText('rows: Не более 1000 строк.')).toBeInTheDocument()
  expect(
    screen.getByText('rows: Дубликат сотрудника в payload.'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('business_date: Обязательное поле.'),
  ).toBeInTheDocument()
  // 400 — не конфликт: построчная панель конфликта не подменяет валидацию
  expect(screen.queryByText(/^Конфликт:/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Ничего не сохранено/)).not.toBeInTheDocument()
})

it('beforeunload: навешан при dirty > 0 и СНЯТ после успешной отправки (AC-11)', async () => {
  mockDivisions()
  mockEmployees()
  captureBulk(() => HttpResponse.json({ created: 1 }, { status: 201 }))
  renderPage()
  const user = await selectDivision()

  /** Реальный сигнал вкладки: закрытие тормозится только preventDefault. */
  function unloadBlocked(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  // Чистый экран не должен мешать оператору уйти
  expect(unloadBlocked()).toBe(false)

  await editCurrentRow(user, 'VACATION')
  expect(unloadBlocked()).toBe(true)

  await user.click(screen.getByText('Сохранить правки'))
  expect(await screen.findByText('Применено 1 отклонений')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByTestId('changed-counter')).toHaveTextContent(
      'Изменено 0 из 3',
    ),
  )

  // После сдачи терять нечего — обработчик обязан сняться, иначе оператор
  // получает «уйти со страницы?» на пустом месте и перестаёт ему верить
  expect(unloadBlocked()).toBe(false)
})

it('дочитка по next не уходит на ЧУЖОЙ хост: origin принудительно свой (AC-4)', async () => {
  mockDivisions()
  const all = Array.from({ length: 3 }, (_, i) => ({
    ...employeesListFixture.results[0],
    id: `emp-${i}`,
    full_name: NAMES[i],
  }))
  const requestedUrls: string[] = []
  server.use(
    http.get('*/api/core/employees/', ({ request }) => {
      requestedUrls.push(request.url)
      const url = new URL(request.url)
      if (url.searchParams.get('page') === '2') {
        return HttpResponse.json({
          count: 3,
          next: null,
          previous: null,
          results: all.slice(2),
        } satisfies EmployeesResponse)
      }
      // DRF отдаёт АБСОЛЮТНЫЙ next и строит его из заголовка Host. Подменённый
      // Host (обратный прокси, донор-хост в конфиге) увёл бы дочитку состава на
      // чужой origin — вместе с cookie/креденшлом запроса.
      return HttpResponse.json({
        count: 3,
        next: 'http://donor.example.org/api/core/employees/?page=2',
        previous: null,
        results: all.slice(0, 2),
      } satisfies EmployeesResponse)
    }),
  )
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  expect(await screen.findByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 3',
  )
  expect(requestedUrls).toHaveLength(2)
  // Путь и query сохранены, origin — свой: дочитка состоялась, но «дома»
  expect(new URL(requestedUrls[1]).origin).toBe(window.location.origin)
  expect(requestedUrls[1]).not.toContain('donor.example.org')
  expect(requestedUrls[1]).toContain('page=2')
})

it('смена подразделения при dirty, новый состав НЕ загрузился → dirty сброшен: beforeunload снят, повторная смена без допроса (ревью 10.2)', async () => {
  mockDivisions()
  mockEmployees()
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')

  function unloadBlocked(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(unloadBlocked()).toBe(true)

  // Второе подразделение отвечает 500: грид размонтирован и НЕ ремаунтится —
  // некому сообщить onDirtyChange(0), сброс обязан сделать САМ экран в момент
  // подтверждённой смены (подтверждение = согласие уничтожить дельты).
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json(
        envelope('INTERNAL_ERROR', 'Внутренняя ошибка сервера.', {}),
        { status: 500 },
      ),
    ),
  )
  const select = screen.getByLabelText('Подразделение') as HTMLSelectElement
  fireEvent.change(select, { target: { value: SECOND_DIVISION_ID } })
  await user.click(screen.getByText('Сменить подразделение'))
  expect(
    await screen.findByText('Не удалось загрузить личный состав.'),
  ).toBeInTheDocument()

  // Дельты уничтожены вместе с гридом: держать вкладку и допрашивать оператора
  // не о чем — иначе фантомное «Изменено 1 из 0. Сменить дату?» на пустом экране
  expect(unloadBlocked()).toBe(false)
  fireEvent.change(screen.getByLabelText('Дата'), {
    target: { value: '2026-07-25' },
  })
  expect(screen.queryByText(/Правки будут потеряны/)).not.toBeInTheDocument()
  expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(
    '2026-07-25',
  )
})

it('дочитка не зацикливается на битом next без прогресса: пустая страница с next → стоп (ревью 10.2)', async () => {
  mockDivisions()
  // Патологический ответ (битый прокси/донор): страница ПУСТАЯ, но next есть.
  // Без гарда прогресса цикл дочитки крутился бы вечно — экран не дождался бы
  // ни состава, ни пустого состояния (cap 1000 не срабатывает: длина не растёт).
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json({
        count: 0,
        next: 'http://localhost/api/core/employees/?page=2',
        previous: null,
        results: [],
      } satisfies EmployeesResponse),
    ),
  )
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  await user.selectOptions(select, DIVISION_ID)

  expect(
    await screen.findByText('Личный состав не загружен'),
  ).toBeInTheDocument()
})

it('состояния загрузки — из Query, оба с role="status" (AC-4)', async () => {
  // Ответы держит САМ ТЕСТ, а не таймер: «запрос в полёте» обязан быть
  // состоянием, которым мы управляем, иначе тест зависит от скорости раннера.
  let releaseDivisions = () => {}
  let releaseEmployees = () => {}
  const divisionsInFlight = new Promise<void>((r) => (releaseDivisions = r))
  const employeesInFlight = new Promise<void>((r) => (releaseEmployees = r))
  server.use(
    http.get('*/api/core/divisions/', async () => {
      await divisionsInFlight
      return HttpResponse.json(divisionsFixture)
    }),
    http.get('*/api/core/employees/', async () => {
      await employeesInFlight
      return HttpResponse.json({
        count: NAMES.length,
        next: null,
        previous: null,
        results: employeeFixtures(),
      } satisfies EmployeesResponse)
    }),
  )
  const user = userEvent.setup()
  renderPage()

  // Пока список подразделений в полёте — селект нечем наполнить и он заблокирован
  expect(screen.getByText('Загрузка подразделений…')).toHaveAttribute(
    'role',
    'status',
  )
  expect(screen.getByLabelText('Подразделение')).toBeDisabled()

  releaseDivisions()
  const select = await screen.findByLabelText('Подразделение')
  await screen.findByRole('option', { name: 'Первый отдел' })
  expect(screen.queryByText('Загрузка подразделений…')).not.toBeInTheDocument()

  await user.selectOptions(select, DIVISION_ID)
  // Состав в полёте: грид не монтируется пустым (это читалось бы как «никого нет»)
  expect(screen.getByText('Загрузка личного состава…')).toHaveAttribute(
    'role',
    'status',
  )
  expect(screen.queryByTestId('changed-counter')).not.toBeInTheDocument()
  expect(screen.queryByText('Личный состав не загружен')).not.toBeInTheDocument()

  releaseEmployees()
  expect(await screen.findByTestId('changed-counter')).toHaveTextContent(
    'Изменено 0 из 3',
  )
})

// ── Стори 10.3 — экран сдачи дня ─────────────────────────────────────────────

it('10.3: две кнопки — два РАЗНЫХ действия (кнопка грида день не сдаёт)', async () => {
  mockDivisions()
  mockEmployees()
  const bulkBodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  const submissions = captureSubmissions()
  renderPage()
  const user = await selectDivision()

  // Обе кнопки на экране одновременно, и надписи РАЗНЫЕ — иначе одна из них
  // лгала бы (главное открытие стори).
  expect(screen.getByText('Сохранить правки')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сдать день' })).toBeInTheDocument()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  await waitFor(() => expect(bulkBodies).toHaveLength(1))
  // Кнопка грида шлёт ТОЛЬКО дельты статусов: ряд в ops_daily_submissions от
  // неё не появляется.
  expect(submissions).toHaveLength(0)
})

it('10.3: живая сдача с экрана → POST daily-submissions, день переходит в «сдан»', async () => {
  mockDivisions()
  mockEmployees()
  const submissions = captureSubmissions()
  renderPage()
  const user = await selectDivision()

  await user.click(screen.getByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  await waitFor(() => expect(submissions).toHaveLength(1))
  expect(submissions[0]).toEqual({
    division_id: DIVISION_ID,
    business_date: TODAY_ISO,
  })
  expect(await screen.findByTestId('day-submission-state')).toHaveTextContent(
    'День сдан',
  )
})

it('10.3 AC-4: несохранённые правки блокируют сдачу (POST сдачи не уходит)', async () => {
  mockDivisions()
  mockEmployees()
  captureBulk(() => HttpResponse.json({ created: 1 }, { status: 201 }))
  const submissions = captureSubmissions()
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  expect(screen.getByTestId('changed-counter')).toHaveTextContent('Изменено 1 из 3')

  await user.click(screen.getByRole('button', { name: 'Сдать день' }))

  expect(screen.getByText('Сначала сохраните правки: изменено 1')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(submissions).toHaveLength(0)
})

it('10.3 AC-10: drift появляется ТОЛЬКО на сданном дне; смена даты его снимает', async () => {
  mockDivisions()
  mockEmployees()
  // День уже сдан — значит последующая правка статусов расходится со снапшотом.
  mockDayState([daySubmissionFixture()])
  captureBulk(() => HttpResponse.json({ created: 1 }, { status: 201 }))
  renderPage()
  const user = await selectDivision()
  await screen.findByTestId('day-submission-state')

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  const drift = await screen.findByTestId('day-submission-drift')
  // ФИО — из nameById, подпись статуса — из STATUS_TYPE_OPTIONS (не код).
  expect(drift).toHaveTextContent('Абдуллаев Асхат Маратович')
  expect(drift).toHaveTextContent('В отпуске')

  // Смена даты уносит маркер: он принадлежит КОНКРЕТНОМУ дню (класс
  // «фантомный флаг переживает смену контекста», ревью 10.2).
  fireEvent.change(screen.getByLabelText('Дата'), {
    target: { value: '2026-07-25' },
  })
  await waitFor(() =>
    expect(screen.queryByTestId('day-submission-drift')).not.toBeInTheDocument(),
  )
})

it('10.3 AC-10: на НЕсданном дне успешная отправка дельт drift НЕ поднимает', async () => {
  mockDivisions()
  mockEmployees()
  // Дефолтный хендлер уже отдаёт «день не сдан» — фиксируем это явно.
  mockDayState([])
  captureBulk(() => HttpResponse.json({ created: 1 }, { status: 201 }))
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))

  // Положительный контроль: отправка РЕАЛЬНО прошла — значит отсутствие
  // маркера объясняется несданным днём, а не тем, что ничего не отправлялось.
  expect(await screen.findByText(/Применено 1 отклонений/)).toBeInTheDocument()
  expect(screen.queryByTestId('day-submission-drift')).not.toBeInTheDocument()
})

it('10.3 AC-10: правки, сохранённые ДО сдачи, drift-ом не становятся (они внутри снапшота)', async () => {
  mockDivisions()
  mockEmployees()
  // День ещё не сдан — сохраняем правки, и лишь ПОТОМ сдаём день.
  let daySubmitted = false
  server.use(
    http.get('*/api/operations/daily-submissions/', () =>
      HttpResponse.json({
        count: daySubmitted ? 1 : 0,
        next: null,
        previous: null,
        results: daySubmitted ? [daySubmissionFixture()] : [],
      }),
    ),
    http.post('*/api/operations/daily-submissions/', () => {
      daySubmitted = true
      return HttpResponse.json(daySubmissionFixture(), { status: 201 })
    }),
  )
  const bulkBodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')
  await user.click(screen.getByText('Сохранить правки'))
  await waitFor(() => expect(bulkBodies).toHaveLength(1))

  // Теперь сдаём день: submit_day снимет снапшот с УЖЕ СОХРАНЁННЫМ статусом —
  // расходиться не с чем.
  await user.click(screen.getByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))
  await screen.findByTestId('day-submission-state')

  // Маркер «расход разошёлся» здесь был бы ЛОЖНОЙ тревогой.
  expect(screen.queryByTestId('day-submission-drift')).not.toBeInTheDocument()
})

// ── QA-добор покрытия (qa-generate-e2e-tests, 2026-07-19) ────────────────────
// Сцепка «экран → parseSubmissionList → currentSubmission → панель» и
// enabled-гарды: юнит проверяет функции, панель — рендер по пропу, а провод
// между ними до этих тестов не проверял никто.

it('10.3 AC-2: строки ЕСТЬ, но is_current нет ни у одной → «День не сдан» (три состояния, не два)', async () => {
  mockDivisions()
  mockEmployees()
  // Селектор бэка по is_current НЕ фильтрует — после цепочки amendment
  // приходят ВСЕ версии дня. Решение принимает ФЛАГ, а не results.length:
  // иначе исторические версии читались бы как «день сдан», кнопка сдачи
  // исчезла бы, и день остался бы несданным молча.
  mockDayState([
    daySubmissionFixture({ id: 1, version: 1, is_current: false }),
    daySubmissionFixture({ id: 2, version: 2, is_current: false }),
  ])
  renderPage()
  await selectDivision()

  expect(await screen.findByText(/День не сдан/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сдать день' })).toBeInTheDocument()
  expect(screen.queryByTestId('day-submission-state')).not.toBeInTheDocument()
})

it('10.3 AC-2: до выбора подразделения запрос состояния дня НЕ уходит (enabled-гард)', async () => {
  mockDivisions()
  mockEmployees()
  let dayStateCalls = 0
  server.use(
    http.get('*/api/operations/daily-submissions/', () => {
      dayStateCalls += 1
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }),
  )
  renderPage()
  await screen.findByRole('option', { name: 'Первый отдел' })

  // divisionId === null ⇒ строка запроса собралась бы с «null» в фильтре и
  // ушла бы на сервер мусором.
  expect(dayStateCalls).toBe(0)

  // Положительный контроль: после выбора запрос ВСЁ-ТАКИ уходит — без него
  // ноль объяснялся бы тем, что запроса нет вовсе (вакуум).
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('Подразделение'), DIVISION_ID)
  await waitFor(() => expect(dayStateCalls).toBeGreaterThan(0))
})

it('10.3 AC-2: 403 по ПРАВУ на чтении состояния дня → role="alert", а не молчаливый «день не сдан»', async () => {
  mockDivisions()
  mockEmployees()
  // 403 по СКОУПУ на списке не бывает (селектор сужает видимость молча), но
  // 403 по ПРАВУ бывает: гейт миксина (views.py:120) отсекает актора без
  // daily_report.mark_update. Трактовать отказ чтения как пустой день значило
  // бы показать кнопку сдачи там, где читать нельзя вовсе.
  server.use(
    http.get('*/api/operations/daily-submissions/', () =>
      HttpResponse.json(envelope('PERMISSION_DENIED', 'PERMISSION_DENIED', {}), {
        status: 403,
      }),
    ),
  )
  renderPage()
  await selectDivision()

  const alert = await screen.findByText(/Не удалось прочитать состояние дня/)
  expect(alert).toHaveAttribute('role', 'alert')
  expect(screen.queryByRole('button', { name: 'Сдать день' })).not.toBeInTheDocument()
})

it('10.3 AC-11: Ctrl+Enter при фокусе ВНУТРИ панели сохраняет правки (квирк зафиксирован, а не «починен»)', async () => {
  mockDivisions()
  mockEmployees()
  const bulkBodies = captureBulk(() =>
    HttpResponse.json({ created: 1 }, { status: 201 }),
  )
  const submissions = captureSubmissions()
  renderPage()
  const user = await selectDivision()

  await editCurrentRow(user, 'VACATION')

  // handleKeyDownCapture висит на КОРНЕВОМ div экрана, который теперь
  // оборачивает и панель ⇒ Ctrl+Enter при фокусе в панели тоже сохраняет
  // правки. Это согласовано с AC-4 (сдавать при несохранённых правках всё
  // равно нельзя) и специально не «чинится» — но обязано быть зафиксировано
  // тестом: без него завтрашняя правка обработчика уедет молча, а сдача
  // получила бы клавиатурный шорткат, которого ей намеренно не дали
  // (epic-AC: «сдача — осознанное действие»).
  const submitDay = screen.getByRole('button', { name: 'Сдать день' })
  submitDay.focus()
  expect(document.activeElement).toBe(submitDay)

  await user.keyboard('{Control>}{Enter}{/Control}')

  await waitFor(() => expect(bulkBodies).toHaveLength(1))
  expect(submissions).toHaveLength(0)
  // И подтверждение сдачи от шортката не открылось.
  expect(screen.queryByRole('button', { name: 'Подтвердить сдачу' })).not.toBeInTheDocument()
})

// ───────────────────────────────────────────────────────────────────────────
// Story 10.6 AC-8, мутация №3 — единственная точка, где ИНВАЛИДАЦИЯ наблюдаема.
//
// Почему тест живёт здесь, а не в DaySubmissionPanel.test.tsx: владелец
// запроса дня — ЭКРАН (Решение №7 стори 10.3). В панельном тесте список версий
// приходит статичным пропом, и «перечитку» пришлось бы имитировать ручным
// rerender — такая проба осталась бы ЗЕЛЁНОЙ после удаления `invalidateQueries`
// (тест сам двигал бы данные). Красит только настоящий рефетч.
//
// И красит именно СПИСОК, а не шапку: «День сдан: v2» рисуется из локального
// ответа мутации (AC-4) и от инвалидации не зависит вовсе.
// ───────────────────────────────────────────────────────────────────────────
it('10.6 AC-4/AC-8: после 201 состояние дня ПЕРЕЧИТАНО — в списке версий видны ОБЕ версии', async () => {
  const v1 = daySubmissionFixture({ id: 77, version: 1, is_current: true })
  const v2 = daySubmissionFixture({
    id: 78,
    version: 2,
    is_current: true,
    event: 'AMENDED',
    submitted_by: 'operator-9',
    submitted_at: '2026-07-19T17:40:00+05:00',
  })

  // Последовательная фикстура (счётчик вызовов): до POST день — [v1], после —
  // [v2(действующая), v1]. Без счётчика перечитка вернула бы дефолтный ПУСТОЙ
  // конверт (handlers.ts:200), и тест покраснел бы по инфраструктуре, а не по
  // логике — ровно та ложная улика, которую AC-8 запрещает.
  mockDivisions()
  mockEmployees()

  let dayReads = 0
  server.use(
    http.get('*/api/operations/daily-submissions/', ({ request }) => {
      const url = new URL(request.url)
      // История подразделения (без business_date) — отдельный запрос панели:
      // счётчик дня он трогать не должен.
      if (url.searchParams.get('business_date') === null) {
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }
      dayReads += 1
      const rows = dayReads === 1 ? [v1] : [v2, { ...v1, is_current: false }]
      return HttpResponse.json({
        count: rows.length,
        next: null,
        previous: null,
        results: rows,
      })
    }),
    http.post('*/api/operations/daily-submissions/:id/amend/', () =>
      HttpResponse.json(v2, { status: 201 }),
    ),
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({
        permissions: ['daily_report.mark_update', 'status.view', 'daily_report.correct'],
      }),
    ),
  )
  setCredential({ kind: 'dev', userId: 'operator-1' })

  renderPage()
  const user = await selectDivision()

  await user.click(await screen.findByRole('button', { name: 'Исправить сдачу' }))
  await user.type(screen.getByLabelText('Причина'), 'Ошибка в ростере')
  await user.type(screen.getByLabelText(/Санкция/), 'Выговор')
  await user.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))

  // Ассерты скоуплены (ловушка №8): подпись версии совпала бы с блоком
  // состояния дня, и незаскоупленный запрос упал бы «found multiple».
  const versions = await screen.findByTestId('day-versions')
  await waitFor(() =>
    expect(within(versions).getAllByRole('listitem')).toHaveLength(2),
  )
  const rows = within(versions).getAllByRole('listitem')
  expect(rows[0]).toHaveTextContent('v2 · Исправлено')
  expect(rows[0]).toHaveTextContent('действующая')
  expect(rows[1]).toHaveTextContent('v1 · Изменено')
  expect(rows[1]).not.toHaveTextContent('действующая')
  // День реально перечитан, а не показан из локального ответа мутации.
  expect(dayReads).toBeGreaterThanOrEqual(2)
})
