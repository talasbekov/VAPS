// @vitest-environment jsdom
// Story 10.3 — панель сдачи дня.
//
// Ловушка окружения №1: дефолтные MSW-фикстуры уже заняли ЭТОТ путь —
// `POST */api/operations/daily-submissions/` отдаёт 422, а `GET` (добавлен этой
// стори) — пустой конверт «день не сдан». При onUnhandledRequest: 'error' любой
// успешный сценарий ОБЯЗАН перекрыть POST через server.use — иначе он никогда
// не заработает.
//
// Ловушка №1b: дефолтный 422-конверт `allowed` НЕ несёт (details =
// {business_date: …}). Тест AC-5 подставляет СВОЙ конверт, и даты в нём
// намеренно отличаются от «сегодня/завтра» браузера — иначе ассерт «показаны
// даты из ответа» был бы вакуумен (он проходил бы и на своём предположении).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { server } from '../../shared/api/testing/server'
import { ToastProvider } from '../../shared/ui/toast'
import { todayLocalIso } from './daySubmission'
import type { DaySubmission } from './daySubmission'
import { DaySubmissionPanel } from './DaySubmissionPanel'
import type { DaySubmissionPanelProps } from './DaySubmissionPanel'

afterEach(() => cleanup())

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const TODAY = todayLocalIso()

function submissionFixture(over: Partial<DaySubmission> = {}): DaySubmission {
  return {
    id: 12,
    division_id: DIVISION_ID,
    business_date: TODAY,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    ...over,
  }
}

/** Конверт LimitOffsetPagination. Типа из схемы у этих путей нет (Решение №3). */
function envelope(results: DaySubmission[]) {
  return { count: results.length, next: null, previous: null, results }
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
    request_id: 'req-10-3',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

function renderPanel(
  over: Partial<DaySubmissionPanelProps> = {},
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  const props: DaySubmissionPanelProps = {
    divisionId: DIVISION_ID,
    businessDate: TODAY,
    dateValid: true,
    rowCount: 40,
    dirtyCount: 0,
    localDrift: [],
    submission: null,
    isLoading: false,
    isError: false,
    ...over,
  }
  return render(<DaySubmissionPanel {...props} />, { wrapper: Wrapper })
}

/** Тела ушедших POST — источник истины «сколько отправок и с чем». */
function capturePost(
  respond: () => Response | Promise<Response>,
): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.post('*/api/operations/daily-submissions/', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>)
      return respond()
    }),
  )
  return bodies
}

