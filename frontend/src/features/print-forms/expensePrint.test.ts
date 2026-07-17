// Story 10.7 — юнит-тесты чистого парсера печатной формы расхода (AC-1, AC-5).
// Фикстуры повторяют фактическую форму _serialize_report
// (expense_read_service.py:77-101), НЕ error-codes.yaml/макеты. Тоталы фикстуры
// НАМЕРЕННО ≠ Σ строк — различающий ассерт «ИТОГО литерально из totals»
// (красная проба (д): мутация рендера/парсера на Σ строк обязана краснеть).
import { describe, expect, it } from 'vitest'
import { printExpenseUrl, ROUTES } from '../../shared/routes'
import {
  DOCX_COLUMNS,
  DOCX_COLUMN_LABELS,
  FIXED_HEAD,
  TOTALS_LABEL,
  buildExpensePrintModel,
  formatPrintDate,
  isIsoDate,
  isUuid,
} from './expensePrint'

const ROOT_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const CHILD_ID = '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f'

// 11 ключей REPORT_COLUMNS (strength_report.py:65-77) — ATTACHED отдельным
// полем attached, в columns его НЕТ (канон derive).
function columnsFixture(overrides: Record<string, unknown> = {}) {
  return {
    SICK: 1,
    VACATION: 2,
    COMMAND: 0,
    TRAINING: 0,
    OTHER: 0,
    DETACHED: 0,
    AFTER_DUTY: 0,
    BEFORE_DUTY: 0,
    ON_DUTY: 3,
    PENDING: 0,
    IN_SERVICE: 4,
    ...overrides,
  }
}

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    division_id: ROOT_ID,
    name: 'Управление А',
    staff_total: 12,
    list_total: 10,
    vacancies: 2,
    attached: 1,
    columns: columnsFixture(),
    ...overrides,
  }
}

// totals НАМЕРЕННО НЕ сумма строк (staff_total 99 ≠ 12+7 и т.д.) — фронт
// обязан отдавать их passthrough, НЕ пересчитывать (урок ретро E5 №2).
function pageFixture(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-07-15',
    totals: {
      staff_total: 99,
      list_total: 88,
      vacancies: 77,
      attached: 66,
      columns: columnsFixture({ IN_SERVICE: 55 }),
    },
    rows: [
      rowFixture(),
      rowFixture({ division_id: CHILD_ID, name: 'Отдел Б', attached: 0 }),
    ],
    ...overrides,
  }
}

function responseFixture(page: Record<string, unknown> = pageFixture()) {
  return { pages: [page] }
}

