// @vitest-environment jsdom
// Story 10.2 — экран «Расход дня»: prefill «вчера» (живой GET), состояния
// loading/error/empty/пустой справочник, bulk-отправка (pending/успех/rebase),
// обратный канал «bulk-ответ → маркеры», ConflictDialog + ограниченный цикл,
// каналы ARCH-FE-015 ДО маркеров, beforeunload/смена даты. RTL + msw
// (shared/api/testing) через локальную Harness-обвязку shared-примитивов.
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ErrorEnvelope } from '../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../shared/api/useApiMutation'
import {
  authRequiredEnvelope,
  serverEnvelope,
  validationEnvelope,
} from '../../shared/api/testing/handlers'
import { server } from '../../shared/api/testing/server'
import { ToastProvider } from '../../shared/ui/toast'
import { DailyExpensePage, rowsToMarkers } from './DailyExpensePage'
import type { GridPrefillResponse } from './prefill'
import { addDaysIso } from './prefill'

// Локальная обвязка из shared-примитивов (ARCH-FE-013: features → app
// забанен, Providers сюда не импортировать). 401-цепь 8.6 (QueryCache/
// MutationCache onError → clearCredential) — app-композиция, запинена
// auth-flow.test.tsx; здесь ассертится ответственность ЭКРАНА: 401 не
// перехватывается и в маркеры/диалог не маппится.
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

// --- Обвязка TanStack Virtual в jsdom (прецедент 9.4/9.7) --------------------

// jsdom НЕ реализует методы <dialog> — минимальный полифилл open-семантики
// (прецедент ConflictDialog.test.tsx, уточнение Ловушки 3).
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
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      origOffsetHeight,
    )
  if (origOffsetWidth)
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Панель «Сдача дня» (10.3) живёт на странице и грузит day-state — дефолтный
// хэндлер, чтобы сюита 10.2 не падала на onUnhandledRequest: 'error'.
// Глубокие сценарии панели — в DaySubmissionPanel.test.tsx (не дублировать).
beforeEach(() => {
  server.use(
    http.get('*/api/operations/daily-submissions/day-state/', () =>
      HttpResponse.json({ divisions: [], detail: null }),
    ),
  )
})

// --- Фикстуры ----------------------------------------------------------------

const TIMESTAMP = '2026-07-16T09:00:00+05:00'
const DATE = '2026-07-16' // выставляется в date-input после рендера
const PREFILL_DATE = '2026-07-15' // DATE − 1 (Решение №6)

function prefillFixture(businessDate: string): GridPrefillResponse {
  return {
    business_date: businessDate,
    employees: [
      { id: 'e1', full_name: 'Асанов', rank: '' },
      { id: 'e2', full_name: 'Борисов', rank: 'Майор' },
    ],
    statuses: [
      // Полуинтервал [05, 20) → UI-период «по 19 включительно».
      {
        employee_id: 'e2',
        status_type_code: 'VACATION',
        date_start: '2026-07-05',
        date_end: '2026-07-20',
      },
    ],
    status_types: [
      { code: 'IN_SERVICE', name: 'В строю' },
      { code: 'VACATION', name: 'Отпуск' },
      { code: 'SICK', name: 'На больничном' },
    ],
  }
}

const conflict409Envelope: ErrorEnvelope = {
  error_code: 'STATUS_OVERLAP_WARNING',
  message: 'Массовое обновление отклонено: см. detail.rows.',
  details: {
    rows: [
      {
        index: 0,
        employee_id: 'e1',
        code: 'STATUS_OVERLAP_WARNING',
        http_status: 409,
        message: 'Статус пересекает soft-статус сотрудника.',
      },
    ],
  },
  request_id: null,
  timestamp: TIMESTAMP,
}

