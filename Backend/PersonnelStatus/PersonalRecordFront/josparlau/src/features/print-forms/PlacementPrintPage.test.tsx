// @vitest-environment jsdom
// Smart Josparlau §9.15 — печатная форма расстановки. jsdom CSS НЕ парсит
// (Ловушка 11 стори 8.8): ассертим РАЗМЕТКУ (порядок ячеек, тексты, classList);
// computed styles, @media print и то, что маркер demo реально печатается,
// судит e2e в реальном браузере.
//
// ⚠️ Фикстура прав здесь НЕ нужна: страница сама `usePermissions` не зовёт —
// гейт стоит СНАРУЖИ, в роутере (`App.tsx`, `ops.security_event.view`).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../shared/auth/credential'
import { PlacementPrintPage } from './PlacementPrintPage'
import {
  ACKNOWLEDGED_TEXT,
  DEMO_MARK_TEXT,
  MISSING_PARAMS_TEXT,
  NOT_ACKNOWLEDGED_TEXT,
  NOT_ASSIGNED_TEXT,
  NOT_FOUND_TEXT,
  NO_POSTS_TEXT,
  PERMISSION_TEXT,
  UNPARSEABLE_TEXT,
} from './placementPrint'

const EVENT_ID = 'se-print-1'

// ⚠️ MSW-предикат ОБЯЗАН начинаться с `*`: в env node нет `location`, и
// относительный путь молча не матчится.
const EVENT_URL = '*/api/ops/security-events/:id/'

const EVENT_BODY = {
  id: EVENT_ID,
  code: 'ОМ-2026-014',
  title: 'Визит делегации',
  objectName: 'Резиденция «Ак Орда»',
  businessDate: '2026-07-22',
  ownerName: 'Тастанов Г. К.',
  stage: 'APPROVAL',
  updatedAt: '2026-07-20T09:15:00+05:00',
  reconSectorPosts: [
    {
      id: 'post-1',
      sector: 'Северный сектор',
      post: 'Пост №1 (КПП)',
      task: 'Пропускной режим',
      requirements: 'Допуск формы 2',
      need: 2,
      // §19.24: оценочные пометки в документ не попадают — ассерт ниже.
      result: 'NEEDS_CHANGES',
      comment: 'Замечание проверяющего по посту',
    },
    {
      id: 'post-2',
      sector: 'Южный сектор',
      post: 'Пост №2 (парковка)',
      task: 'Досмотр транспорта',
      requirements: 'Кинолог',
      need: 1,
      result: 'MATCHES',
      comment: '',
    },
  ],
  placementAssignments: [
    {
      id: 'a-1',
      postId: 'post-1',
      employeeId: 'emp-1',
      employeeName: 'Байжанов С. Т.',
      acknowledgedAt: '2026-07-20T08:40:00+05:00',
    },
    {
      id: 'a-2',
      postId: 'post-1',
      employeeId: 'emp-2',
      employeeName: 'Ермеков А. Н.',
      acknowledgedAt: null,
    },
  ],
}

function errorEnvelope(errorCode: string, message: string) {
  return {
    error_code: errorCode,
    message,
    details: {},
    request_id: 'req-placement-print',
    timestamp: '2026-07-20T08:00:00+05:00',
  }
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  // clearCredential в afterEach, а не в хвосте теста: упавший тест протащил бы
  // credential дальше.
  clearCredential()
})

function renderPage({ eventId = EVENT_ID }: { eventId?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* Literal-путь в initialEntries легален: route-канон ARCH-FE-012
            исключает тесты. */}
        <MemoryRouter
          initialEntries={[
            eventId === ''
              ? '/print/placement'
              : `/print/placement?security_event_id=${eventId}`,
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<PlacementPrintPage />, { wrapper: Wrapper })
}

function bodyRows(): string[][] {
  return Array.from(document.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? ''),
  )
}