it('день НЕ сдан → «День не сдан» + кнопка «Сдать день»', async () => {
  renderPanel()
  expect(await screen.findByText(/День не сдан/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сдать день' })).toBeInTheDocument()
})

it('день сдан → версия/событие/автор; кнопки сдачи НЕТ', async () => {
  renderPanel({ submission: submissionFixture({ version: 2, event: 'AMENDED' }) })

  const state = await screen.findByTestId('day-submission-state')
  expect(state).toHaveTextContent('День сдан')
  expect(state).toHaveTextContent('v2')
  // Подпись — ДОСЛОВНО из DailySubmission.Event, не своя формулировка.
  expect(state).toHaveTextContent('Исправлено')
  expect(state).toHaveTextContent('operator-1')
  expect(screen.queryByRole('button', { name: 'Сдать день' })).not.toBeInTheDocument()
})

it('late: true → метка опоздания (при late: false её нет)', async () => {
  const { unmount } = renderPanel({ submission: submissionFixture({ late: true }) })
  expect(await screen.findByText(/сдано с опозданием/)).toBeInTheDocument()
  unmount()

  renderPanel({ submission: submissionFixture({ late: false }) })
  await screen.findByTestId('day-submission-state')
  expect(screen.queryByText(/сдано с опозданием/)).not.toBeInTheDocument()
})

it('подтверждение → РОВНО один POST с телом СТРОГО {division_id, business_date}', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  // Канон-строка подтверждения — EXPERIENCE.md#L116, дословно.
  expect(
    screen.getByText(
      'Сдать день? Изменено 0 из 40. После сдачи лист станет зелёным.',
    ),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  await waitFor(() => expect(bodies).toHaveLength(1))
  // ARCH-SEC-030: submitted_by бэк игнорирует — отправлять его нельзя.
  expect(Object.keys(bodies[0]).sort()).toEqual(['business_date', 'division_id'])
  expect(bodies[0]).toEqual({ division_id: DIVISION_ID, business_date: TODAY })
})

it('отмена подтверждения → POST не ушёл, панель закрыта', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Отмена' }))

  expect(screen.queryByText(/После сдачи лист станет зелёным/)).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(bodies).toHaveLength(0)
})

it('успех: подпись события — ИЗ ОТВЕТА, даже когда она противоречит предсказанию', async () => {
  // Фикстура намеренно противоречит: предсказание при 0 дельт и ОТСУТСТВИИ
  // предыдущей сдачи — «Изменено» (сервер: previous is None → CHANGED),
  // а ответ приносит CONFIRMED_NO_CHANGES. Без противоречия ассерт был бы
  // вакуумен — прошёл бы и на локальной догадке.
  capturePost(() =>
    HttpResponse.json(submissionFixture({ event: 'CONFIRMED_NO_CHANGES' }), {
      status: 201,
    }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  expect(screen.getByText(/ожидается: Изменено/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  const state = await screen.findByTestId('day-submission-state')
  expect(state).toHaveTextContent('Подтверждено без изменений')
  expect(state).not.toHaveTextContent('ожидается')
  // Панель подтверждения закрылась, экран перешёл в «День сдан».
  expect(screen.queryByText(/После сдачи лист станет зелёным/)).not.toBeInTheDocument()
})

it('предпросмотр: есть предыдущая сдача и 0 дельт → «ожидается: Подтверждено без изменений»', async () => {
  server.use(
    http.get('*/api/operations/daily-submissions/', ({ request }) => {
      const url = new URL(request.url)
      // История подразделения (без business_date-фильтра) — пятничная сдача.
      if (url.searchParams.get('business_date') === null) {
        return HttpResponse.json(
          envelope([submissionFixture({ id: 4, business_date: '2020-01-03' })]),
        )
      }
      return HttpResponse.json(envelope([]))
    }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await waitFor(() =>
    expect(
      screen.getByText(/ожидается: Подтверждено без изменений/),
    ).toBeInTheDocument(),
  )
  // Предсказание НЕ выдаётся за истину (AC-3).
  expect(screen.getByText(/окончательную категорию определяет сервер/)).toBeInTheDocument()
})

it('AC-4: dirtyCount > 0 → клик НЕ отправляет и объясняет причину', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel({ dirtyCount: 3, rowCount: 40 })

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))

  expect(screen.getByText('Сначала сохраните правки: изменено 3')).toBeInTheDocument()
  // Панель подтверждения даже не открылась — тупика «подтвердить нельзя» нет.
  expect(screen.queryByRole('button', { name: 'Подтвердить сдачу' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(bodies).toHaveLength(0)
  // Запрещённая формулировка EXPERIENCE.md#L94.
  expect(screen.queryByText(/У вас есть несохранённые изменения/)).not.toBeInTheDocument()
})

it('AC-5: дата вне окна {сегодня, завтра} → POST не отправляется', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel({ businessDate: '2020-01-01' })

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))

  expect(
    screen.getByText('Сдать можно только за сегодня или завтра.'),
  ).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(bodies).toHaveLength(0)
})

it('AC-5: 422 → показаны даты ИЗ ОТВЕТА, а не своё предположение', async () => {
  // Даты конверта намеренно НЕ равны «сегодня/завтра» браузера: совпади они —
  // ассерт прошёл бы и на пересказе собственного окна (вакуум).
  capturePost(() =>
    HttpResponse.json(
      errorEnvelope(
        'BUSINESS_DATE_OUT_OF_WINDOW',
        'business_date вне окна первичной сдачи.',
        { allowed: ['2031-03-09', '2031-03-10'] },
      ),
      { status: 422 },
    ),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  expect(await screen.findByText(/2031-03-09/)).toBeInTheDocument()
  expect(screen.getByText(/2031-03-10/)).toBeInTheDocument()
  expect(screen.queryByText(new RegExp(TODAY))).not.toBeInTheDocument()
})

it('AC-8: 409 → путь назван, ConflictDialog НЕ поднимается, состояние перечитано', async () => {
  capturePost(() =>
    HttpResponse.json(
      errorEnvelope('DAY_ALREADY_SUBMITTED', 'Подразделение уже сдало этот день.', {
        division_id: DIVISION_ID,
        business_date: TODAY,
      }),
      { status: 409 },
    ),
  )
  // Запрос состояния дня принадлежит ЭКРАНУ (Решение №7), в этом тесте его
  // никто не монтирует — поэтому «перечитано» проверяется по вызову
  // инвалидации С ТОЧНЫМ КЛЮЧОМ: промах по ключу даёт молчаливый no-op, и
  // именно он был бы настоящим багом.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const user = userEvent.setup()
  renderPanel({}, queryClient)

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  expect(
    await screen.findByText('День уже сдан. Пересдача — через исправление (amendment).'),
  ).toBeInTheDocument()
  // DAY_ALREADY_SUBMITTED нет в OVERRIDABLE_CODES ⇒ диалога быть не может.
  expect(document.querySelector('dialog')).toBeNull()
  expect(screen.queryByLabelText(/причин/i)).not.toBeInTheDocument()
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['day-submission', DIVISION_ID, TODAY],
    }),
  )
})

it('AC-8: перечитка после 409 принесла «День сдан» → открытое подтверждение ЗАКРЫВАЕТСЯ (ревью 10.3)', async () => {
  // Вторая половина AC-8. Существующий 409-тест не обновляет проп submission —
  // а на живом экране инвалидация приносит сданный день, и `confirming`
  // остаётся true: без гарда рендера под «День сдан» висело бы открытое
  // подтверждение с АКТИВНОЙ «Подтвердить сдачу» — та же обманка, что и
  // кнопка-открывашка, только этажом ниже.
  const bodies = capturePost(() =>
    HttpResponse.json(
      errorEnvelope('DAY_ALREADY_SUBMITTED', 'Подразделение уже сдало этот день.', {
        division_id: DIVISION_ID,
        business_date: TODAY,
      }),
      { status: 409 },
    ),
  )
  const user = userEvent.setup()
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
  const base: DaySubmissionPanelProps = {
    divisionId: DIVISION_ID,
    businessDate: TODAY,
    dateValid: true,
    rowCount: 40,
    dirtyCount: 0,
    localDrift: [],
    submission: null,
    isLoading: false,
    isError: false,
  }
  const { rerender } = render(<DaySubmissionPanel {...base} />, { wrapper: Wrapper })

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))
  await screen.findByText('День уже сдан. Пересдача — через исправление (amendment).')
  expect(bodies).toHaveLength(1)

  // Экран перечитал состояние дня (инвалидация из AC-8-эффекта) и передал
  // сдачу пропом — ключ панели НЕ менялся: день и подразделение те же.
  rerender(<DaySubmissionPanel {...base} submission={submissionFixture()} />)

  expect(await screen.findByTestId('day-submission-state')).toHaveTextContent('День сдан')
  // Ни открывашки, ни активного подтверждения на сданном дне не осталось.
  expect(screen.queryByRole('button', { name: 'Подтвердить сдачу' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Сдать день' })).not.toBeInTheDocument()
})

it('AC-9: 403 → фиксированный текст с правом daily_report.mark_update', async () => {
  // scope_gate бросает БЕЗ message ⇒ конверт несёт сам код: рендер
  // error.message показал бы оператору «PERMISSION_DENIED».
  capturePost(() =>
    HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'), {
      status: 403,
    }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  expect(await screen.findByText(/daily_report\.mark_update/)).toBeInTheDocument()
  expect(screen.queryByText(/PERMISSION_DENIED/)).not.toBeInTheDocument()
})

it('AC-9: 404 → «Подразделение не найдено»', async () => {
  capturePost(() =>
    HttpResponse.json(
      errorEnvelope('ENTITY_NOT_FOUND', 'Подразделение не найдено.', {
        division_id: DIVISION_ID,
      }),
      { status: 404 },
    ),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  expect(await screen.findByText(/Подразделение не найдено/)).toBeInTheDocument()
})

it('AC-9: 500 → инлайна НЕТ (тост useApiMutation не дублируется)', async () => {
  capturePost(() =>
    HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Внутренняя ошибка сервера.'), {
      status: 500,
    }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  // Положительный контроль: тост ЕСТЬ — значит отказ реально случился и
  // «инлайна нет» объясняется молчанием панели, а не тем, что POST не ушёл.
  expect(await screen.findByText(/сервис временно недоступен/)).toBeInTheDocument()
  expect(screen.queryByTestId('day-submission-failure')).not.toBeInTheDocument()
})

it('AC-6: двойное подтверждение при isPending → РОВНО один POST', async () => {
  let resolveResponse!: () => void
  const gate = new Promise<void>((resolve) => {
    resolveResponse = resolve
  })
  const bodies = capturePost(async () => {
    await gate
    return HttpResponse.json(submissionFixture(), { status: 201 })
  })
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  const confirm = screen.getByRole('button', { name: 'Подтвердить сдачу' })
  await user.click(confirm)
  await user.click(confirm)
  await user.click(confirm)

  resolveResponse()
  await screen.findByTestId('day-submission-state')
  expect(bodies).toHaveLength(1)
})

it('AC-10: маркер локального drift с ФИО и статусом; без drift маркера нет', async () => {
  const { unmount } = renderPanel({
    submission: submissionFixture(),
    localDrift: [
      {
        employeeId: 'emp-0',
        fullName: 'Абдуллаев Асхат Маратович',
        statusLabel: 'На больничном',
      },
    ],
  })

  const drift = await screen.findByTestId('day-submission-drift')
  expect(drift).toHaveTextContent('Расход разошёлся с тем, что сдано')
  expect(drift).toHaveTextContent('Абдуллаев Асхат Маратович')
  expect(drift).toHaveTextContent('На больничном')
  // Граница названа честно: экран видит только свои правки (10.3a/10.3b).
  expect(drift).toHaveTextContent(/только правки, сделанные здесь/)
  unmount()

  renderPanel({ submission: submissionFixture(), localDrift: [] })
  await screen.findByTestId('day-submission-state')
  expect(screen.queryByTestId('day-submission-drift')).not.toBeInTheDocument()
})

it('AC-2: dateValid === false → панель не рендерит НИЧЕГО', () => {
  renderPanel({ dateValid: false, businessDate: '' })
  // Пустоту container проверять нельзя: ToastProvider рендерит свой live-region
  // в ту же обёртку. Проверяем отсутствие СОБСТВЕННОГО содержимого панели —
  // включая канон-кнопку, из-за которой упал бы DailyUpdatePage.test.tsx:556.
  expect(screen.queryByText('Сдача дня')).not.toBeInTheDocument()
  expect(screen.queryByText('Сдать день')).not.toBeInTheDocument()
  expect(screen.queryByText(/День не сдан/)).not.toBeInTheDocument()
})

it('AC-2: состояния чтения — role="status" при загрузке, role="alert" при отказе чтения', async () => {
  const { unmount } = renderPanel({ isLoading: true })
  // Матч по тексту, а не getByRole('status'): live-region тоста тоже
  // role="status", и getByRole упал бы на «found multiple elements».
  expect(screen.getByText(/Загрузка состояния дня/)).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('button', { name: 'Сдать день' })).not.toBeInTheDocument()
  unmount()

  renderPanel({ isError: true })
  // Ошибка чтения — НЕ «пустой день»: 403 по ПРАВУ на списке бывает, и кнопка
  // сдачи там, где читать нельзя, была бы обманкой.
  const alert = await screen.findByText(/Не удалось прочитать состояние дня/)
  expect(alert).toHaveAttribute('role', 'alert')
  expect(screen.queryByRole('button', { name: 'Сдать день' })).not.toBeInTheDocument()
})

it('AC-11: клавиатурный путь целиком — Tab до кнопки, Enter, Enter (мышь не используется)', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel()

  await screen.findByRole('button', { name: 'Сдать день' })

  const submitButton = screen.getByRole('button', { name: 'Сдать день' })
  await user.tab()
  // Дискриминатор против вакуума: фокус обязан стоять ИМЕННО на кнопке сдачи,
  // а не «где-то» (урок 9.9 — activeElement в никуда даёт зелёный ассерт).
  expect(document.activeElement).toBe(submitButton)

  await user.keyboard('{Enter}')
  const confirm = await screen.findByRole('button', { name: 'Подтвердить сдачу' })

  await user.tab()
  expect(document.activeElement).toBe(confirm)
  await user.keyboard('{Enter}')

  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(await screen.findByTestId('day-submission-state')).toBeInTheDocument()
})

it('смена подразделения/даты снимает ответ прошлой сдачи (фантомный флаг не переживает контекст)', async () => {
  capturePost(() =>
    HttpResponse.json(submissionFixture({ event: 'CHANGED' }), { status: 201 }),
  )
  const user = userEvent.setup()
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
  const base: DaySubmissionPanelProps = {
    divisionId: DIVISION_ID,
    businessDate: TODAY,
    dateValid: true,
    rowCount: 40,
    dirtyCount: 0,
    localDrift: [],
    submission: null,
    isLoading: false,
    isError: false,
  }
  // key — как на экране: сброс делает РЕМАУНТ, а не эффект (setState в эффекте
  // забанен линтом react-hooks/set-state-in-effect). Рендерим ровно так же,
  // иначе тест проверял бы сценарий, которого в приложении не бывает.
  const { rerender } = render(
    <DaySubmissionPanel key={`${DIVISION_ID}-${TODAY}`} {...base} />,
    { wrapper: Wrapper },
  )

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))
  await screen.findByTestId('day-submission-state')

  // Смена подразделения: серверного состояния для нового ещё нет (submission
  // null) — «День сдан» от ПРЕЖНЕГО подразделения обязан исчезнуть.
  const OTHER = 'b1b2b3b4-c5c6-d7d8-e9ea-fbfcfdfe0102'
  rerender(
    <DaySubmissionPanel key={`${OTHER}-${TODAY}`} {...base} divisionId={OTHER} />,
  )
  await waitFor(() =>
    expect(screen.queryByTestId('day-submission-state')).not.toBeInTheDocument(),
  )
  expect(screen.getByText(/День не сдан/)).toBeInTheDocument()
})