const hard422Envelope: ErrorEnvelope = {
  error_code: 'OVERLAPPING_HARD_STATUS',
  message: 'Массовое обновление отклонено: см. detail.rows.',
  details: {
    rows: [
      {
        index: 0,
        employee_id: 'e1',
        code: 'OVERLAPPING_HARD_STATUS',
        http_status: 422,
        message: 'Статус конфликтует с hard-статусом сотрудника.',
      },
    ],
  },
  request_id: null,
  timestamp: TIMESTAMP,
}

// --- Хэндлеры ----------------------------------------------------------------

function usePrefillHandler(
  fixture: (businessDate: string) => GridPrefillResponse = prefillFixture,
): string[] {
  const urls: string[] = []
  server.use(
    http.get('*/api/operations/statuses/grid-prefill/', ({ request }) => {
      urls.push(request.url)
      const bd = new URL(request.url).searchParams.get('business_date') ?? ''
      return HttpResponse.json(fixture(bd))
    }),
  )
  return urls
}

type BulkReply = { status: number; body: unknown } | 'created'

function useBulkHandler(...replies: BulkReply[]): unknown[] {
  const bodies: unknown[] = []
  let call = 0
  server.use(
    http.post('*/api/operations/statuses/bulk/', async ({ request }) => {
      bodies.push(await request.json())
      const reply = replies[Math.min(call++, replies.length - 1)]
      await delay(20) // даёт наблюдать isPending-дизейбл кнопки
      if (reply === 'created')
        return HttpResponse.json({ created: bodies.length }, { status: 201 })
      return HttpResponse.json(reply.body as Record<string, unknown>, {
        status: reply.status,
      })
    }),
  )
  return bodies
}

// --- Рендер-хелперы ------------------------------------------------------------

async function renderPageAt(date: string = DATE) {
  render(
    <Harness>
      <DailyExpensePage />
    </Harness>,
  )
  fireEvent.change(screen.getByLabelText('Дата'), { target: { value: date } })
  await screen.findByRole('grid')
}

function rowOf(fullName: string): HTMLElement {
  const row = screen.getByText(fullName).closest<HTMLElement>('[data-grid-row]')
  if (!row) throw new Error(`Строка «${fullName}» не найдена`)
  return row
}

