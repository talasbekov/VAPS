// @vitest-environment jsdom
// Стори 10.7 — печатная форма расхода. jsdom CSS НЕ парсит (Ловушка 11 стори
// 8.8): ассертим РАЗМЕТКУ (порядок ячеек, тексты, classList); computed styles,
// загрузку PT Serif и @media print судит только e2e в реальном браузере.
//
// ⚠️ Фикстура `my-permissions` здесь НЕ нужна: `ExpensePrintPage` сам
// `usePermissions` не зовёт — гейт стоит СНАРУЖИ, в роутере. Двухшаговый сетап
// прав живёт в `src/app/print-expense-routing.test.tsx` (Task 8).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../shared/auth/credential'
import { ExpensePrintPage } from './ExpensePrintPage'
import { PRINT_NO_DATA_MESSAGE, PRINT_PERMISSION_MESSAGE } from './expensePrint'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const BUSINESS_DATE = '2026-07-19'

// ⚠️ MSW-предикаты ОБЯЗАНЫ начинаться с `*`: в env node нет `location`, и
// относительный путь молча не матчится (отладка выглядит как «хендлер есть, а
// тест валится по unhandled request»). Дефолта `/period/` в handlers.ts нет.
const PERIOD_URL = '*/api/operations/expense-reports/period/'
const DIVISIONS_URL = '*/api/core/divisions/'

/**
 * Числа по колонкам РАЗНЫЕ и НЕНУЛЕВЫЕ: одинаковые сделали бы ассерты порядка
 * колонок вакуумными («сравнение с самим собой», ретро E9). Сходимость §8
 * держится: Σ 11 статусных == По списку; По штату == По списку + Вакансии;
 * ATTACHED в сумму НЕ входит (прикомандированные вне списка).
 */
const ROW_ONE = {
  division_id: DIVISION_ID,
  name: 'Шығыс басқармасы',
  staff_total: 140,
  list_total: 129,
  vacancies: 11,
  attached: 12,
  columns: {
    IN_SERVICE: 71,
    ON_DUTY: 13,
    AFTER_DUTY: 9,
    COMMAND: 5,
    TRAINING: 3,
    VACATION: 8,
    SICK: 6,
    DETACHED: 2,
    BEFORE_DUTY: 1,
    OTHER: 4,
    PENDING: 7,
  },
}

const ROW_TWO = {
  division_id: 'b2c3d4e5-f607-4819-a2b3-c4d5e6f70819',
  name: 'Батыс басқармасы',
  staff_total: 120,
  list_total: 102,
  vacancies: 18,
  attached: 21,
  columns: {
    IN_SERVICE: 40,
    ON_DUTY: 6,
    AFTER_DUTY: 4,
    COMMAND: 2,
    TRAINING: 14,
    VACATION: 10,
    SICK: 3,
    DETACHED: 9,
    BEFORE_DUTY: 5,
    OTHER: 1,
    PENDING: 8,
  },
}

const TOTALS = {
  staff_total: 260,
  list_total: 231,
  vacancies: 29,
  attached: 33,
  columns: {
    IN_SERVICE: 111,
    ON_DUTY: 19,
    AFTER_DUTY: 13,
    COMMAND: 7,
    TRAINING: 17,
    VACATION: 18,
    SICK: 9,
    DETACHED: 11,
    BEFORE_DUTY: 6,
    OTHER: 5,
    PENDING: 15,
  },
}

function periodResponse() {
  return HttpResponse.json({
    pages: [
      { business_date: BUSINESS_DATE, totals: TOTALS, rows: [ROW_ONE, ROW_TWO] },
    ],
  })
}

/**
 * ⚠️ Успешный справочник ОБЯЗАТЕЛЕН, и он НЕ содержит запрошенный division_id.
 * Дефолт `handlers.ts:253` — `HttpResponse.error()` (сетевой обрыв, не список):
 * без переопределения фолбэк на UUID сработал бы ОТ ОШИБКИ справочника, а не
 * от отсутствия записи, и мутация «убрать `?? divisionId`» осталась бы зелёной
 * — ассерт вакуумен по построению (Ловушка 12).
 */