// ── QA-добор покрытия (qa-generate-e2e-tests, 2026-07-19) ────────────────────
// Ветки, которые dev-набор оставил недоказанными: их разбор покрыт юнитом
// daySubmission.test.ts, но РЕНДЕР панели по ним не проходил ни разу — а между
// «функция вернула kind» и «оператор это увидел» помещается целый баг.

it('AC-9: 400 VALIDATION_ERROR → инлайн-СПИСОК причин из details, а не только общий текст', async () => {
  // Юнит доказывает лишь kind === 'validation'. Ветка рендера списка
  // (parseValidationDetails → <ul>) до этого теста не исполнялась НИ РАЗУ:
  // «Проверьте заполнение формы» без причин не говорит оператору, что чинить.
  capturePost(() =>
    HttpResponse.json(
      errorEnvelope('VALIDATION_ERROR', 'Проверьте заполнение формы.', {
        business_date: ['Неверный формат даты.'],
        division_id: 'Обязательное поле.',
      }),
      { status: 400 },
    ),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  const failure = await screen.findByTestId('day-submission-failure')
  expect(failure).toHaveTextContent('Проверьте заполнение формы.')
  // Обе формы details бэка: список строк И одиночная строка (DRF даёт обе).
  expect(within(failure).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'business_date: Неверный формат даты.',
    'division_id: Обязательное поле.',
  ])
})