/** Правка строки 0 (Асанов) на code; COMMIT обратно в NAVIGATE. */
function editFirstRowTo(code: string) {
  const grid = screen.getByRole('grid')
  fireEvent.keyDown(grid, { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('Статус'), {
    target: { value: code },
  })
  fireEvent.keyDown(grid, { key: 'Enter' })
}

const EXPECTED_DELTA_BODY = {
  business_date: DATE,
  rows: [
    {
      employee_id: 'e1',
      status_type_code: 'SICK',
      date_start: DATE,
      date_end: addDaysIso(DATE, 1),
    },
  ],
}

// --- AC-2/AC-3: экран, дефолт даты, prefill за «дату − 1» ---------------------

describe('10.2 DailyExpensePage — данные и состояния (AC-2/AC-3/AC-4)', () => {
  it('дефолт даты — сегодняшняя локальная; prefill грузится за дату − 1; грид предзаполнен', async () => {
    const urls = usePrefillHandler()
    render(
      <Harness>
        <DailyExpensePage />
      </Harness>,
    )
    const input = screen.getByLabelText('Дата') as HTMLInputElement
    // Дефолт — сегодняшняя ЛОКАЛЬНАЯ дата (не UTC-срез).
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(input.value).toBe(today)
    await screen.findByRole('grid')
    expect(urls.length).toBeGreaterThan(0)
    expect(new URL(urls[0]).searchParams.get('business_date')).toBe(
      addDaysIso(today, -1),
    )
  })

  it('смена даты → prefill за новую дату − 1; маппер: вчерашний статус + период date_end − 1; rank "" не рендерит мусор', async () => {
    const urls = usePrefillHandler()
    await renderPageAt()
    expect(
      new URL(urls[urls.length - 1]).searchParams.get('business_date'),
    ).toBe(PREFILL_DATE)
    // Борисов: вчерашний VACATION → label справочника + период «по 19 включительно»
    const row = rowOf('Борисов')
    expect(within(row).getByText('Отпуск')).toBeInTheDocument()
    expect(within(row).getByText('2026-07-19')).toBeInTheDocument()
    // Асанов без записи → дефолт IN_SERVICE (buildPrefilledRows)
    expect(within(rowOf('Асанов')).getByText('В строю')).toBeInTheDocument()
  })

  it('loading-состояние, пока запрос в полёте', async () => {
    server.use(
      http.get('*/api/operations/statuses/grid-prefill/', async () => {
        await delay(60)
        return HttpResponse.json(prefillFixture(PREFILL_DATE))
      }),
    )
    render(
      <Harness>
        <DailyExpensePage />
      </Harness>,
    )
    // /Загрузка расстановки/ — не просто /Загрузка/: панель сдачи 10.3 несёт
    // собственный лоадер «Загрузка состояния сдачи…».
    expect(screen.getByText(/Загрузка расстановки/)).toBeInTheDocument()
    await screen.findByRole('grid')
  })

  it('пустой employees → пустое состояние грида, НЕ падение', async () => {
    usePrefillHandler((bd) => ({
      ...prefillFixture(bd),
      employees: [],
      statuses: [],
    }))
    render(
      <Harness>
        <DailyExpensePage />
      </Harness>,
    )
    expect(await screen.findByTestId('grid-empty')).toBeInTheDocument()
  })

  it('AC-4: пустой справочник → грид НЕ рендерится, ошибка с повтором (refetch)', async () => {
    let call = 0
    server.use(
      http.get('*/api/operations/statuses/grid-prefill/', ({ request }) => {
        call += 1
        const bd = new URL(request.url).searchParams.get('business_date') ?? ''
        if (call === 1)
          return HttpResponse.json({ ...prefillFixture(bd), status_types: [] })
        return HttpResponse.json(prefillFixture(bd))
      }),
    )
    render(
      <Harness>
        <DailyExpensePage />
      </Harness>,
    )
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    fireEvent.click(retry)
    await screen.findByRole('grid') // после refetch справочник живой
  })

  it('AC-4: ошибка загрузки prefill → состояние ошибки с повтором, грида нет', async () => {
    let call = 0
    server.use(
      http.get('*/api/operations/statuses/grid-prefill/', ({ request }) => {
        call += 1
        if (call === 1)
          return HttpResponse.json(serverEnvelope, { status: 500 })
        const bd = new URL(request.url).searchParams.get('business_date') ?? ''
        return HttpResponse.json(prefillFixture(bd))
      }),
    )
    render(
      <Harness>
        <DailyExpensePage />
      </Harness>,
    )
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    fireEvent.click(retry)
    await screen.findByRole('grid')
  })
})

// --- AC-5/AC-6: отправка, pending, счётчик, rebase ----------------------------

describe('10.2 DailyExpensePage — отправка (AC-5/AC-6)', () => {
  it('ровно один POST с телом «только дельты»; кнопка disabled на isPending; повторный клик запроса не плодит', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler('created')
    await renderPageAt()
    editFirstRowTo('SICK')
    const submit = screen.getByText('Сохранить изменения')
    fireEvent.click(submit)
    await waitFor(() => expect(submit).toBeDisabled()) // isPending-гейт
    fireEvent.click(submit) // клик по disabled — запроса нет
    await screen.findByText(/Применено отклонений: 1/)
    expect(bodies).toEqual([EXPECTED_DELTA_BODY])
  })

  it('успех: счётчик из ОТВЕТА + rebase initials — повторный «Сохранить изменения» без правок запрос НЕ шлёт, beforeunload снят', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler({ status: 201, body: { created: 7 } })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    // Счётчик — из ответа бэка (7), не из длины запроса (1).
    await screen.findByText(/Применено отклонений: 7/)
    // Rebase: дельты обнулились (введённое стало новым initial).
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 2',
    )
    fireEvent.click(screen.getByText('Сохранить изменения'))
    expect(bodies.length).toBe(1) // повторного POST нет
    // beforeunload нейтрален после успеха.
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('ревью №2: правка ВО ВРЕМЯ полёта bulk переживает onSuccess-rebase (edited-ветка RESYNC)', async () => {
    usePrefillHandler()
    // Управляемая задержка bulk: ответ уходит ТОЛЬКО после release() — окно
    // isPending детерминировано открыто для правки «в полёте».
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('*/api/operations/statuses/bulk/', async () => {
        await gate
        return HttpResponse.json({ created: 1 }, { status: 201 })
      }),
    )
    await renderPageAt()
    editFirstRowTo('SICK') // ячейка A (Асанов); COMMIT уводит фокус на строку 1
    const submit = screen.getByText('Сохранить изменения')
    fireEvent.click(submit)
    await waitFor(() => expect(submit).toBeDisabled()) // bulk в полёте
    // Во время isPending правится ячейка B (Борисов): фокус после COMMIT уже
    // на строке 1 (грамматика: Enter-COMMIT = вниз).
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Статус'), {
      target: { value: 'SICK' },
    })
    fireEvent.keyDown(grid, { key: 'Enter' })
    release()
    await screen.findByText(/Применено отклонений: 1/)
    // onSuccess-rebase (мерж lastChangesRef → initials → RESYNC) НЕ затёр
    // введённое в полёте: правка живёт как дельта против нового initial.
    expect(
      within(rowOf('Борисов')).getByText('На больничном'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 1 из 2',
    )
  })

  it('0 дельт → запроса нет (существующее поведение 9.7)', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler('created')
    await renderPageAt()
    fireEvent.click(screen.getByText('Сохранить изменения'))
    expect(bodies.length).toBe(0)
  })
})

