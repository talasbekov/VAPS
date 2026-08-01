// Стори 10.7 — чистая модель печатной формы расхода (env node: ни React, ни
// apiClient). Фикстуры КИРИЛЛИЧЕСКИЕ и числа по колонкам РАЗНЫЕ: латиница и
// одинаковые числа дают зелёный тест на сломанном коде (класс «сравнение с
// самим собой», ретро E9).
import { describe, expect, it } from 'vitest'
import {
  ATTACHED_KEY,
  FIXED_HEAD,
  PRINT_COLUMNS,
  PRINT_COLUMN_LABELS,
  PRINT_NO_DATA_MESSAGE,
  PRINT_NOT_FOUND_MESSAGE,
  PRINT_PERMISSION_MESSAGE,
  TOTALS_LABEL,
  describePrintFailure,
  expenseTitle,
  formatDocDate,
  parseExpensePage,
} from './expensePrint'
import {
  ApiError,
  BusinessRuleError,
  NetworkError,
  ServerError,
  ValidationError,
} from '../../shared/api/errors'

function apiError(status: number, errorCode: string | null, message: string) {
  return new ApiError({
    status,
    errorCode,
    message,
    details: {},
    requestId: null,
  })
}

describe('PRINT_COLUMNS: порядок ДОКУМЕНТА, не порядок JSON (AC-0в, AC-4)', () => {
  it('ровно 12 статусных колонок в порядке DOCX_COLUMNS', () => {
    // Дословное зеркало expense_docx.py:32-47. Порядок несущий: REPORT_COLUMNS
    // (порядок derive/JSON) начинается с SICK — если бы итерация шла по ключам
    // ответа, первой колонкой стала бы «На больничном», а не «В строю».
    expect(PRINT_COLUMNS).toEqual([
      'IN_SERVICE',
      'ON_DUTY',
      'AFTER_DUTY',
      'COMMAND',
      'TRAINING',
      'VACATION',
      'SICK',
      'ATTACHED',
      'DETACHED',
      'BEFORE_DUTY',
      'OTHER',
      'PENDING',
    ])
    expect(PRINT_COLUMNS).toHaveLength(12)
  })

  it('ключи PRINT_COLUMN_LABELS совпадают с PRINT_COLUMNS — гвард от рассинхрона', () => {
    expect(Object.keys(PRINT_COLUMN_LABELS).sort()).toEqual(
      [...PRINT_COLUMNS].sort(),
    )
  })

  it('лейблы — дословная копия DOCX_COLUMN_LABELS (expense_docx.py:49-62)', () => {
    expect(PRINT_COLUMN_LABELS.IN_SERVICE).toBe('В строю')
    expect(PRINT_COLUMN_LABELS.TRAINING).toBe('Учёба/соревнования/конференция')
    expect(PRINT_COLUMN_LABELS.ATTACHED).toBe('Прикомандирован')
    expect(PRINT_COLUMN_LABELS.DETACHED).toBe('Откомандирован')
    expect(PRINT_COLUMN_LABELS.PENDING).toBe('Уточняется')
  })

  it('FIXED_HEAD — зеркало _FIXED_HEAD; TOTALS_LABEL — «ИТОГО», не «Общее»', () => {
    expect(FIXED_HEAD).toEqual([
      '№',
      'Управление',
      'По штату',
      'По списку',
      'Вакансии',
    ])
    // Расхождение с DESIGN.md:145,310 («Общее») осознанное: контрольная копия
    // обязана совпадать с генератором (_TOTALS_LABEL). Открытый вопрос №1.
    expect(TOTALS_LABEL).toBe('ИТОГО')
  })

  it('ATTACHED_KEY — единственный ключ, читаемый НЕ из columns (AC-0г)', () => {
    expect(ATTACHED_KEY).toBe('ATTACHED')
    expect(PRINT_COLUMNS).toContain(ATTACHED_KEY)
  })
})

describe('formatDocDate: ДД.ММ.ГГГГ строковой перестановкой (AC-3)', () => {
  it('ISO → ДД.ММ.ГГГГ', () => {
    expect(formatDocDate('2026-07-19')).toBe('19.07.2026')
  })

  it('дата, на которой new Date()-путь уехал бы на сутки в минусовой зоне', () => {
    // new Date('2026-01-01') = UTC-полночь; в UTC-5 getDate() вернул бы 31.12.
    expect(formatDocDate('2026-01-01')).toBe('01.01.2026')
    expect(formatDocDate('2026-03-01')).toBe('01.03.2026')
  })

  it('мусор не выдумывается: невалидный вход возвращается дословно', () => {
    expect(formatDocDate('19.07.2026')).toBe('19.07.2026')
    expect(formatDocDate('')).toBe('')
  })
})