it.each([
  ['405', 405],
  ['415', 415],
  ['429', 429],
])('AC-9: %s БЕЗ конверта §36 → отказ ВИДЕН на экране (не молчаливая дыра)', async (_l, status) => {
  // DRF-нативная форма {"detail"} — error_code нет ⇒ errorCode === null.
  // Юнит проверяет, что kind не 'silent'; здесь — что панель это РИСУЕТ.
  // Молчание тут было бы худшим исходом: отказ случился, экран пуст, оператор
  // считает день сданным.
  const bodies = capturePost(() =>
    HttpResponse.json({ detail: `Ошибка ${status}` }, { status }),
  )
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  const failure = await screen.findByTestId('day-submission-failure')
  expect(failure.textContent?.trim()).not.toBe('')
  // Положительный контроль: POST реально ушёл и реально отказал — иначе
  // «сообщение есть» могло бы объясняться чем угодно.
  await waitFor(() => expect(bodies).toHaveLength(1))
  // День сданным НЕ считается.
  expect(screen.queryByTestId('day-submission-state')).not.toBeInTheDocument()
})

it('AC-3(б): истории нет → «Сдач по подразделению ещё не было» и предсказание CHANGED даже при 0 дельт', async () => {
  // Ключевая асимметрия сервера: `_compute_event` при previous is None ВСЕГДА
  // отдаёт CHANGED. Предсказать «Подтверждено без изменений» на первой сдаче
  // подразделения значило бы соврать оператору при нуле дельт — самый частый
  // штатный день. Дефолтный GET-хендлер отдаёт пустой конверт = истории нет.
  const user = userEvent.setup()
  renderPanel({ dirtyCount: 0 })

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))

  expect(await screen.findByText('Сдач по подразделению ещё не было.')).toBeInTheDocument()
  expect(screen.getByText(/ожидается: Изменено/)).toBeInTheDocument()
  expect(screen.queryByText(/ожидается: Подтверждено без изменений/)).not.toBeInTheDocument()
})