describe('канон колонок (осознанный литеральный дубль expense_docx.py:32-62)', () => {
  it('DOCX_COLUMNS — 12 ключей в каноническом порядке', () => {
    expect(DOCX_COLUMNS).toEqual([
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
  })

  it('DOCX_COLUMN_LABELS — русские лейблы канона на каждый ключ', () => {
    expect(DOCX_COLUMN_LABELS).toEqual({
      IN_SERVICE: 'В строю',
      ON_DUTY: 'На дежурстве',
      AFTER_DUTY: 'После дежурства',
      COMMAND: 'В командировке',
      TRAINING: 'Учёба/соревнования/конференция',
      VACATION: 'В отпуске',
      SICK: 'На больничном',
      ATTACHED: 'Прикомандирован',
      DETACHED: 'Откомандирован',
      BEFORE_DUTY: 'Перед дежурством',
      OTHER: 'Иное',
      PENDING: 'Уточняется',
    })
  })

  it('FIXED_HEAD и TOTALS_LABEL — зеркало _FIXED_HEAD/_TOTALS_LABEL', () => {
    expect(FIXED_HEAD).toEqual([
      '№',
      'Управление',
      'По штату',
      'По списку',
      'Вакансии',
    ])
    expect(TOTALS_LABEL).toBe('ИТОГО')
  })
})

describe('formatPrintDate (зеркало _DATE_FORMAT %d.%m.%Y)', () => {
  it('ISO → ДД.ММ.ГГГГ', () => {
    expect(formatPrintDate('2026-07-15')).toBe('15.07.2026')
    expect(formatPrintDate('2026-01-02')).toBe('02.01.2026')
  })
})

describe('валидаторы query-параметров', () => {
  it('isUuid: канонический uuid валиден, мусор — нет', () => {
    expect(isUuid(ROOT_ID)).toBe(true)
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(`${ROOT_ID}x`)).toBe(false)
  })

  it('isIsoDate: YYYY-MM-DD валидна, мусор/пусто — нет', () => {
    expect(isIsoDate('2026-07-15')).toBe(true)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate('15.07.2026')).toBe(false)
    expect(isIsoDate('2026-7-15')).toBe(false)
  })

  it('isIsoDate: календарно невозможная дата — нет (ревью ECH#3: «99.13.2026» в заголовке)', () => {
    expect(isIsoDate('2026-13-99')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-00-01')).toBe(false)
  })
})

describe('printExpenseUrl (shared/routes, ARCH-FE-012)', () => {
  it('строит /print/expense с query через URLSearchParams', () => {
    expect(printExpenseUrl(ROOT_ID, '2026-07-15')).toBe(
      `${ROUTES.printExpense}?division_id=${ROOT_ID}&date=2026-07-15`,
    )
  })

  it('кодирует спецсимволы query (мусор не ломает URL)', () => {
    expect(printExpenseUrl('a&b', 'c d')).toBe(
      `${ROUTES.printExpense}?division_id=a%26b&date=c+d`,
    )
  })
})

describe('buildExpensePrintModel: валидная страница (AC-1)', () => {
  it('заголовок по контракту секции 77 с именем строки корня и датой ДД.ММ.ГГГГ', () => {
    const parsed = buildExpensePrintModel(responseFixture(), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    expect(parsed.model.title).toBe(
      'Управление А ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ',
    )
    expect(parsed.model.divisionNameMissing).toBe(false)
  })

  it('строки — в порядке ответа, ячейки в порядке DOCX_COLUMNS, ATTACHED — «+N»', () => {
    const parsed = buildExpensePrintModel(responseFixture(), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    expect(parsed.model.rows.map((r) => r.name)).toEqual([
      'Управление А',
      'Отдел Б',
    ])
    const first = parsed.model.rows[0]
    expect(first.staffTotal).toBe(12)
    expect(first.listTotal).toBe(10)
    expect(first.vacancies).toBe(2)
    // порядок DOCX_COLUMNS: IN_SERVICE, ON_DUTY, …, ATTACHED (8-я) — «+1»
    expect(first.cells).toEqual([
      '4', // IN_SERVICE
      '3', // ON_DUTY
      '0', // AFTER_DUTY
      '0', // COMMAND
      '0', // TRAINING
      '2', // VACATION
      '1', // SICK
      '+1', // ATTACHED — «+N»
      '0', // DETACHED
      '0', // BEFORE_DUTY
      '0', // OTHER
      '0', // PENDING
    ])
  })

  it('ИТОГО — литерально из totals ответа, НЕ Σ строк (различающая фикстура)', () => {
    const parsed = buildExpensePrintModel(responseFixture(), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    const totals = parsed.model.totals
    // фикстура: 99/88/77 намеренно ≠ суммам строк (24/20/4)
    expect(totals.staffTotal).toBe(99)
    expect(totals.listTotal).toBe(88)
    expect(totals.vacancies).toBe(77)
    expect(totals.cells[DOCX_COLUMNS.indexOf('ATTACHED')]).toBe('+66')
    expect(totals.cells[DOCX_COLUMNS.indexOf('IN_SERVICE')]).toBe('55')
  })

  it('корень отсутствует в rows → fallback на имя первой строки', () => {
    const page = pageFixture({
      rows: [rowFixture({ division_id: CHILD_ID, name: 'Отдел Б' })],
    })
    const parsed = buildExpensePrintModel(responseFixture(page), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    expect(parsed.model.title).toContain('Отдел Б ЖЕКЕ ҚҰРАМЫНЫҢ')
    expect(parsed.model.divisionNameMissing).toBe(false)
  })

  it('rows пусты → заголовок БЕЗ имени (не выдумывать) + флаг для экранной пометки', () => {
    const page = pageFixture({ rows: [] })
    const parsed = buildExpensePrintModel(responseFixture(page), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    expect(parsed.model.title).toBe(
      'ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ',
    )
    expect(parsed.model.divisionNameMissing).toBe(true)
    expect(parsed.model.rows).toEqual([])
  })

  it('корень с name:"" (штатный names.get(id,"") бэка) → заголовок без имени + флаг (ревью ECH#5)', () => {
    const page = pageFixture({ rows: [rowFixture({ name: '' })] })
    const parsed = buildExpensePrintModel(responseFixture(page), ROOT_ID)
    if (parsed.kind !== 'ok') throw new Error(`ожидался ok: ${parsed.reason}`)
    expect(parsed.model.title).toBe(
      'ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ',
    )
    expect(parsed.model.divisionNameMissing).toBe(true)
    expect(parsed.model.rows).toHaveLength(1)
  })

  it('requestedDate совпадает с business_date → ok (сверка ECH#7 не ложносрабатывает)', () => {
    const parsed = buildExpensePrintModel(
      responseFixture(),
      ROOT_ID,
      '2026-07-15',
    )
    expect(parsed.kind).toBe('ok')
  })
})

describe('buildExpensePrintModel: STOP на дрейфе shape (AC-5, молчаливый мусор запрещён)', () => {
  it('не-объект / без pages / pages не массив → contract-error', () => {
    for (const bad of [null, 42, {}, { pages: 'x' }]) {
      expect(buildExpensePrintModel(bad, ROOT_ID).kind).toBe('contract-error')
    }
  })

  it('single-date запрос обязан дать РОВНО одну страницу', () => {
    expect(buildExpensePrintModel({ pages: [] }, ROOT_ID).kind).toBe(
      'contract-error',
    )
    expect(
      buildExpensePrintModel({ pages: [pageFixture(), pageFixture()] }, ROOT_ID)
        .kind,
    ).toBe('contract-error')
  })

  it('отсутствующий ключ канона в columns строки → contract-error, НЕ ноль', () => {
    const columns = columnsFixture()
    delete (columns as Record<string, unknown>).ON_DUTY
    const page = pageFixture({ rows: [rowFixture({ columns })] })
    expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
      'contract-error',
    )
  })

  it('нечисловое значение ключа канона в columns → contract-error', () => {
    const page = pageFixture({
      rows: [rowFixture({ columns: columnsFixture({ SICK: 'x' }) })],
    })
    expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
      'contract-error',
    )
  })

  it('ЛИШНИЙ ключ в columns (новая колонка бэка вне канона) → contract-error, НЕ частичная таблица (ревью ECH#1)', () => {
    const page = pageFixture({
      rows: [rowFixture({ columns: columnsFixture({ NEW_STATUS: 1 }) })],
    })
    expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
      'contract-error',
    )
    const totalsPage = pageFixture({
      totals: {
        staff_total: 1,
        list_total: 1,
        vacancies: 0,
        attached: 0,
        columns: columnsFixture({ NEW_STATUS: 1 }),
      },
    })
    expect(
      buildExpensePrintModel(responseFixture(totalsPage), ROOT_ID).kind,
    ).toBe('contract-error')
  })

  it('отрицательное/дробное значение — дрейф, НЕ число документа (ревью BH#2/ECH#2: «+-1», «2.5»)', () => {
    for (const rows of [
      [rowFixture({ attached: -1 })],
      [rowFixture({ columns: columnsFixture({ SICK: 2.5 }) })],
      [rowFixture({ staff_total: -3 })],
    ]) {
      const page = pageFixture({ rows })
      expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
        'contract-error',
      )
    }
  })

  it('дубликат division_id в rows → contract-error (ревью BH#6/ECH#8: React-key)', () => {
    const page = pageFixture({ rows: [rowFixture(), rowFixture()] })
    expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
      'contract-error',
    )
  })

  it('business_date ≠ запрошенной дате → contract-error (ревью ECH#7: страница за другую дату)', () => {
    const parsed = buildExpensePrintModel(
      responseFixture(),
      ROOT_ID,
      '2026-07-14',
    )
    expect(parsed.kind).toBe('contract-error')
  })

  it('битые rows (не массив/не объект/нечисловые поля) → contract-error', () => {
    for (const rows of [
      'x',
      [null],
      [rowFixture({ staff_total: 'x' })],
      [rowFixture({ attached: null })],
      [rowFixture({ name: 7 })],
    ]) {
      const page = pageFixture({ rows })
      expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
        'contract-error',
      )
    }
  })

  it('битые totals (нет columns/нечисловой итог/нет ключа канона) → contract-error', () => {
    for (const totals of [
      null,
      { staff_total: 1 },
      {
        staff_total: 'x',
        list_total: 0,
        vacancies: 0,
        attached: 0,
        columns: columnsFixture(),
      },
      {
        staff_total: 0,
        list_total: 0,
        vacancies: 0,
        attached: 0,
        columns: columnsFixture({ PENDING: undefined }),
      },
    ]) {
      const page = pageFixture({ totals })
      expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
        'contract-error',
      )
    }
  })

  it('битая business_date → contract-error (дата документа не выдумывается)', () => {
    for (const businessDate of ['вчера', '2026-13-99']) {
      const page = pageFixture({ business_date: businessDate })
      expect(buildExpensePrintModel(responseFixture(page), ROOT_ID).kind).toBe(
        'contract-error',
      )
    }
  })
})
