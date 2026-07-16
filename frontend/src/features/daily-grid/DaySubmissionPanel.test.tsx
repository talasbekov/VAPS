// @vitest-environment jsdom
// Story 10.3 — панель «Сдача дня» (Task 4): выбор подразделения (автовыбор
// единственного), состояния несдано/сдано/сдано+drift, модальный предпросмотр
// с серверной категорией + счётчиком, dirty-гейт, POST create (тело запёрто),
// каналы ошибок ARCH-FE-015: 409 → рефетч-состояние (НЕ ConflictDialog),
// 422 → detail.allowed, 400/403 → сообщение панели, 5xx → generic-тост,
// 401 — не перехватывается. RTL + msw, Harness из shared-примитивов
// (ARCH-FE-013 — app/Providers сюда не импортировать).
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ErrorEnvelope } from '../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../shared/api/useApiMutation'
import { server } from '../../shared/api/testing/server'
import {
  clearCredential,
  setCredential,
} from '../../shared/auth/credential'
import { ToastProvider } from '../../shared/ui/toast'
import type { DayStateResponse, DaySubmission } from './dayState'
import { DaySubmissionPanel } from './DaySubmissionPanel'

// jsdom НЕ реализует методы <dialog> — минимальный полифилл open-семантики
// (прецедент ConflictDialog.test.tsx / DailyExpensePage.test.tsx).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

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

// Дефолтный 1с waitFor-таймаут флейкует под нагрузкой CI (msw delay + два
// цикла query) — расширяем ТОЛЬКО для этого файла, семантика ассертов та же.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
  clearCredential() // тесты 10.6 логинятся ради usePermissions — не протекать
})

// --- Фикстуры ------------------------------------------------------------------

const TIMESTAMP = '2026-07-16T09:00:00+05:00'
const DATE = '2026-07-16'
const DIV_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const DIV_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const EMPLOYEES = [
  { id: 'e1', fullName: 'Асанов' },
  { id: 'e2', fullName: 'Борисов' },
]

function makeSubmission(overrides: Partial<DaySubmission> = {}): DaySubmission {
  return {
    id: 7,
    division_id: DIV_A,
    business_date: DATE,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'op-1',
    submitted_at: '2026-07-16T08:30:00+05:00',
    late: false,
    ...overrides,
  }
}

type DayStateDetail = NonNullable<DayStateResponse['detail']>

/** Один DIV_A, несдано, серверная категория preview. */
function unsubmittedFixture(
  preview: 'CONFIRMED_NO_CHANGES' | 'CHANGED' = 'CHANGED',
): DayStateResponse {
  return {
    divisions: [{ division_id: DIV_A, name: 'Отдел А', submission: null }],
    detail: {
      preview_event: preview,
      traffic_light: null,
      amendment: null,
      summary: null,
    },
  }
}

function submittedFixture(
  submission: DaySubmission = makeSubmission(),
  trafficLight: { status: string; late: boolean; drift: unknown } | null = {
    status: 'GREEN',
    late: false,
    drift: null,
  },
  detailOverrides: Partial<DayStateDetail> = {},
): DayStateResponse {
  return {
    divisions: [{ division_id: DIV_A, name: 'Отдел А', submission }],
    detail: {
      preview_event: null,
      traffic_light: trafficLight,
      amendment: null,
      summary: null,
      ...detailOverrides,
    },
  }
}

// --- Хэндлеры --------------------------------------------------------------------

/** GET day-state: последовательность фикстур (последняя повторяется); urls наружу. */
function useDayStateHandler(...fixtures: DayStateResponse[]): string[] {
  const urls: string[] = []
  server.use(
    http.get('*/api/operations/daily-submissions/day-state/', ({ request }) => {
      urls.push(request.url)
      const fixture =
        fixtures[Math.min(urls.length - 1, fixtures.length - 1)]
      return HttpResponse.json(fixture)
    }),
  )
  return urls
}

function useDayStateError(status: number): void {
  server.use(
    http.get('*/api/operations/daily-submissions/day-state/', () =>
      HttpResponse.json(
        {
          error_code: 'INTERNAL_ERROR',
          message: 'Внутренняя ошибка.',
          details: {},
          request_id: null,
          timestamp: TIMESTAMP,
        },
        { status },
      ),
    ),
  )
}

type SubmitReply = { status: number; body: unknown } | 'created' | 'network'

/** POST create: тела наружу (пин AC-6), ответы по очереди (последний повторяется). */
function useSubmitHandler(...replies: SubmitReply[]): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post('*/api/operations/daily-submissions/', async ({ request }) => {
      bodies.push(await request.json())
      const reply = replies[Math.min(bodies.length - 1, replies.length - 1)]
      await delay(20) // даёт наблюдать isPending-дизейбл
      if (reply === 'network') return HttpResponse.error()
      if (reply === 'created')
        return HttpResponse.json(makeSubmission(), { status: 201 })
      return HttpResponse.json(reply.body as Record<string, unknown>, {
        status: reply.status,
      })
    }),
  )
  return bodies
}