describe('PlacementPrintPage: документ', () => {
  beforeEach(() => {
    server.use(http.get(EVENT_URL, () => HttpResponse.json(EVENT_BODY)))
  })

  it('шапка документа: заголовок и реквизиты ОМ', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(
      screen.getByRole('heading', { name: 'РАССТАНОВКА СИЛ И СРЕДСТВ' }),
    ).toBeInTheDocument()
    // Дата — в формате документа (ДД.ММ.ГГГГ), не ISO.
    expect(
      screen.getByText(
        'ОМ-2026-014 · Визит делегации · Резиденция «Ак Орда» · 22.07.2026',
      ),
    ).toBeInTheDocument()
  })

  it('маркер demo присутствует и НЕ скрыт экранной подсказкой (§9.15)', async () => {
    renderPage()
    await screen.findByRole('table')
    const mark = screen.getByText(DEMO_MARK_TEXT)
    // Класс несущий: `.print-demo` печатается, `.print-screen-hint` — нет.
    // Перепутанный класс сделал бы distributed лист неотличимым от официального.
    expect(mark).toHaveClass('print-demo')
    expect(mark).not.toHaveClass('print-screen-hint')
  })

  it('строки таблицы: пост×назначение, дырка и повтор — в точном порядке', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(bodyRows()).toEqual([
      [
        '1',
        'Северный сектор',
        'Пост №1 (КПП)',
        'Пропускной режим',
        'Допуск формы 2',
        '2',
        'Байжанов С. Т.',
        ACKNOWLEDGED_TEXT,
      ],
      [
        '2',
        'Северный сектор',
        'Пост №1 (КПП)',
        'Пропускной режим',
        'Допуск формы 2',
        // Потребность печатается ОДИН раз на пост — иначе документ читается
        // как «на посту нужно 2+2».
        '—',
        'Ермеков А. Н.',
        NOT_ACKNOWLEDGED_TEXT,
      ],
      [
        '3',
        'Южный сектор',
        'Пост №2 (парковка)',
        'Досмотр транспорта',
        'Кинолог',
        '1',
        NOT_ASSIGNED_TEXT,
        '—',
      ],
    ])
  })

  it('итоги: потребность и назначено — два независимых числа', async () => {
    renderPage()
    await screen.findByRole('table')
    const footCells = Array.from(
      document.querySelectorAll('tfoot td'),
    ).map((td) => td.textContent ?? '')
    expect(footCells).toEqual(['', 'ИТОГО', '', '', '', '3', '2', ''])
  })

  it('оценочные поля рекогносцировки в документ НЕ попадают (§19.24)', async () => {
    renderPage()
    await screen.findByRole('table')
    // Красная проба: подмешать `comment` в вёрстку — и этот ассерт покраснеет.
    expect(
      screen.queryByText(/Замечание проверяющего по посту/),
    ).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NEEDS_CHANGES')
  })

  it('подвал: snapshot-реквизиты, стадия — русской подписью', async () => {
    renderPage()
    await screen.findByRole('table')
    const note = document.querySelector('.print-note')
    expect(note?.textContent).toContain('Тастанов Г. К.')
    expect(note?.textContent).toContain('Согласование')
    expect(note?.textContent).toContain('2026-07-20T09:15:00+05:00')
    // ФИО демо-ростера кончаются точкой («Тастанов Г. К.») — наивная склейка
    // давала «Тастанов Г. К..» (реальный баг, найден ручной QA живого DOM).
    expect(note?.textContent).not.toMatch(/\.\./)
  })

  it('UI-слой на бумагу не протекает: в документе только print-*-классы', async () => {
    renderPage()
    await screen.findByRole('table')
    const classed = Array.from(document.querySelectorAll('[class]'))
    expect(classed.length).toBeGreaterThan(0)
    for (const node of classed) {
      for (const token of node.classList) {
        expect(token).toMatch(/^print-/)
      }
    }
  })
})

describe('PlacementPrintPage: состояния без документа', () => {
  it('без параметра — объясняющий текст и НИ ОДНОЙ строки документа', () => {
    renderPage({ eventId: '' })
    expect(screen.getByText(MISSING_PARAMS_TEXT)).toBeInTheDocument()
    // Шапка в этом состоянии не рендерится: «РАССТАНОВКА» без ОМ и даты —
    // испорченный по форме лист.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByText(DEMO_MARK_TEXT)).not.toBeInTheDocument()
  })

  it('403 — текст про зону доступа, таблицы нет', async () => {
    server.use(
      http.get(EVENT_URL, () =>
        HttpResponse.json(
          errorEnvelope('PERMISSION_DENIED', 'нет доступа'),
          { status: 403 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText(PERMISSION_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // Маркер demo остаётся: лист без данных тоже не официальный.
    expect(screen.getByText(DEMO_MARK_TEXT)).toBeInTheDocument()
  })

  it('404 — «мероприятие не найдено»', async () => {
    server.use(
      http.get(EVENT_URL, () =>
        HttpResponse.json(errorEnvelope('NOT_FOUND', 'нет'), { status: 404 }),
      ),
    )
    renderPage()
    expect(await screen.findByText(NOT_FOUND_TEXT)).toBeInTheDocument()
  })

  it('5xx получает ТЕКСТ, а не молчаливый пустой лист', async () => {
    server.use(
      http.get(EVENT_URL, () =>
        HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'сервер упал'), {
          status: 500,
        }),
      ),
    )
    renderPage()
    await waitFor(() => {
      expect(
        document.querySelector('.print-status')?.textContent ?? '',
      ).toContain('Не удалось загрузить расстановку')
    })
  })

  it('200 с телом не-карточкой — отдельный текст, а не пустая таблица', async () => {
    server.use(http.get(EVENT_URL, () => HttpResponse.json({ oops: true })))
    renderPage()
    expect(await screen.findByText(UNPARSEABLE_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('карточка без постов и назначений — «расстановка не формировалась»', async () => {
    server.use(
      http.get(EVENT_URL, () =>
        HttpResponse.json({
          ...EVENT_BODY,
          reconSectorPosts: [],
          placementAssignments: [],
        }),
      ),
    )
    renderPage()
    expect(await screen.findByText(NO_POSTS_TEXT)).toBeInTheDocument()
    // Шапка ЕСТЬ (данные пришли) — состояние отличается от «нет параметра».
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })
})