describe('expenseTitle: казахская шапка дословно (AC-3)', () => {
  it('{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {ДД.ММ.ГГГГ} ЖЫЛҒЫ', () => {
    expect(
      expenseTitle({
        divisionName: 'Ақмола облысы бойынша Департамент',
        businessDate: '2026-07-19',
      }),
    ).toBe(
      'Ақмола облысы бойынша Департамент ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 19.07.2026 ЖЫЛҒЫ',
    )
  })

  it('дата в шапке — ДД.ММ.ГГГГ, ISO в заголовок не попадает', () => {
    const title = expenseTitle({
      divisionName: 'Батыс басқармасы',
      businessDate: '2026-12-05',
    })
    expect(title).toContain('05.12.2026')
    expect(title).not.toContain('2026-12-05')
  })
})

describe('parseExpensePage: тотальный рантайм-разбор (AC-9)', () => {
  const page = {
    business_date: '2026-07-19',
    totals: {
      staff_total: 140,
      list_total: 118,
      vacancies: 22,
      attached: 4,
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
        OTHER: 0,
        PENDING: 0,
      },
    },
    rows: [
      {
        division_id: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
        name: 'Шығыс басқармасы',
        staff_total: 140,
        list_total: 118,
        vacancies: 22,
        attached: 4,
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
          OTHER: 0,
          PENDING: 0,
        },
      },
    ],
  }

  it('валидный ответ → первая страница разобрана дословно', () => {
    const parsed = parseExpensePage({ pages: [page] })
    expect(parsed).not.toBeNull()
    expect(parsed?.rows).toHaveLength(1)
    expect(parsed?.rows[0].name).toBe('Шығыс басқармасы')
    expect(parsed?.rows[0].columns.IN_SERVICE).toBe(71)
    expect(parsed?.rows[0].attached).toBe(4)
    expect(parsed?.totals.list_total).toBe(118)
  })

  it('берётся ПЕРВАЯ страница: запрос всегда однодневный (date_from == date_to)', () => {
    const second = { ...page, business_date: '2026-07-20' }
    expect(parseExpensePage({ pages: [page, second] })?.business_date).toBe(
      '2026-07-19',
    )
  })

  it.each([
    ['не объект', 'строка'],
    ['null', null],
    ['массив на верхнем уровне', []],
    ['pages отсутствует', {}],
    ['pages — объект, не массив', { pages: {} }],
    ['pages пустой', { pages: [] }],
    ['страница не объект', { pages: ['строка'] }],
  ])('%s → null (не ошибка и не пустая таблица)', (_label, raw) => {
    expect(parseExpensePage(raw)).toBeNull()
  })

  it('rows не массив → пустой список строк, без падения', () => {
    const parsed = parseExpensePage({ pages: [{ ...page, rows: 'нет' }] })
    expect(parsed?.rows).toEqual([])
  })

  it('нечисловые значения → 0, строка не выбрасывается', () => {
    const parsed = parseExpensePage({
      pages: [
        {
          ...page,
          rows: [
            {
              ...page.rows[0],
              staff_total: 'сто',
              attached: null,
              columns: { IN_SERVICE: '71', ON_DUTY: 13 },
            },
          ],
        },
      ],
    })
    expect(parsed?.rows[0].staff_total).toBe(0)
    expect(parsed?.rows[0].attached).toBe(0)
    // не-число выброшено, число сохранено — отсутствующий ключ читается как 0
    expect(parsed?.rows[0].columns.IN_SERVICE).toBeUndefined()
    expect(parsed?.rows[0].columns.ON_DUTY).toBe(13)
  })

  it('totals отсутствует → нули, страница остаётся печатаемой', () => {
    const parsed = parseExpensePage({ pages: [{ rows: [], business_date: '2026-07-19' }] })
    expect(parsed?.totals.staff_total).toBe(0)
    expect(parsed?.totals.columns).toEqual({})
  })

  it('строка-не-объект отбрасывается, соседние выживают', () => {
    const parsed = parseExpensePage({
      pages: [{ ...page, rows: ['мусор', page.rows[0]] }],
    })
    expect(parsed?.rows).toHaveLength(1)
    expect(parsed?.rows[0].name).toBe('Шығыс басқармасы')
  })
})