/** Логин + права (10.6): usePermissions гейтится credential-ом (useMe enabled). */
function grantPermissions(permissions: string[]): void {
  setCredential({ kind: 'dev', userId: 'op-1' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

const AMENDED_AT = '2026-07-16T11:45:00+05:00'

function amendedSubmission(): DaySubmission {
  return makeSubmission({
    id: 8,
    version: 2,
    event: 'AMENDED',
    submitted_at: AMENDED_AT,
  })
}

/** POST /{id}/amend/: тела и url наружу (пин AC-6), ответы по очереди. */
function useAmendHandler(...replies: SubmitReply[]): {
  bodies: unknown[]
  urls: string[]
} {
  const bodies: unknown[] = []
  const urls: string[] = []
  server.use(
    http.post(
      '*/api/operations/daily-submissions/:id/amend/',
      async ({ request }) => {
        urls.push(request.url)
        bodies.push(await request.json())
        const reply = replies[Math.min(bodies.length - 1, replies.length - 1)]
        await delay(20) // даёт наблюдать isPending-дизейбл
        if (reply === 'network') return HttpResponse.error()
        if (reply === 'created')
          return HttpResponse.json(amendedSubmission(), { status: 201 })
        return HttpResponse.json(reply.body as Record<string, unknown>, {
          status: reply.status,
        })
      },
    ),
  )
  return { bodies, urls }
}

async function openAmendDialog() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Запросить пересдачу' }),
  )
  return await screen.findByRole('dialog')
}

function fillAmendForm(reason: string, sanction: string) {
  fireEvent.change(screen.getByLabelText('Причина'), {
    target: { value: reason },
  })
  fireEvent.change(screen.getByLabelText('Санкция'), {
    target: { value: sanction },
  })
}

function envelope(
  code: string,
  overrides: Partial<ErrorEnvelope> = {},
): ErrorEnvelope {
  return {
    error_code: code,
    message: `Ошибка ${code}.`,
    details: {},
    request_id: null,
    timestamp: TIMESTAMP,
    ...overrides,
  }
}

// --- Рендер ------------------------------------------------------------------------

function renderPanel(
  overrides: Partial<Parameters<typeof DaySubmissionPanel>[0]> = {},
) {
  render(
    <Harness>
      <DaySubmissionPanel
        businessDate={DATE}
        isDirty={() => false}
        appliedCount={0}
        employees={EMPLOYEES}
        {...overrides}
      />
    </Harness>,
  )
}

async function openPreview() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Сдать день' }),
  )
  return await screen.findByRole('dialog')
}

// --- AC-5: панель, выбор, состояния -------------------------------------------------