it('гард «подразделение не выбрано» → POST не уходит, причина названа', async () => {
  const bodies = capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  renderPanel({ divisionId: null })

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))

  expect(screen.getByText('Выберите подразделение.')).toBeInTheDocument()
  // Подтверждение не открылось: тела запроса без division_id не существует.
  expect(screen.queryByRole('button', { name: 'Подтвердить сдачу' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('Отправка…')).toBeNull())
  expect(bodies).toHaveLength(0)
})

it('отправка в полёте → «Отправка…» с role="status" (ПОЛОЖИТЕЛЬНЫЙ ассерт)', async () => {
  // Все прочие тесты ассертят это ОТРИЦАНИЕМ (queryByText('Отправка…') === null)
  // — такой ассерт остался бы зелёным, даже если бы индикатора не было вовсе.
  let resolveResponse!: () => void
  const gate = new Promise<void>((resolve) => {
    resolveResponse = resolve
  })
  capturePost(async () => {
    await gate
    return HttpResponse.json(submissionFixture(), { status: 201 })
  })
  const user = userEvent.setup()
  renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))

  const pending = await screen.findByText('Отправка…')
  expect(pending).toHaveAttribute('role', 'status')
  // Второй рубеж AC-6 (кнопка недоступна, пока запрос в полёте) — виден только
  // здесь: в остальных тестах ответ приходит мгновенно.
  expect(screen.getByRole('button', { name: 'Подтвердить сдачу' })).toBeDisabled()

  resolveResponse()
  await screen.findByTestId('day-submission-state')
  expect(screen.queryByText('Отправка…')).toBeNull()
})