describe('describePrintFailure: тотальная карта отказов (AC-9)', () => {
  it('network ПЕРВЫМ: у NetworkError нет .status — ветка обязана идти до status', () => {
    const described = describePrintFailure(
      new NetworkError('Сетевой сбой: GET /api/operations/expense-reports/period/'),
    )
    // у useQuery тоста нет — молчание дало бы пустой экран без единого слова
    expect(described.kind).toBe('other')
    expect(described.message).not.toBe('')
  })

  it('401 → silent: handle401 уже уводит на /login, текст мигнул бы поверх редиректа', () => {
    expect(describePrintFailure(apiError(401, null, 'нет входа'))).toEqual({
      kind: 'silent',
      message: '',
    })
  })

  it('403 → ФИКС-текст про СКОУП, НЕ error.message (на проводе message == код)', () => {
    // Как на проводе: scope_gate.py:41-43 поднимает DomainError без kwarg
    // message ⇒ errors.ts:132 кладёт в message сам код.
    const described = describePrintFailure(
      apiError(403, 'PERMISSION_DENIED', 'PERMISSION_DENIED'),
    )
    expect(described.kind).toBe('permission')
    expect(described.message).toBe(PRINT_PERMISSION_MESSAGE)
    expect(described.message).not.toBe('PERMISSION_DENIED')
    // текст про ПРАВО был бы ложью: роут уже за RequirePermission
    expect(described.message).toContain('зоны ответственности')
  })

  it('404 → «Подразделение не найдено»', () => {
    const described = describePrintFailure(apiError(404, null, 'HTTP 404'))
    expect(described.kind).toBe('not-found')
    expect(described.message).toBe(PRINT_NOT_FOUND_MESSAGE)
  })

  it('422 REPORT_NO_DATA_FOR_DATE → «За эту дату данных ещё нет»', () => {
    const described = describePrintFailure(
      new BusinessRuleError({
        status: 422,
        errorCode: 'REPORT_NO_DATA_FOR_DATE',
        message: 'REPORT_NO_DATA_FOR_DATE',
        details: {},
        requestId: null,
      }),
    )
    expect(described.kind).toBe('no-data')
    expect(described.message).toBe(PRINT_NO_DATA_MESSAGE)
  })

  it('400 VALIDATION_ERROR → error.message (ветка ДОСТИЖИМА печатью на завтра)', () => {
    // views.py:334-341 блокирует date_to > Clock.today_local()
    const described = describePrintFailure(
      new ValidationError({
        status: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'Период не может уходить в будущее.',
        details: {},
        requestId: null,
      }),
    )
    expect(described.kind).toBe('validation')
    expect(described.message).toBe('Период не может уходить в будущее.')
  })

  it('5xx → ТЕКСТ, а не silent — осознанное отступление от describeIssueFailure', () => {
    // У образцов молчание оправдано тостом useApiMutation; у useQuery тоста нет.
    const described = describePrintFailure(
      new ServerError({
        status: 500,
        errorCode: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера.',
        details: {},
        requestId: null,
      }),
    )
    expect(described.kind).toBe('other')
    expect(described.message).toBe('Внутренняя ошибка сервера.')
    expect(described.message).not.toBe('')
  })

  it('errorCode === null (405/406/415/429 идут без конверта §36) → catch-all с текстом', () => {
    const described = describePrintFailure(apiError(429, null, 'HTTP 429 Too Many Requests'))
    expect(described.kind).toBe('other')
    expect(described.message).toBe('HTTP 429 Too Many Requests')
  })

  it('422 с ЧУЖИМ кодом не притворяется «нет данных» — падает в catch-all', () => {
    const described = describePrintFailure(
      new BusinessRuleError({
        status: 422,
        errorCode: 'DATE_BEFORE_DATA_START',
        message: 'Дата раньше начала данных.',
        details: {},
        requestId: null,
      }),
    )
    expect(described.kind).toBe('other')
    expect(described.message).toBe('Дата раньше начала данных.')
  })
})