describe('10.3 DaySubmissionPanel — выбор и состояния (AC-5)', () => {
  it('loading-состояние, затем автовыбор единственного подразделения и категория предпросмотра', async () => {
    const urls = useDayStateHandler(unsubmittedFixture('CONFIRMED_NO_CHANGES'))
    renderPanel()
    expect(screen.getByText(/Загрузка состояния сдачи/)).toBeInTheDocument()
    const select = (await screen.findByLabelText(
      'Подразделение',
    )) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe(DIV_A))
    // detail-запрос ушёл с division_id автовыбранного
    await waitFor(() =>
      expect(
        urls.some(
          (u) => new URL(u).searchParams.get('division_id') === DIV_A,
        ),
      ).toBe(true),
    )
    expect(
      await screen.findByText(/Подтверждение без изменений/),
    ).toBeInTheDocument()
    expect(new URL(urls[0]).searchParams.get('business_date')).toBe(DATE)
  })

  it('несколько подразделений — автовыбора нет; выбор руками включает detail-режим', async () => {
    const two: DayStateResponse = {
      divisions: [
        { division_id: DIV_A, name: 'Отдел А', submission: null },
        { division_id: DIV_B, name: 'Отдел Б', submission: null },
      ],
      detail: null,
    }
    const urls = useDayStateHandler(two, {
      ...unsubmittedFixture('CHANGED'),
      divisions: two.divisions,
    })
    renderPanel()
    const select = (await screen.findByLabelText(
      'Подразделение',
    )) as HTMLSelectElement
    expect(select.value).toBe('')
    fireEvent.change(select, { target: { value: DIV_A } })
    expect(
      await screen.findByText(/Срез изменился против вчера/),
    ).toBeInTheDocument()
    expect(
      urls.some((u) => new URL(u).searchParams.get('division_id') === DIV_A),
    ).toBe(true)
  })

  it('ошибка day-state → явная ошибка панели с «Повторить» (не пустая панель)', async () => {
    useDayStateError(500)
    renderPanel()
    expect(
      await screen.findByText(/Не удалось загрузить состояние сдачи/),
    ).toBeInTheDocument()
    useDayStateHandler(unsubmittedFixture())
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByLabelText('Подразделение')).toBeInTheDocument()
  })

  it('ошибка detail-запроса при выбранном подразделении НЕ прячет селект (оператор не заперт)', async () => {
    // Ревью 10.3: стабильный 5xx на detail-ключе не должен отбирать селект —
    // иначе сменить дивизию нечем, «Повторить» бьёт в тот же падающий URL.
    const listFixture: DayStateResponse = {
      divisions: [
        { division_id: DIV_A, name: 'Отдел А', submission: null },
        { division_id: DIV_B, name: 'Отдел Б', submission: null },
      ],
      detail: null,
    }
    server.use(
      http.get(
        '*/api/operations/daily-submissions/day-state/',
        ({ request }) => {
          const div = new URL(request.url).searchParams.get('division_id')
          if (div === DIV_B)
            return HttpResponse.json(
              {
                error_code: 'INTERNAL_ERROR',
                message: 'Внутренняя ошибка.',
                details: {},
                request_id: null,
                timestamp: TIMESTAMP,
              },
              { status: 500 },
            )
          return HttpResponse.json(
            div === DIV_A
              ? { ...unsubmittedFixture('CHANGED'), divisions: listFixture.divisions }
              : listFixture,
          )
        },
      ),
    )
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    fireEvent.change(select, { target: { value: DIV_B } })
    expect(
      await screen.findByText(/Не удалось загрузить состояние сдачи/),
    ).toBeInTheDocument()
    // селект жив — выбор другой дивизии выводит из ошибки
    fireEvent.change(screen.getByLabelText('Подразделение'), {
      target: { value: DIV_A },
    })
    expect(
      await screen.findByText(/Срез изменился против вчера/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Не удалось загрузить состояние сдачи/),
    ).not.toBeInTheDocument()
  })

  it('сданный день: событие, версия, время, бейдж «с опозданием» при late', async () => {
    useDayStateHandler(
      submittedFixture(makeSubmission({ late: true, version: 2 })),
    )
    renderPanel()
    expect(await screen.findByText(/День сдан/)).toBeInTheDocument()
    expect(screen.getByText(/версия 2/)).toBeInTheDocument()
    expect(screen.getByText('с опозданием')).toBeInTheDocument()
    // повторная сдача недоступна (AC-8): кнопки «Сдать день» нет
    expect(
      screen.queryByRole('button', { name: 'Сдать день' }),
    ).not.toBeInTheDocument()
  })
})

// --- AC-6/AC-7: предпросмотр, подтверждение, dirty-гейт ------------------------------

