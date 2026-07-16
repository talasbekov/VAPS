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

afterEach(() => cleanup())

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

/** Один DIV_A, несдано, серверная категория preview. */
function unsubmittedFixture(
  preview: 'CONFIRMED_NO_CHANGES' | 'CHANGED' = 'CHANGED',
): DayStateResponse {
  return {
    divisions: [{ division_id: DIV_A, name: 'Отдел А', submission: null }],
    detail: { preview_event: preview, traffic_light: null },
  }
}

function submittedFixture(
  submission: DaySubmission = makeSubmission(),
  trafficLight: { status: string; late: boolean; drift: unknown } | null = {
    status: 'GREEN',
    late: false,
    drift: null,
  },
): DayStateResponse {
  return {
    divisions: [{ division_id: DIV_A, name: 'Отдел А', submission }],
    detail: { preview_event: null, traffic_light: trafficLight },
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