// --- AC-7/AC-8: 409-агрегат → диалог + маркеры; оверрайд + ограниченный цикл --

describe('10.2 DailyExpensePage — конфликты (AC-7/AC-8)', () => {
  it('409-агрегат → ConflictDialog с ФИО и сообщением строки + soft-маркер строки; «Отмена» — без повтора, маркер и баннер остаются', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler({ status: 409, body: conflict409Envelope })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    const dialog = await screen.findByRole('dialog')
    // Детализация: ФИО (резолв по employee_id из текущих rows) + message.
    const rows = within(dialog).getByTestId('conflict-rows')
    expect(rows.textContent).toContain('Асанов')
    expect(rows.textContent).toContain(
      'Статус пересекает soft-статус сотрудника.',
    )
    // Обратный канал: строка получила soft-маркер.
    await waitFor(() =>
      expect(rowOf('Асанов')).toHaveAttribute('data-marker', 'soft'),
    )
    fireEvent.click(within(dialog).getByText('Отмена'))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(bodies.length).toBe(1) // повтора нет
    expect(rowOf('Асанов')).toHaveAttribute('data-marker', 'soft') // остаётся
    expect(screen.getByRole('alert')).toBeInTheDocument() // ошибка видима
  })

  it('оверрайд: причина 10–500 гейтит кнопку; повтор = исходное тело + override/override_reason; повторный 409 → жёсткий баннер, диалог НЕ по кругу', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler(
      { status: 409, body: conflict409Envelope },
      { status: 409, body: conflict409Envelope },
    )
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByText('Подтвердить оверрайд')
    const reason = within(dialog).getByLabelText(/Причина/)
    fireEvent.change(reason, { target: { value: 'коротко' } }) // < 10
    expect(confirm).toBeDisabled()
    fireEvent.change(reason, {
      target: { value: 'наряд сокращён по приказу №1' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    // Повторный 409 ПОСЛЕ оверрайда: диалог не открывается снова.
    await screen.findByText(/Конфликт не разрешён/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bodies.length).toBe(2)
    expect(bodies[1]).toEqual({
      ...EXPECTED_DELTA_BODY,
      override: true,
      override_reason: 'наряд сокращён по приказу №1',
    })
  })

  it('новая отправка после жёсткого баннера сбрасывает цикл: диалог снова доступен', async () => {
    usePrefillHandler()
    useBulkHandler(
      { status: 409, body: conflict409Envelope },
      { status: 409, body: conflict409Envelope },
      { status: 409, body: conflict409Envelope },
    )
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Причина/), {
      target: { value: 'наряд сокращён по приказу №1' },
    })
    fireEvent.click(within(dialog).getByText('Подтвердить оверрайд'))
    await screen.findByText(/Конфликт не разрешён/)
    // Новая отправка (новый mutate) = новый цикл → диалог открывается опять.
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await screen.findByRole('dialog')
  })
})