it('битый submitted_at показывается как есть — «Invalid Date» оператору не показываем', async () => {
  // Типы рукописные (Решение №3), tsc контракт-тестом НЕ работает: дрейф бэка
  // по формату времени ловится только рантаймом. new Date('...') на мусоре даёт
  // NaN, а toLocaleString — «Invalid Date».
  renderPanel({ submission: submissionFixture({ submitted_at: 'не-дата' }) })

  const state = await screen.findByTestId('day-submission-state')
  expect(state).toHaveTextContent('не-дата')
  expect(state).not.toHaveTextContent(/Invalid Date/)
})

it('AC-7: успех инвалидирует ОБА ключа — состояние дня и историю подразделения', async () => {
  // Промах по ключу — молчаливый no-op: экран остался бы с «День не сдан», а
  // предпросмотр следующей сдачи — со старой историей (предсказание солгало бы).
  capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const user = userEvent.setup()
  renderPanel({}, queryClient)

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))
  await screen.findByTestId('day-submission-state')

  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['day-submission', DIVISION_ID, TODAY],
  })
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['division-submissions', DIVISION_ID],
  })
})

it('тон деловой: ни эмодзи, ни празднования в потоке сдачи', async () => {
  capturePost(() =>
    HttpResponse.json(submissionFixture(), { status: 201 }),
  )
  const user = userEvent.setup()
  const { container } = renderPanel()

  await user.click(await screen.findByRole('button', { name: 'Сдать день' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить сдачу' }))
  await screen.findByTestId('day-submission-state')

  const text = container.textContent ?? ''
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
  expect(text).not.toMatch(/Готово!|Отлично|Поздравля/)
})