describe('10.3 DaySubmissionPanel — предпросмотр и сдача (AC-6/AC-7)', () => {
  it('предпросмотр: серверная категория + счётчик применённых; «Подтвердить» → ровно один POST с запертым телом', async () => {
    // Дискриминатор серверности (Решение №2, красная проба (в)): сервер даёт
    // CONFIRMED при appliedCount=3 — локальный прогноз «дельты>0 → CHANGED»
    // показал бы противоположную категорию.
    useDayStateHandler(unsubmittedFixture('CONFIRMED_NO_CHANGES'))
    const bodies = useSubmitHandler('created')
    renderPanel({ appliedCount: 3 })
    const dialog = await openPreview()
    expect(dialog).toHaveTextContent(/Подтверждение без изменений/)
    expect(dialog).toHaveTextContent(/Применено отклонений за сессию: 3/)
    const confirm = screen.getByRole('button', { name: 'Подтвердить' })
    fireEvent.click(confirm)
    // isPending: кнопка disabled, повторного POST нет
    await waitFor(() => expect(confirm).toBeDisabled())
    await screen.findByText(/День сдан/)
    expect(bodies).toEqual([
      { division_id: DIV_A, business_date: DATE },
    ])
  })

  it('«Отмена» предпросмотра → запроса НЕТ', async () => {
    useDayStateHandler(unsubmittedFixture())
    const bodies = useSubmitHandler('created')
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(bodies).toEqual([])
  })

  it('dirty-гейт: несохранённые дельты → предпросмотр не открывается, подсказка видна', async () => {
    useDayStateHandler(unsubmittedFixture())
    const bodies = useSubmitHandler('created')
    renderPanel({ isDirty: () => true })
    fireEvent.click(await screen.findByRole('button', { name: 'Сдать день' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByText(/сначала сохраните изменения/i),
    ).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('после сохранения дельт (isDirty → false) сдача доступна (AC-7)', async () => {
    useDayStateHandler(unsubmittedFixture())
    let dirty = true
    renderPanel({ isDirty: () => dirty })
    fireEvent.click(await screen.findByRole('button', { name: 'Сдать день' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    dirty = false // bulk-сохранение прошло — ленивый опрос вернёт false
    fireEvent.click(screen.getByRole('button', { name: 'Сдать день' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('detail без серверной категории (previewEvent пуст) → «Сдать день» заблокирована', async () => {
    // Решение №2: сдача вслепую запрещена — без серверной категории
    // предпросмотр не открывается, кнопка disabled.
    useDayStateHandler({
      divisions: [{ division_id: DIV_A, name: 'Отдел А', submission: null }],
      detail: null,
    })
    renderPanel()
    const btn = await screen.findByRole('button', { name: 'Сдать день' })
    await waitFor(() => expect(btn).toBeDisabled())
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

// --- AC-8/AC-9: успех и 409-состояние ------------------------------------------------

describe('10.3 DaySubmissionPanel — успех и 409 (AC-8/AC-9)', () => {
  it('201 → состояние «сдано» с event/late/version ИЗ ОТВЕТА + инвалидация day-state', async () => {
    // календарь вызовов: 1) list-режим 2) detail автовыбора → несдано;
    // 3+) рефетч после инвалидации → сдано
    const urls = useDayStateHandler(
      unsubmittedFixture(),
      unsubmittedFixture(),
      submittedFixture(),
    )
    useSubmitHandler('created')
    renderPanel()
    const before = urls.length
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await screen.findByText(/День сдан/)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/версия 1/)).toBeInTheDocument()
    // инвалидация: day-state перезапрошен после успеха
    await waitFor(() => expect(urls.length).toBeGreaterThan(before + 1))
  })

  it('409 DAY_ALREADY_SUBMITTED — НЕ тупик и НЕ ConflictDialog: рефетч + «уже сдан»', async () => {
    const urls = useDayStateHandler(
      unsubmittedFixture(),
      unsubmittedFixture(),
      submittedFixture(),
    )
    useSubmitHandler({
      status: 409,
      body: envelope('DAY_ALREADY_SUBMITTED', {
        message: 'Подразделение уже сдало этот день (пересдача — amendment 5.4).',
        details: { division_id: DIV_A, business_date: DATE },
      }),
    })
    renderPanel()
    const before = urls.length
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    // сообщение-состояние, панель рефетчит и показывает актуальное «сдано»
    expect(await screen.findByText(/уже сдан/i)).toBeInTheDocument()
    await screen.findByText(/День сдан/)
    await waitFor(() => expect(urls.length).toBeGreaterThan(before + 1))
    // оверрайд-протокол НЕ задействован: диалога с причиной нет
    expect(
      screen.queryByRole('button', { name: 'Подтвердить оверрайд' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

// --- AC-10/AC-11: ошибки и каналы -----------------------------------------------------

describe('10.3 DaySubmissionPanel — каналы ошибок (AC-10/AC-11)', () => {
  it('422 BUSINESS_DATE_OUT_OF_WINDOW → баннер с датами из detail.allowed', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({
      status: 422,
      body: envelope('BUSINESS_DATE_OUT_OF_WINDOW', {
        message: 'business_date вне окна первичной сдачи.',
        details: { allowed: ['2026-07-16', '2026-07-17'] },
      }),
    })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    const banner = await screen.findByText(/вне окна сдачи/i)
    expect(banner).toHaveTextContent('2026-07-16')
    expect(banner).toHaveTextContent('2026-07-17')
    expect(screen.queryByText(/День сдан/)).not.toBeInTheDocument()
  })

  it('400 → сообщение панели (канал формы)', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({ status: 400, body: envelope('VALIDATION_ERROR') })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(
      await screen.findByText(/Запрос отклонён: проверьте данные/),
    ).toBeInTheDocument()
  })

  it('403 → явное сообщение панели (не тост, не маркеры)', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({
      status: 403,
      body: envelope('PERMISSION_DENIED', { message: 'Нет прав на сдачу.' }),
    })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText('Нет прав на сдачу.')).toBeInTheDocument()
  })

  it('404 → явное сообщение панели (ревью 10.3, зеркало 403-кейса)', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({
      status: 404,
      body: envelope('ENTITY_NOT_FOUND', {
        message: 'Подразделение не найдено.',
      }),
    })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(
      await screen.findByText('Подразделение не найдено.'),
    ).toBeInTheDocument()
  })

  it('смена подразделения сбрасывает ошибку прошлой мутации (баннер не переезжает)', async () => {
    const divisions = [
      { division_id: DIV_A, name: 'Отдел А', submission: null },
      { division_id: DIV_B, name: 'Отдел Б', submission: null },
    ]
    useDayStateHandler({ divisions, detail: null }, {
      ...unsubmittedFixture('CHANGED'),
      divisions,
    })
    useSubmitHandler({
      status: 422,
      body: envelope('BUSINESS_DATE_OUT_OF_WINDOW', {
        details: { allowed: ['2026-07-16'] },
      }),
    })
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    fireEvent.change(select, { target: { value: DIV_A } })
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await screen.findByText(/вне окна сдачи/i)
    fireEvent.change(screen.getByLabelText('Подразделение'), {
      target: { value: DIV_B },
    })
    await waitFor(() =>
      expect(screen.queryByText(/вне окна сдачи/i)).not.toBeInTheDocument(),
    )
  })

  it('5xx POST → generic-тост хука; ложного «сдано» нет', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({ status: 500, body: envelope('INTERNAL_ERROR') })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/День сдан/)).not.toBeInTheDocument()
  })

  it('сетевой сбой POST → generic-тост; ложного «сдано» нет', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler('network')
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/День сдан/)).not.toBeInTheDocument()
  })

  it('401 → панель не перехватывает (цепь 8.6): ни сообщения, ни «сдано»', async () => {
    useDayStateHandler(unsubmittedFixture())
    useSubmitHandler({
      status: 401,
      body: envelope('AUTH_REQUIRED', { message: 'Требуется вход.' }),
    })
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    // модал закрылся, но панель НЕ рендерит 401 как своё сообщение
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Требуется вход.')).not.toBeInTheDocument()
    expect(screen.queryByText(/День сдан/)).not.toBeInTheDocument()
  })
})

// --- AC-12: drift-маркер ---------------------------------------------------------------

describe('10.3 DaySubmissionPanel — drift-маркер (AC-12)', () => {
  it('YELLOW → маркер «разошлось» с деталями: ФИО из словаря, fallback id, from → to', async () => {
    useDayStateHandler(
      submittedFixture(makeSubmission(), {
        status: 'YELLOW',
        late: false,
        drift: {
          added: ['e-unknown'],
          removed: ['e2'],
          changed: [{ employee_id: 'e1', from: 'IN_SERVICE', to: 'DUTY' }],
        },
      }),
    )
    renderPanel()
    expect(await screen.findByText(/разошёлся/i)).toBeInTheDocument()
    expect(
      screen.getByText('e-unknown — появился в расходе'),
    ).toBeInTheDocument()
    expect(screen.getByText('Борисов — выбыл из расхода')).toBeInTheDocument()
    expect(screen.getByText('Асанов: IN_SERVICE → DUTY')).toBeInTheDocument()
  })

  it('GREEN → «расхождений нет», маркер ОТСУТСТВУЕТ; «Обновить» рефетчит', async () => {
    const urls = useDayStateHandler(submittedFixture())
    renderPanel()
    expect(await screen.findByText(/Расхождений нет/)).toBeInTheDocument()
    expect(screen.queryByText(/разошёлся/i)).not.toBeInTheDocument()
    const before = urls.length
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    await waitFor(() => expect(urls.length).toBeGreaterThan(before))
  })
})

// === Story 10.6: amendment-флоу =========================================================

// --- AC-5: кнопка «Запросить пересдачу» и гейт права ------------------------------------

describe('10.6 DaySubmissionPanel — кнопка пересдачи и гейт (AC-5)', () => {
  it('сданный день + держатель daily_report.correct → кнопка активна', async () => {
    grantPermissions(['daily_report.mark_update', 'daily_report.correct'])
    useDayStateHandler(submittedFixture())
    renderPanel()
    const btn = await screen.findByRole('button', {
      name: 'Запросить пересдачу',
    })
    await waitFor(() => expect(btn).toBeEnabled())
  })

  it('без права — кнопка disabled с подсказкой (НЕ скрыта), запрос не уходит', async () => {
    grantPermissions(['daily_report.mark_update'])
    useDayStateHandler(submittedFixture())
    const { bodies } = useAmendHandler('created')
    renderPanel()
    const btn = await screen.findByRole('button', {
      name: 'Запросить пересдачу',
    })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', expect.stringMatching(/нет права/i))
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('день не сдан → кнопки пересдачи нет вовсе', async () => {
    grantPermissions(['daily_report.mark_update', 'daily_report.correct'])
    useDayStateHandler(unsubmittedFixture())
    renderPanel()
    await screen.findByText(/День не сдан/)
    expect(
      screen.queryByRole('button', { name: 'Запросить пересдачу' }),
    ).not.toBeInTheDocument()
  })
})

// --- AC-6: модальный диалог пересдачи ----------------------------------------------------

describe('10.6 DaySubmissionPanel — диалог пересдачи (AC-6)', () => {
  it('диалог: «Подтвердить» disabled при пустых после trim полях; заполнение включает; ровно один POST c телом {reason, sanction}', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    const { bodies, urls } = useAmendHandler('created')
    renderPanel()
    const dialog = await openAmendDialog()
    expect(dialog).toHaveTextContent(/версию/i) // предупреждение о версии N+1
    const confirm = screen.getByRole('button', { name: 'Подтвердить' })
    expect(confirm).toBeDisabled()
    fillAmendForm('   ', '   ') // пробелы = пусто после trim
    expect(confirm).toBeDisabled()
    fillAmendForm('ретро-правка статуса', 'устное замечание')
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await screen.findByText(/версия 2/)
    // тело запёрто: ни actor, ни triggered_by_status_id (AC-6)
    expect(bodies).toEqual([
      { reason: 'ретро-правка статуса', sanction: 'устное замечание' },
    ])
    expect(urls[0]).toContain('/api/operations/daily-submissions/7/amend/')
  })

  it('Esc и «Отмена» закрывают диалог БЕЗ запроса', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    const { bodies } = useAmendHandler('created')
    renderPanel()
    const dialog = await openAmendDialog()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await openAmendDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(bodies).toEqual([])
  })
})

// --- AC-7: успех пересдачи ----------------------------------------------------------------

describe('10.6 DaySubmissionPanel — успех пересдачи (AC-7)', () => {
  it('201 → «версия 2» + бейдж + время ИЗ ОТВЕТА; причина/санкция локально из формы; инвалидация; диалог закрыт; isPending-дизейбл', async () => {
    grantPermissions(['daily_report.correct'])
    // Рефетч после инвалидации несёт серверную v2 БЕЗ amendment-блока —
    // причина/санкция обязаны отрисоваться из только что отправленной формы.
    const urls = useDayStateHandler(
      submittedFixture(),
      submittedFixture(),
      submittedFixture(amendedSubmission()),
    )
    useAmendHandler('created')
    renderPanel()
    await openAmendDialog()
    // Ревью 10.6: `before` — ПОСЛЕ initial-фетчей (list+detail сели, кнопка
    // видима): захват до них делает ассерт инвалидации вакуумным — стартовая
    // пара запросов сама удовлетворяла порог `before + 1`.
    const before = urls.length
    fillAmendForm('ретро-правка статуса', 'устное замечание')
    const confirm = screen.getByRole('button', { name: 'Подтвердить' })
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled()) // isPending
    expect(await screen.findByText(/версия 2/)).toBeInTheDocument()
    expect(screen.getByText('Пересдача')).toBeInTheDocument()
    expect(screen.getByText(/2026-07-16 11:45/)).toBeInTheDocument()
    expect(screen.getByText(/Причина: ретро-правка статуса/)).toBeInTheDocument()
    expect(screen.getByText(/Санкция: устное замечание/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(urls.length).toBeGreaterThan(before))
  })
})

// --- AC-8: ошибки пересдачи по кодам --------------------------------------------------------

describe('10.6 DaySubmissionPanel — каналы ошибок пересдачи (AC-8)', () => {
  it('400 → сообщение ВНУТРИ диалога, диалог открыт, ввод не потерян', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    useAmendHandler({ status: 400, body: envelope('VALIDATION_ERROR') })
    renderPanel()
    const dialog = await openAmendDialog()
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await waitFor(() =>
      expect(dialog).toHaveTextContent(/Запрос отклонён: проверьте данные/),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Причина')).toHaveValue('ретро-правка')
    expect(screen.getByLabelText('Санкция')).toHaveValue('выговор')
  })

  it('409 DAY_ALREADY_SUBMITTED (гонка amendments) → НЕ тупик: invalidate + «состояние обновлено», без ConflictDialog', async () => {
    grantPermissions(['daily_report.correct'])
    const urls = useDayStateHandler(
      submittedFixture(),
      submittedFixture(),
      submittedFixture(amendedSubmission()),
    )
    useAmendHandler({
      status: 409,
      body: envelope('DAY_ALREADY_SUBMITTED', {
        message: 'Конкурентная пересдача уже создала новую версию.',
      }),
    })
    renderPanel()
    await openAmendDialog()
    // Ревью 10.6: `before` — после initial-фетчей (см. AC-7) — иначе ассерт
    // инвалидации вакуумен.
    const before = urls.length
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText(/состояние обновлено/i)).toBeInTheDocument()
    await waitFor(() => expect(urls.length).toBeGreaterThan(before))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    // рефетч показал свежую версию — гонка не тупик
    expect(await screen.findByText(/версия 2/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Подтвердить оверрайд' }),
    ).not.toBeInTheDocument()
  })

  it('422 NO_SUBMISSION_TO_AMEND → баннер с сообщением бэка + invalidate', async () => {
    grantPermissions(['daily_report.correct'])
    const urls = useDayStateHandler(submittedFixture())
    useAmendHandler({
      status: 422,
      body: envelope('NO_SUBMISSION_TO_AMEND', {
        message: 'Пересдавать нечего — ни одной версии сдачи.',
      }),
    })
    renderPanel()
    await openAmendDialog()
    // Ревью 10.6: `before` — после initial-фетчей (см. AC-7); красная проба
    // (е) показала вакуумность прежнего захвата до них.
    const before = urls.length
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(
      await screen.findByText('Пересдавать нечего — ни одной версии сдачи.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(urls.length).toBeGreaterThan(before))
  })

  it('403 → баннер с сообщением бэка (не тост)', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    useAmendHandler({
      status: 403,
      body: envelope('PERMISSION_DENIED', {
        message: 'Нет прав на пересдачу этого подразделения.',
      }),
    })
    renderPanel()
    await openAmendDialog()
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(
      await screen.findByText('Нет прав на пересдачу этого подразделения.'),
    ).toBeInTheDocument()
  })

  it('404 → баннер с сообщением бэка', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    useAmendHandler({
      status: 404,
      body: envelope('ENTITY_NOT_FOUND', { message: 'Сдача не найдена.' }),
    })
    renderPanel()
    await openAmendDialog()
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText('Сдача не найдена.')).toBeInTheDocument()
  })

  it('5xx → generic-тост хука; ложного «пересдано» нет', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    useAmendHandler({ status: 500, body: envelope('INTERNAL_ERROR') })
    renderPanel()
    await openAmendDialog()
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/версия 2/)).not.toBeInTheDocument()
  })

  it('401 → панель не перехватывает (цепь 8.6)', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(submittedFixture())
    useAmendHandler({
      status: 401,
      body: envelope('AUTH_REQUIRED', { message: 'Требуется вход.' }),
    })
    renderPanel()
    await openAmendDialog()
    fillAmendForm('ретро-правка', 'выговор')
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Требуется вход.')).not.toBeInTheDocument()
  })
})

// --- AC-9: различимость версий v1/v2+ --------------------------------------------------------

describe('10.6 DaySubmissionPanel — различимость версий (AC-9)', () => {
  it('v1 без бейджа; v2/AMENDED — бейдж + человекочитаемое событие + причина/санкция (обе строки в одном тесте)', async () => {
    grantPermissions(['daily_report.correct'])
    const divisions = [
      { division_id: DIV_A, name: 'Отдел А', submission: makeSubmission() },
      {
        division_id: DIV_B,
        name: 'Отдел Б',
        submission: makeSubmission({
          id: 9,
          division_id: DIV_B,
          version: 2,
          event: 'AMENDED',
        }),
      },
    ]
    server.use(
      http.get(
        '*/api/operations/daily-submissions/day-state/',
        ({ request }) => {
          const div = new URL(request.url).searchParams.get('division_id')
          return HttpResponse.json({
            divisions,
            detail:
              div === null
                ? null
                : {
                    preview_event: null,
                    traffic_light: { status: 'GREEN', late: false, drift: null },
                    amendment:
                      div === DIV_B
                        ? { reason: 'ретро-правка', sanction: 'выговор' }
                        : null,
                    summary: null,
                  },
          })
        },
      ),
    )
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    fireEvent.change(select, { target: { value: DIV_A } })
    expect(await screen.findByText(/версия 1/)).toBeInTheDocument()
    expect(screen.queryByText('Пересдача')).not.toBeInTheDocument()
    expect(screen.queryByText(/Причина:/)).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: DIV_B } })
    expect(await screen.findByText(/версия 2/)).toBeInTheDocument()
    expect(screen.getByText('Пересдача')).toBeInTheDocument()
    // человекочитаемое событие, НЕ сырой код AMENDED
    expect(screen.getByText(/День сдан: пересдано/)).toBeInTheDocument()
    expect(screen.queryByText(/День сдан: AMENDED/)).not.toBeInTheDocument()
    expect(screen.getByText(/Причина: ретро-правка/)).toBeInTheDocument()
    expect(screen.getByText(/Санкция: выговор/)).toBeInTheDocument()
  })
})

// --- AC-10: маркер протухшей сводки ------------------------------------------------------------

describe('10.6 DaySubmissionPanel — маркер сводки (AC-10)', () => {
  it('STALE → role=alert «Сводка протухла» с осями: имя из словаря, пин vN → текущая vM, missing, unpinned', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(
      submittedFixture(makeSubmission(), null, {
        summary: {
          status: 'STALE',
          superseded: [
            { division_id: DIV_B, pinned_version: 1, current_version: 2 },
          ],
          missing: [{ division_id: 'нет-в-словаре', pinned_version: 3 }],
          unpinned: [DIV_B],
        },
      }),
    )
    renderPanel()
    const marker = await screen.findByText(/Сводка протухла/)
    expect(marker.closest('[role="alert"]')).not.toBeNull()
    // Имя ребёнка из divisions-словаря day-state... DIV_B вне списка divisions
    // фикстуры (submittedFixture несёт только DIV_A) → fallback id (канон 10.3).
    expect(
      screen.getByText(`${DIV_B}: пин v1 → текущая v2`),
    ).toBeInTheDocument()
    expect(
      screen.getByText('нет-в-словаре: сдача ребёнка отозвана'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`${DIV_B}: появился несведённый ребёнок`),
    ).toBeInTheDocument()
  })

  it('STALE: имя ребёнка резолвится по словарю divisions ответа', async () => {
    grantPermissions(['daily_report.correct'])
    const fixture: DayStateResponse = {
      divisions: [
        { division_id: DIV_A, name: 'Отдел А', submission: makeSubmission() },
        { division_id: DIV_B, name: 'Отдел Б', submission: null },
      ],
      detail: {
        preview_event: null,
        traffic_light: { status: 'GREEN', late: false, drift: null },
        amendment: null,
        summary: {
          status: 'STALE',
          superseded: [
            { division_id: DIV_B, pinned_version: 1, current_version: 2 },
          ],
          missing: [],
          unpinned: [],
        },
      },
    }
    useDayStateHandler(fixture)
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    fireEvent.change(select, { target: { value: DIV_A } })
    await screen.findByText(/Сводка протухла/)
    expect(
      screen.getByText('Отдел Б: пин v1 → текущая v2'),
    ).toBeInTheDocument()
  })

  it('FRESH → тихая «Сводка актуальна» (не alert); null → ни маркера, ни пометки', async () => {
    grantPermissions(['daily_report.correct'])
    useDayStateHandler(
      submittedFixture(makeSubmission(), null, {
        summary: { status: 'FRESH', superseded: [], missing: [], unpinned: [] },
      }),
    )
    renderPanel()
    const quiet = await screen.findByText('Сводка актуальна')
    expect(quiet.closest('[role="alert"]')).toBeNull()
    expect(screen.queryByText(/Сводка протухла/)).not.toBeInTheDocument()

    cleanup()
    useDayStateHandler(submittedFixture()) // summary: null — строка не сводка
    renderPanel()
    await screen.findByText(/День сдан/)
    expect(screen.queryByText('Сводка актуальна')).not.toBeInTheDocument()
    expect(screen.queryByText(/Сводка протухла/)).not.toBeInTheDocument()
  })
})

// --- AC-11: deferred-фиксы 10.3 -------------------------------------------------------------

describe('10.6 DaySubmissionPanel — deferred-фиксы 10.3 (AC-11)', () => {
  it('(а) рефетч принёс серверную v2 после локального 201 v1 → рендерятся серверные версия/событие', async () => {
    // Чужой amendment между 201 и рефетчем: сервер v2 обязан победить
    // застывший локальный 201 v1 (server.version >= local.version).
    const urls = useDayStateHandler(
      unsubmittedFixture(),
      unsubmittedFixture(),
      submittedFixture(amendedSubmission()),
    )
    useSubmitHandler('created') // 201 → v1
    renderPanel()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    // после инвалидации панель показывает СЕРВЕРНУЮ v2, не локальную v1
    expect(await screen.findByText(/версия 2/)).toBeInTheDocument()
    expect(screen.queryByText(/версия 1/)).not.toBeInTheDocument()
    await waitFor(() => expect(urls.length).toBeGreaterThan(2))
  })

  it('(б) 201 чужой дивизии после смены селекта НЕ красит панель (division-гард)', async () => {
    const divisions = [
      { division_id: DIV_A, name: 'Отдел А', submission: null },
      { division_id: DIV_B, name: 'Отдел Б', submission: null },
    ]
    const urls: string[] = []
    server.use(
      http.get(
        '*/api/operations/daily-submissions/day-state/',
        ({ request }) => {
          urls.push(request.url)
          const div = new URL(request.url).searchParams.get('division_id')
          return HttpResponse.json({
            divisions,
            detail:
              div === null
                ? null
                : {
                    preview_event:
                      div === DIV_A ? 'CHANGED' : 'CONFIRMED_NO_CHANGES',
                    traffic_light: null,
                    amendment: null,
                    summary: null,
                  },
          })
        },
      ),
    )
    const bodies = useSubmitHandler('created') // 201 всегда DIV_A
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    fireEvent.change(select, { target: { value: DIV_A } })
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    // смена селекта, пока 201 в полёте (msw delay)
    fireEvent.change(screen.getByLabelText('Подразделение'), {
      target: { value: DIV_B },
    })
    await screen.findByText(/Подтверждение без изменений/)
    await waitFor(() => expect(bodies.length).toBe(1))
    // 201 прежней дивизии обработан (инвалидация прошла) — панель НОВОЙ
    // дивизии осталась несданной
    await waitFor(() =>
      expect(
        urls.filter(
          (u) => new URL(u).searchParams.get('division_id') === DIV_B,
        ).length,
      ).toBeGreaterThan(1),
    )
    expect(screen.queryByText(/День сдан/)).not.toBeInTheDocument()
  })
})