function divisionsWithoutRequested() {
  return HttpResponse.json({
    count: 2,
    next: null,
    previous: null,
    results: [
      {
        id: 'c3d4e5f6-0718-492a-b3c4-d5e6f7081920',
        name: 'Оңтүстік басқармасы',
        parent: null,
        is_active: true,
      },
      {
        id: 'd4e5f607-1849-4a2b-c3d4-e5f607182031',
        name: 'Солтүстік басқармасы',
        parent: null,
        is_active: true,
      },
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
    request_id: 'req-10-7',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  // clearCredential в afterEach, а НЕ в хвосте теста: упавший тест протащил бы
  // credential дальше (finding №3 ревью 10.6).
  clearCredential()
})

function renderPage({
  divisionId = DIVISION_ID,
  businessDate = BUSINESS_DATE,
}: { divisionId?: string; businessDate?: string } = {}) {
  // retry: false НА КЛИЕНТЕ, не на одном хуке: иначе запрос справочника
  // ретраится трижды и тест висит (providers.tsx гасит ретраи только у мутаций).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* useSearchParams без Router-контекста падает на `useContext(...) is
            null` — читалось бы как баг компонента, а не сетапа (Ловушка 14).
            Literal-путь в initialEntries легален: route-канон ARCH-FE-012
            исключает тесты (eslint.config.js:260-261). */}
        <MemoryRouter
          initialEntries={[
            `/print/expense?division_id=${divisionId}&business_date=${businessDate}`,
          ]}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<ExpensePrintPage />, { wrapper: Wrapper })
}

/** Тексты ячеек строки таблицы — точный порядок, без поиска по тексту.
 *  Незаскоупленный findByText('9') упал бы на «found multiple» (Ловушка 9). */
function cellsOf(selector: string): string[][] {
  return Array.from(document.querySelectorAll(selector)).map((row) =>
    Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? ''),
  )
}

describe('ExpensePrintPage: шапка и таблица (AC-3, 4, 5, 6, 7)', () => {
  beforeEach(() => {
    server.use(
      http.get(PERIOD_URL, () => periodResponse()),
      http.get(DIVISIONS_URL, () => divisionsWithoutRequested()),
    )
  })

  it('AC-4: РОВНО 17 заголовков в порядке эталона .docx, лейблы дословно', async () => {
    renderPage()
    await screen.findByRole('table')
    const headers = Array.from(document.querySelectorAll('thead th')).map(
      (th) => th.textContent,
    )
    // Порядок несущий: REPORT_COLUMNS (порядок JSON) начинается с SICK — если
    // бы итерация шла по ключам ответа, шестой колонкой стало бы «На больничном».
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
    expect(headers).toHaveLength(17)
  })

  it('AC-5: числа строки дословно; Прикомандирован — «+N» из row.attached, не из columns', async () => {
    renderPage()
    await screen.findByRole('table')
    const rows = cellsOf('tbody tr')
    expect(rows).toHaveLength(2)
    // Прикомандирован (индекс 12) = +12 из row.attached; в columns этого ключа
    // НЕТ вовсе — чтение из columns дало бы «0».
    expect(rows[0]).toEqual([
      '1',
      'Шығыс басқармасы',
      '140',
      '129',
      '11',
      '71',
      '13',
      '9',
      '5',
      '3',
      '8',
      '6',
      '+12',
      '2',
      '1',
      '4',
      '7',
    ])
    expect(rows[0][12]).toBe('+12')
    expect(rows[0][12]).not.toBe('12')
  })

  it('AC-5: № ПОЗИЦИОННЫЙ (1, 2), в ответе поля номера строки нет вовсе', async () => {
    renderPage()
    await screen.findByRole('table')
    const rows = cellsOf('tbody tr')
    expect(rows.map((cells) => cells[0])).toEqual(['1', '2'])
  })

  it('AC-5: порядок строк — как отдаёт бэк, своей сортировки нет', async () => {
    renderPage()
    await screen.findByRole('table')
    const rows = cellsOf('tbody tr')
    // бэк отдал Шығыс, затем Батыс (sorted по (name, uuid) на его стороне);
    // алфавитная сортировка на клиенте поставила бы Батыс первым
    expect(rows.map((cells) => cells[1])).toEqual([
      'Шығыс басқармасы',
      'Батыс басқармасы',
    ])
  })

  it('AC-5: отсутствующий ключ колонки → 0, не пропуск колонки и не падение', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json({
          pages: [
            {
              business_date: BUSINESS_DATE,
              totals: TOTALS,
              rows: [{ ...ROW_ONE, columns: { IN_SERVICE: 71 } }],
            },
          ],
        }),
      ),
    )
    renderPage()
    await screen.findByRole('table')
    const rows = cellsOf('tbody tr')
    // 17 ячеек на месте: ни одна колонка не исчезла
    expect(rows[0]).toHaveLength(17)
    expect(rows[0][5]).toBe('71')
    expect(rows[0][6]).toBe('0')
  })

  it('AC-6: ИТОГО — пустой «№», лейбл в колонке «Управление», числа из totals', async () => {
    renderPage()
    await screen.findByRole('table')
    const footer = cellsOf('tfoot tr')[0]
    expect(footer[0]).toBe('')
    // «ИТОГО», не «Общее»: контрольная копия зеркалит генератор (_TOTALS_LABEL)
    expect(footer[1]).toBe('ИТОГО')
    expect(footer[2]).toBe('260')
    expect(footer[3]).toBe('231')
    expect(footer[4]).toBe('29')
    expect(footer[12]).toBe('+33')
    // жирность даёт print.css `.print-root tfoot td` — своего класса нет
    expect(document.querySelector('tfoot')).toBeInTheDocument()
  })

  it('AC-6: «Общее» на странице не встречается (лейбл каркаса 8.8 — не контракт расхода)', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByText('Общее')).not.toBeInTheDocument()
  })

  it('AC-7: сходимость видна в САМОМ документе — Σ 11 статусных == По списку', async () => {
    renderPage()
    await screen.findByRole('table')
    // Гвард полноты колонок: молча выброшенная колонка ломает равенство.
    for (const cells of [...cellsOf('tbody tr'), ...cellsOf('tfoot tr')]) {
      const statuses = cells
        .slice(5, 17)
        .filter((_text, index) => index !== 7) // индекс 7 внутри среза = ATTACHED
        .map((text) => Number(text))
      const listTotal = Number(cells[3])
      expect(statuses).toHaveLength(11)
      expect(statuses.reduce((sum, value) => sum + value, 0)).toBe(listTotal)
      // По штату == По списку + Вакансии
      expect(Number(cells[2])).toBe(listTotal + Number(cells[4]))
    }
  })

  it('AC-7: ATTACHED в сумму НЕ входит — прикомандированные вне «По списку»', async () => {
    renderPage()
    await screen.findByRole('table')
    const cells = cellsOf('tbody tr')[0]
    const withAttached = cells
      .slice(5, 17)
      .map((text) => Number(text.replace('+', '')))
      .reduce((sum, value) => sum + value, 0)
    // с ATTACHED равенство ЛОМАЕТСЯ — это и доказывает, что он вне списка
    expect(withAttached).not.toBe(Number(cells[3]))
    expect(withAttached).toBe(Number(cells[3]) + 12)
  })

  it('AC-3: шапка — казахское зеркало .docx, дата ДД.ММ.ГГГГ, ISO не просачивается', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ')
    expect(heading.textContent).toContain('19.07.2026')
    expect(heading.textContent).toContain('ЖЫЛҒЫ')
    expect(heading.textContent).not.toContain('2026-07-19')
  })

  it('AC-3: справочник УСПЕШЕН, но дивизиона в нём нет → фолбэк на сам UUID', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { level: 1 })
    // список загрузился (две записи), просто наш дивизион вне страницы 1 —
    // рендер UUID это КОРРЕКТНОЕ поведение, а не баг (прецедент AC-6 10.5)
    expect(heading.textContent).toContain(DIVISION_ID)
  })

  it('AC-8: classList КАЖДОГО элемента ⊆ /^print-/ — ни одного UI-класса на бумаге', async () => {
    renderPage()
    await screen.findByRole('table')
    const offenders = Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => !/^print-/.test(cls))
    expect(offenders).toEqual([])
  })

  it('AC-8: корень — main.print-root, разметка семантическая, кнопки «Печать» нет', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(document.querySelector('main.print-root')).toBeInTheDocument()
    for (const tag of ['header', 'h1', 'table', 'thead', 'tbody', 'tfoot']) {
      expect(document.querySelector(`.print-root ${tag}`)).toBeInTheDocument()
    }
    expect(document.querySelector('.print-screen-hint')).toBeInTheDocument()
    // Д6 8.8: печать через Ctrl+P — интерактивных элементов на странице нет
    // вовсе. ⚠️ Ассертить отсутствие СЛОВА «Печать» нельзя: экранная подсказка
    // легитимно говорит «Печать — Ctrl+P». Запрещена КНОПКА, не слово.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Печать/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('AC-10: доказанное отсутствие фантомов (негативные ассерты)', () => {
  beforeEach(() => {
    server.use(
      http.get(PERIOD_URL, () => periodResponse()),
      http.get(DIVISIONS_URL, () => divisionsWithoutRequested()),
    )
  })

  it('НЕТ ИИН ни в каком виде: колонки ИИН нет ни в §8, ни в снапшоте', async () => {
    renderPage()
    await screen.findByRole('table')
    // маска каркаса 8.8 была демонстрацией шрифта, а не контрактом расхода
    expect(screen.queryByText(/\*{6}\d{4}/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\*{6}\d{4}/)
    expect(screen.queryByText(/ИИН/)).not.toBeInTheDocument()
  })

  it('НЕТ исх.№ и «взамен исх.№» — Д8 стори 6.5: в тело документа не рендерятся', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(document.body.textContent).not.toMatch(/исх\.?\s*№/i)
    expect(document.body.textContent).not.toMatch(/взамен/i)
  })

  it('НЕТ должности и примечания-поля: во всей цепочке этих полей нет', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByText(/Должность/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Примечание/i)).not.toBeInTheDocument()
  })

  it('НЕТ членов ячеек (ФИО/звание/период) и «… ещё N» — данных нет, преемник 10.7a', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(document.body.textContent).not.toMatch(/… ещё \d+/)
    expect(document.body.textContent).not.toMatch(/\.\.\. ещё \d+/)
    // период внутри клетки: `{ДД.ММ.ГГГГ}–{ДД.ММ.ГГГГ}` эталона
    expect(document.body.textContent).not.toMatch(/\d{2}\.\d{2}\.\d{4}\s*[–-]\s*\d{2}\.\d{2}\.\d{4}/)
    expect(screen.queryByText(/Звание/i)).not.toBeInTheDocument()
  })

  it('НЕТ подписей, грифа и реквизитов — эталон заканчивается строкой ИТОГО', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(document.body.textContent).not.toMatch(/Подпись|подписал|М\.П\./i)
    expect(document.body.textContent).not.toMatch(/Утверждаю|СОГЛАСОВАНО/i)
  })
})

describe('AC-9: состояния — без UI-слоя и без тишины', () => {
  beforeEach(() => {
    server.use(http.get(DIVISIONS_URL, () => divisionsWithoutRequested()))
  })

  it('403 → ФИКС-текст про СКОУП, а не error.message (на проводе message == код)', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(
          errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'),
          { status: 403 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText(PRINT_PERMISSION_MESSAGE)).toBeInTheDocument()
    // голый код наружу не уходит
    expect(screen.queryByText('PERMISSION_DENIED')).not.toBeInTheDocument()
  })

  it('404 → «Подразделение не найдено»', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет такого'), {
          status: 404,
        }),
      ),
    )
    renderPage()
    expect(
      await screen.findByText('Подразделение не найдено.'),
    ).toBeInTheDocument()
  })

  it('422 REPORT_NO_DATA_FOR_DATE → «За эту дату данных ещё нет»', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(
          errorEnvelope('REPORT_NO_DATA_FOR_DATE', 'REPORT_NO_DATA_FOR_DATE'),
          { status: 422 },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText(PRINT_NO_DATA_MESSAGE)).toBeInTheDocument()
  })

  it('400 на ЗАВТРАШНЕЙ дате → error.message из конверта (ветка достижима)', async () => {
    // views.py:334-341 блокирует date_to > Clock.today_local(); печать «на
    // завтра» — легальный продуктовый жест, оператор попадёт сюда буквально
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(
          errorEnvelope('VALIDATION_ERROR', 'Период не может уходить в будущее.'),
          { status: 400 },
        ),
      ),
    )
    renderPage({ businessDate: '2026-07-20' })
    expect(
      await screen.findByText('Период не может уходить в будущее.'),
    ).toBeInTheDocument()
  })

  it('401 → silent: текст мигнул бы поверх редиректа RequireAuth', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(errorEnvelope('AUTH_REQUIRED', 'AUTH_REQUIRED'), {
          status: 401,
        }),
      ),
    )
    renderPage()
    // заголовок документа остаётся, но текста отказа нет вовсе
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => {
      expect(screen.queryByText('Загрузка расхода…')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('AUTH_REQUIRED')).not.toBeInTheDocument()
    expect(document.querySelector('.print-status')).not.toBeInTheDocument()
  })

  it('5xx → ТЕКСТ, а не тишина: у useQuery тоста нет, молчание = пустой лист', async () => {
    server.use(
      http.get(PERIOD_URL, () =>
        HttpResponse.json(
          errorEnvelope('INTERNAL_ERROR', 'Внутренняя ошибка сервера.'),
          { status: 500 },
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText('Внутренняя ошибка сервера.'),
    ).toBeInTheDocument()
  })

  it('сетевой обрыв → текст, не тишина (у NetworkError нет .status)', async () => {
    server.use(http.get(PERIOD_URL, () => HttpResponse.error()))
    renderPage()
    expect(
      await screen.findByText(/Не удалось загрузить расход/),
    ).toBeInTheDocument()
  })

  it('200 с НЕРАЗОБРАННЫМ телом → объяснение, таблицы нет вовсе', async () => {
    server.use(http.get(PERIOD_URL, () => HttpResponse.json({ pages: [] })))
    renderPage()
    expect(await screen.findByText('Данных за эту дату нет.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // это НЕ ошибка: текста отказа быть не должно
    expect(screen.queryByText(PRINT_PERMISSION_MESSAGE)).not.toBeInTheDocument()
  })

  it('упавший справочник: <h1> всё равно отрисован, имя = UUID (вне лестницы данных)', async () => {
    server.use(
      http.get(DIVISIONS_URL, () => HttpResponse.error()),
      http.get(PERIOD_URL, () => periodResponse()),
    )
    renderPage()
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.textContent).toContain(DIVISION_ID)
    expect(heading.textContent).toContain('ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ')
    // таблица при этом строится: справочник — только для имени
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})

describe('AC-2: параметры из query, без выдуманных дефолтов', () => {
  it('без business_date запрос НЕ уходит (enabled-гард) и заголовок НЕ рендерится', async () => {
    let periodCalls = 0
    let divisionsCalls = 0
    server.use(
      http.get(PERIOD_URL, () => {
        periodCalls += 1
        return periodResponse()
      }),
      http.get(DIVISIONS_URL, () => {
        divisionsCalls += 1
        return divisionsWithoutRequested()
      }),
    )
    renderPage({ businessDate: '' })
    expect(
      await screen.findByText(/Не хватает параметров печати/),
    ).toBeInTheDocument()
    // «сегодня» по умолчанию НЕ подставляется — дату всегда даёт вызывающий
    expect(periodCalls).toBe(0)
    // справочник тоже молчит: странице без параметров нечего им обслуживать
    // (ревью 10.7 — гард enabled на divisionsQuery)
    expect(divisionsCalls).toBe(0)
    // испорченный юридический артефакт («{uuid} … ЖЫЛҒЫ» с дырой) не рендерится
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('без division_id запрос НЕ уходит', async () => {
    let periodCalls = 0
    server.use(
      http.get(PERIOD_URL, () => {
        periodCalls += 1
        return periodResponse()
      }),
      http.get(DIVISIONS_URL, () => divisionsWithoutRequested()),
    )
    renderPage({ divisionId: '' })
    await screen.findByText(/Не хватает параметров печати/)
    expect(periodCalls).toBe(0)
  })

  it('битая дата (не ГГГГ-ММ-ДД) запрос НЕ отправляет', async () => {
    let periodCalls = 0
    server.use(
      http.get(PERIOD_URL, () => {
        periodCalls += 1
        return periodResponse()
      }),
      http.get(DIVISIONS_URL, () => divisionsWithoutRequested()),
    )
    renderPage({ businessDate: '19.07.2026' })
    await screen.findByText(/Не хватает параметров печати/)
    expect(periodCalls).toBe(0)
  })

  it('уходит ОДИН запрос со страницей-на-дату: date_from == date_to', async () => {
    const urls: string[] = []
    server.use(
      http.get(PERIOD_URL, ({ request }) => {
        urls.push(request.url)
        return periodResponse()
      }),
      http.get(DIVISIONS_URL, () => divisionsWithoutRequested()),
    )
    renderPage()
    await screen.findByRole('table')
    expect(urls).toHaveLength(1)
    const query = new URL(urls[0]).searchParams
    expect(query.get('division_id')).toBe(DIVISION_ID)
    expect(query.get('date_from')).toBe(BUSINESS_DATE)
    expect(query.get('date_to')).toBe(BUSINESS_DATE)
    // derive_period отдаёт страницу на КАЖДУЮ дату диапазона — многодневный
    // запрос дал бы свод, а печатная форма контрольная = одна дата
    expect(query.get('date_from')).toBe(query.get('date_to'))
  })
})