// --- AC-9: 422-агрегат → маркеры без диалога ----------------------------------

describe('10.2 DailyExpensePage — 422-агрегат (AC-9)', () => {
  it('422 → диалога НЕТ, hard-маркер, баннер «Отклонено: N строк», отправка заблокирована гейтом грида', async () => {
    usePrefillHandler()
    const bodies = useBulkHandler({ status: 422, body: hard422Envelope })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await screen.findByText(/Отклонено: 1/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(rowOf('Асанов')).toHaveAttribute('data-marker', 'hard')
    // Существующий гейт: hard блокирует повторный сабмит до правки строк.
    expect(screen.getByText('Сохранить изменения')).toBeDisabled()
    expect(bodies.length).toBe(1)
  })
})

// --- AC-10: каналы ARCH-FE-015 ДО маркеров ------------------------------------

describe('10.2 DailyExpensePage — каналы ошибок (AC-10)', () => {
  it('5xx → generic-тост, НИ маркеров, НИ диалога, грид не заблокирован', async () => {
    usePrefillHandler()
    useBulkHandler({ status: 500, body: serverEnvelope })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await screen.findByText(GENERIC_FAILURE_MESSAGE)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-marker]').length).toBe(0)
    await waitFor(() =>
      expect(screen.getByText('Сохранить изменения')).toBeEnabled(),
    )
  })

  it('400 VALIDATION_ERROR → баннер формы, не маркеры', async () => {
    usePrefillHandler()
    useBulkHandler({ status: 400, body: validationEnvelope })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await screen.findByText(/Запрос отклонён/)
    expect(document.querySelectorAll('[data-marker]').length).toBe(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('401 → экран НЕ перехватывает (цепь 8.6 — app-композиция, запинена auth-flow.test.tsx): ни маркеров, ни диалога, ни баннера формы', async () => {
    usePrefillHandler()
    useBulkHandler({ status: 401, body: authRequiredEnvelope })
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    // Мутация завершилась ошибкой: pending-гейт снят — канал 401 отработал
    // МИМО экрана (страница его не рендерит и не маппит).
    await waitFor(() => expect(screen.getByText('Сохранить изменения')).toBeEnabled())
    expect(document.querySelectorAll('[data-marker]').length).toBe(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Запрос отклонён/)).not.toBeInTheDocument()
  })
})

// --- AC-11: beforeunload + смена даты -----------------------------------------

describe('10.2 DailyExpensePage — защита ввода (AC-11)', () => {
  it('несохранённые дельты → beforeunload предотвращён; без дельт — нейтрален', async () => {
    usePrefillHandler()
    await renderPageAt()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    editFirstRowTo('SICK')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('смена даты с dirty-гридом: отказ — дата не меняется; согласие — грид ремоунтится за новую дату', async () => {
    const urls = usePrefillHandler()
    await renderPageAt()
    editFirstRowTo('SICK')
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 1 из 2',
    )
    const input = screen.getByLabelText('Дата') as HTMLInputElement
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(input, { target: { value: '2026-07-17' } })
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(input.value).toBe(DATE) // отказ — дата не сменилась
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 1 из 2',
    )
    confirmSpy.mockReturnValue(true)
    fireEvent.change(input, { target: { value: '2026-07-17' } })
    expect(input.value).toBe('2026-07-17')
    // Ремоунт за новую дату: дельты старого дня не пережили смену.
    await waitFor(() =>
      expect(screen.getByTestId('changed-counter').textContent).toContain(
        'Изменено 0 из 2',
      ),
    )
    expect(
      new URL(urls[urls.length - 1]).searchParams.get('business_date'),
    ).toBe('2026-07-16') // prefill за (2026-07-17 − 1)
  })

  it('ревью №3: успех → смена даты → applied-значения старой даты НЕ перетекают в новую (батч сбросов onDateChange)', async () => {
    const urls = usePrefillHandler()
    useBulkHandler('created')
    await renderPageAt()
    editFirstRowTo('SICK')
    fireEvent.click(screen.getByText('Сохранить изменения'))
    await screen.findByText(/Применено отклонений: 1/)
    // Rebase на СТАРОЙ дате: применённое значение стало новым initial.
    expect(
      within(rowOf('Асанов')).getByText('На больничном'),
    ).toBeInTheDocument()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('Дата'), {
      target: { value: '2026-07-17' },
    })
    // Фактическое поведение: после успеха дельт нет (rebase) → isDirty()
    // ложен → confirm НЕ спрашивается вовсе.
    expect(confirmSpy).not.toHaveBeenCalled()
    await screen.findByRole('grid')
    // Новая дата: initial — из СВЕЖЕГО prefill; applied старого дня (SICK
    // Асанова) НЕ перетёк через appliedChanges-мерж в yesterday.
    await waitFor(() =>
      expect(within(rowOf('Асанов')).getByText('В строю')).toBeInTheDocument(),
    )
    // Счётчик «Применено» сброшен, дельт на новой дате нет.
    expect(
      screen.queryByText(/Применено отклонений/),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('changed-counter').textContent).toContain(
      'Изменено 0 из 2',
    )
    expect(
      new URL(urls[urls.length - 1]).searchParams.get('business_date'),
    ).toBe('2026-07-16') // prefill за (2026-07-17 − 1)
  })
})

// --- 10.3: композиция страницы — лейбл кнопки + smoke панели -------------------

describe('10.3 DailyExpensePage — панель сдачи (smoke, AC-5/AC-13)', () => {
  it('bulk-кнопка грида подписана «Сохранить изменения»; панель «Сдача дня» под гридом', async () => {
    usePrefillHandler()
    await renderPageAt()
    expect(
      screen.getByRole('button', { name: 'Сохранить изменения' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('day-submission-panel')).toBeInTheDocument()
    expect(screen.getByText('Сдача дня')).toBeInTheDocument()
    // «Сдать день» страницы больше не существует вне панели: day-state этой
    // сюиты пуст (нет видимых подразделений) → кнопки сдачи нет вовсе.
    expect(
      screen.queryByRole('button', { name: 'Сдать день' }),
    ).not.toBeInTheDocument()
  })
})

// --- Task 7: rowsToMarkers (unit) ----------------------------------------------

describe('10.2 rowsToMarkers', () => {
  it('422→hard, 409→soft, неизвестный статус→hard; ключ = employee_id', () => {
    expect(
      rowsToMarkers([
        { employee_id: 'a', http_status: 422 },
        { employee_id: 'b', http_status: 409 },
        { employee_id: 'c', http_status: 404 },
      ]),
    ).toEqual({ a: 'hard', b: 'soft', c: 'hard' })
  })

  it('строка без employee_id пропускается (defensive)', () => {
    expect(rowsToMarkers([{ http_status: 409 }])).toEqual({})
  })
})
