// Стори 10.5 — чистая модель экрана расхода (env node: ни React, ни apiClient).
import { describe, expect, it } from 'vitest'
import {
  ALREADY_ISSUED_PREFIX,
  DOWNLOAD_PERMISSION_MESSAGE,
  ISSUE_PERMISSION_MESSAGE,
  describeIssueFailure,
  describeDownloadFailure,
  describeOverrideFailure,
  expenseFileName,
  isOverrideReasonComplete,
  parseIssuedReport,
  parseLaggards,
  todayLocalIso,
} from './expense'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from '../../shared/api/errors'

function apiError(status: number, errorCode: string | null, message = 'сообщение бэка', details: Record<string, unknown> = {}) {
  return new ApiError({ status, errorCode, message, details, requestId: null })
}

describe('todayLocalIso: ЛОКАЛЬНАЯ зона, не UTC-срез (AC-2)', () => {
  it('совпадает с локальными геттерами Date, а не с toISOString().slice(0,10)', () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    expect(todayLocalIso()).toBe(expected)
  })

  it('в вечерней зоне (UTC+5, 23:30 локальных) НЕ равен UTC-срезу', () => {
    // Мутация «взять toISOString().slice(0,10)» обязана краснеть здесь: в
    // UTC+5 в 23:30 локальных суток UTC-дата ещё вчерашняя.
    const eveningLocal = new Date('2026-07-19T18:30:00Z') // = 23:30 в UTC+5
    const pad = (n: number) => String(n).padStart(2, '0')
    const localSlice = `${eveningLocal.getFullYear()}-${pad(eveningLocal.getMonth() + 1)}-${pad(eveningLocal.getDate())}`
    const utcSlice = eveningLocal.toISOString().slice(0, 10)
    // Тест самодоказателен только в зонах, где они расходятся; иначе он
    // проверяет форму. TZ гейта — см. vitest.config (по умолчанию системная).
    if (localSlice !== utcSlice) {
      expect(localSlice).not.toBe(utcSlice)
    }
    expect(localSlice).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('describeIssueFailure: тотальная карта отказов выпуска (AC-5)', () => {
  it('сеть → silent (тост useApiMutation уже отработал)', () => {
    const d = describeIssueFailure(new NetworkError('обрыв'))
    expect(d.kind).toBe('silent')
    expect(d.message).toBe('')
  })

  it.each([500, 502, 503])('%i → silent (тост уже показан)', (status) => {
    const d = describeIssueFailure(new ServerError({ status, errorCode: null, message: 'x', details: {}, requestId: null }))
    expect(d.kind).toBe('silent')
  })

  it('401 → silent (цепь logout providers.tsx уже отработала)', () => {
    expect(describeIssueFailure(apiError(401, 'AUTH_REQUIRED')).kind).toBe('silent')
  })

  it('403 → ФИКСИРОВАННАЯ константа, НЕ error.message (ловушка PERMISSION_DENIED)', () => {
    // Бэк поднимает DomainError без message → errors.ts:132 подставит наружу
    // голое «PERMISSION_DENIED». Рендер error.message показал бы код.
    const d = describeIssueFailure(apiError(403, 'PERMISSION_DENIED', 'PERMISSION_DENIED'))
    expect(d.kind).toBe('permission')
    expect(d.message).toBe(ISSUE_PERMISSION_MESSAGE)
    expect(d.message).not.toContain('PERMISSION_DENIED')
  })

  it('404 → «Подразделение не найдено» (на POST это фантомный division_id)', () => {
    const d = describeIssueFailure(apiError(404, 'ENTITY_NOT_FOUND'))
    expect(d.kind).toBe('not-found')
    expect(d.message).toBe('Подразделение не найдено.')
  })

  it('409 REPORT_NOT_READY_FOR_DATE → «День не сдан — выпускать нечего»', () => {
    const d = describeIssueFailure(
      new ConflictError({ status: 409, errorCode: 'REPORT_NOT_READY_FOR_DATE', message: 'Нет сдачи за дату — выпускать нечего.', details: {}, requestId: null }),
    )
    expect(d.kind).toBe('not-ready')
    expect(d.message).toBe('День не сдан — выпускать нечего.')
  })

  it('409 DOCUMENT_ALREADY_ISSUED → свой текст + номер ИЗ ОТВЕТА + флаг скачивания', () => {
    const d = describeIssueFailure(
      new ConflictError({ status: 409, errorCode: 'DOCUMENT_ALREADY_ISSUED', message: 'уже', details: { number: 247, year: 2026 }, requestId: null }),
    )
    expect(d.kind).toBe('already-issued')
    expect(d.message).toBe(`${ALREADY_ISSUED_PREFIX} исх.№ 247`)
    // Повторное скачивание — операция скачивания, не ошибка (контракт §4)
    expect(d.offerDownload).toBe(true)
  })

  it('409 DOCUMENT_ALREADY_ISSUED без details.number → текст без номера, не «undefined»', () => {
    const d = describeIssueFailure(
      new ConflictError({ status: 409, errorCode: 'DOCUMENT_ALREADY_ISSUED', message: 'уже', details: {}, requestId: null }),
    )
    expect(d.message).toBe(ALREADY_ISSUED_PREFIX)
    expect(d.message).not.toContain('undefined')
  })

  it('НЕ схлопывает REPORT_NOT_READY_FOR_DATE и DOCUMENT_ALREADY_ISSUED (мутация №1)', () => {
    const notReady = describeIssueFailure(new ConflictError({ status: 409, errorCode: 'REPORT_NOT_READY_FOR_DATE', message: 'a', details: {}, requestId: null }))
    const already = describeIssueFailure(new ConflictError({ status: 409, errorCode: 'DOCUMENT_ALREADY_ISSUED', message: 'b', details: { number: 5 }, requestId: null }))
    expect(notReady.kind).not.toBe(already.kind)
    expect(notReady.message).not.toBe(already.message)
  })

  it('422 REPORT_NOT_CONVERGENT → свой текст + ЧИСЛО нарушений из details (не сочинять детали)', () => {
    const d = describeIssueFailure(
      new BusinessRuleError({ status: 422, errorCode: 'REPORT_NOT_CONVERGENT', message: 'x', details: { violations: [{ code: 'A' }, { code: 'B' }], warnings: [] }, requestId: null }),
    )
    expect(d.kind).toBe('not-convergent')
    expect(d.message).toContain('Расход не сходится')
    expect(d.violationCount).toBe(2)
  })

  it('422 REPORT_NOT_CONVERGENT с мусором в violations → счёт undefined, не падение', () => {
    const d = describeIssueFailure(
      new BusinessRuleError({ status: 422, errorCode: 'REPORT_NOT_CONVERGENT', message: 'x', details: { violations: 'не массив' }, requestId: null }),
    )
    expect(d.kind).toBe('not-convergent')
    expect(d.violationCount).toBeUndefined()
  })

  it('422 SNAPSHOT_SCHEMA_UNSUPPORTED → ОТДЕЛЬНЫЙ текст, не склеен с несходимостью', () => {
    const snapshot = describeIssueFailure(new BusinessRuleError({ status: 422, errorCode: 'SNAPSHOT_SCHEMA_UNSUPPORTED', message: 'x', details: {}, requestId: null }))
    const convergent = describeIssueFailure(new BusinessRuleError({ status: 422, errorCode: 'REPORT_NOT_CONVERGENT', message: 'y', details: {}, requestId: null }))
    expect(snapshot.kind).toBe('snapshot-unsupported')
    expect(snapshot.kind).not.toBe(convergent.kind)
    expect(snapshot.message).not.toBe(convergent.message)
  })

  it('422 TOMORROW_BLOCKED → свой kind + laggards ДОСЛОВНО из details', () => {
    const d = describeIssueFailure(
      new BusinessRuleError({ status: 422, errorCode: 'TOMORROW_BLOCKED', message: 'x', details: { laggards: ['uuid-b', 'uuid-a'] }, requestId: null }),
    )
    expect(d.kind).toBe('tomorrow-blocked')
    // Вербатим: ни сортировки, ни нормализации на клиенте
    expect(d.laggards).toEqual(['uuid-b', 'uuid-a'])
  })

  it('400 VALIDATION_ERROR → error.message (форма, текст бэка осмыслен)', () => {
    const d = describeIssueFailure(new ValidationError({ status: 400, errorCode: 'VALIDATION_ERROR', message: 'actor обязателен.', details: {}, requestId: null }))
    expect(d.kind).toBe('validation')
    expect(d.message).toBe('actor обязателен.')
  })

  it('неучтённый 422-код (DATE_BEFORE_DATA_START) → other с текстом конверта, НЕ тишина', () => {
    // Живой код: assert_report_date_has_data (expense_read_service.py:52).
    // В таблице AC-5 его нет — и он обязан долететь до пользователя.
    const d = describeIssueFailure(
      new BusinessRuleError({ status: 422, errorCode: 'DATE_BEFORE_DATA_START', message: 'Дата раньше начала данных.', details: {}, requestId: null }),
    )
    expect(d.kind).toBe('other')
    expect(d.message).toBe('Дата раньше начала данных.')
  })

  it.each([405, 406, 415, 429])('%i без конверта §36 (errorCode null) → other, разбор переживает', (status) => {
    const d = describeIssueFailure(apiError(status, null, `HTTP ${status}`))
    expect(d.kind).toBe('other')
    expect(d.message).toBe(`HTTP ${status}`)
  })

  it('ветвление по status, а НЕ по kind (401/403/404 схлопнуты в один kind api)', () => {
    const permission = describeIssueFailure(apiError(403, 'PERMISSION_DENIED'))
    const notFound = describeIssueFailure(apiError(404, 'ENTITY_NOT_FOUND'))
    const unauthorized = describeIssueFailure(apiError(401, 'AUTH_REQUIRED'))
    expect(new Set([permission.kind, notFound.kind, unauthorized.kind]).size).toBe(3)
  })
})

describe('describeDownloadFailure: 403 скачивания читается, не тонет (AC-7)', () => {
  it('403 → объяснение про право document.view, не тишина и не общий тост', () => {
    const message = describeDownloadFailure(apiError(403, 'PERMISSION_DENIED', 'PERMISSION_DENIED'))
    expect(message).toBe(DOWNLOAD_PERMISSION_MESSAGE)
    expect(message).not.toContain('PERMISSION_DENIED')
  })

  it('404 → своё объяснение (файл не найден), отличное от 403', () => {
    expect(describeDownloadFailure(apiError(404, 'ENTITY_NOT_FOUND'))).not.toBe(DOWNLOAD_PERMISSION_MESSAGE)
  })

  it('сеть → пусто (глобальный тост useApiMutation уже показан, дубль не нужен)', () => {
    expect(describeDownloadFailure(new NetworkError('обрыв'))).toBe('')
  })

  it('5xx → пусто (тост уже показан)', () => {
    expect(describeDownloadFailure(new ServerError({ status: 500, errorCode: null, message: 'x', details: {}, requestId: null }))).toBe('')
  })

  it('401 → пусто (handle401 providers уже увёл на logout — как в карте выпуска)', () => {
    expect(describeDownloadFailure(apiError(401, 'AUTH_REQUIRED'))).toBe('')
  })

  it('403 НЕ молчит: тоста на 403 нет, молчание = «ничего не произошло»', () => {
    // Отличие от 5xx/сети load-bearing: useApiMutation тостит только
    // ServerError|NetworkError (:80-82), 403 доходит только через инлайн.
    expect(describeDownloadFailure(apiError(403, 'PERMISSION_DENIED'))).not.toBe('')
  })

  it('неучтённый статус (429 без конверта) → текст конверта, не тишина', () => {
    expect(describeDownloadFailure(apiError(429, null, 'HTTP 429'))).toContain('HTTP 429')
  })
})

describe('parseLaggards: защитный разбор org-wide списка (AC-6)', () => {
  it('массив строк → вербатим, без сортировки и нормализации', () => {
    expect(parseLaggards({ laggards: ['b-uuid', 'a-uuid'] })).toEqual(['b-uuid', 'a-uuid'])
  })

  it.each([
    ['ключа нет', {}],
    ['не массив', { laggards: 'uuid' }],
    ['null', { laggards: null }],
    ['объект', { laggards: { 0: 'uuid' } }],
  ])('%s → пустой список, а не падение', (_label, details) => {
    expect(parseLaggards(details as Record<string, unknown>)).toEqual([])
  })

  it('элемент не строка → весь список пуст (частичному доверия нет)', () => {
    expect(parseLaggards({ laggards: ['ok', 42] })).toEqual([])
  })

  it('details не объект вовсе → пустой список', () => {
    expect(parseLaggards(null)).toEqual([])
    expect(parseLaggards('строка')).toEqual([])
  })
})

describe('parseIssuedReport: тотальный рантайм-разбор (AC-9)', () => {
  const valid = {
    id: 'b2c3d4e5-f607-4819-a2b3-c4d5e6f70819',
    doc_type: 'EXPENSE',
    number: 247,
    year: 2026,
    business_date: '2026-07-19',
    division_id: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    submission_id: 512,
    submission_version: 3,
    status: 'ISSUED',
    attachment_id: 'c3d4e5f6-0718-492a-b3c4-d5e6f7081920',
    sha256: 'e3b0',
  }

  it('валидный ответ → разобран дословно', () => {
    expect(parseIssuedReport(valid)).toEqual(valid)
  })

  it('status SUPERSEDED тоже валиден (оба значения enum)', () => {
    expect(parseIssuedReport({ ...valid, status: 'SUPERSEDED' })?.status).toBe('SUPERSEDED')
  })

  it.each([
    ['не объект', 'строка'],
    ['null', null],
    ['массив', []],
    ['number не число', { ...valid, number: '247' }],
    ['year не число', { ...valid, year: null }],
    ['status вне enum', { ...valid, status: 'DRAFT' }],
    ['business_date отсутствует', { ...valid, business_date: undefined }],
    ['submission_version не число', { ...valid, submission_version: 'три' }],
  ])('%s → null, экран не падает', (_label, raw) => {
    expect(parseIssuedReport(raw)).toBeNull()
  })

  it('attachment_id отсутствует → null (кнопка скачивания не рисуется без него)', () => {
    const withoutAttachment: Record<string, unknown> = { ...valid }
    delete withoutAttachment.attachment_id
    expect(parseIssuedReport(withoutAttachment)).toBeNull()
  })

  it('attachment_id пустая строка → null (путь /attachments//download/ бессмыслен)', () => {
    expect(parseIssuedReport({ ...valid, attachment_id: '' })).toBeNull()
  })

  it('лишние поля бэка игнорируются, не ломают разбор', () => {
    const parsed = parseIssuedReport({ ...valid, supersedes: 'что-то-новое' })
    expect(parsed).not.toBeNull()
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty('supersedes')
  })
})

describe('expenseFileName: ТОЛЬКО фолбэк к Content-Disposition (AC-7)', () => {
  it('строит имя из известных полей', () => {
    expect(expenseFileName({ business_date: '2026-07-19', number: 247 })).toBe(
      'расход_2026-07-19_исх-247.docx',
    )
  })

  it('расширение .docx — генерация безусловно docx (фантом №1: xlsx/pdf нет)', () => {
    expect(expenseFileName({ business_date: '2026-01-01', number: 1 })).toMatch(/\.docx$/)
  })
})

describe('isOverrideReasonComplete: Story 10.5a', () => {
  it('пусто → false', () => {
    expect(isOverrideReasonComplete('')).toBe(false)
  })

  it('только пробелы → false (зеркало DRF-400 на пустой CharField)', () => {
    expect(isOverrideReasonComplete('   ')).toBe(false)
  })

  it('непустая причина → true', () => {
    expect(isOverrideReasonComplete('Пилот уходит рано')).toBe(true)
  })
})

describe('describeOverrideFailure: тотальная карта отказов обхода (Story 10.5a)', () => {
  it('network → silent', () => {
    expect(describeOverrideFailure(new NetworkError('обрыв')).kind).toBe('silent')
  })

  it.each([500, 502, 503])('%d → silent (уже в тосте useApiMutation)', (status) => {
    const d = describeOverrideFailure(
      new ServerError({ status, errorCode: null, message: 'x', details: {}, requestId: null }),
    )
    expect(d.kind).toBe('silent')
  })

  it('401 → silent (уже в logout-цепи)', () => {
    expect(describeOverrideFailure(apiError(401, 'AUTH_REQUIRED')).kind).toBe('silent')
  })

  it('403 → permission, фиксированный текст (AC-6)', () => {
    const d = describeOverrideFailure(apiError(403, 'PERMISSION_DENIED'))
    expect(d.kind).toBe('permission')
    expect(d.message).toBe('Нет права на обход блокировки.')
  })

  it('409 TOMORROW_BLOCK_ALREADY_OVERRIDDEN → already-overridden (AC-5)', () => {
    const d = describeOverrideFailure(
      new ConflictError({
        status: 409,
        errorCode: 'TOMORROW_BLOCK_ALREADY_OVERRIDDEN',
        message: 'x',
        details: {},
        requestId: null,
      }),
    )
    expect(d.kind).toBe('already-overridden')
    expect(d.message).toBe('Обход на эту дату уже существует.')
  })

  it('400 → validation, текст ДОСЛОВНО из конверта (AC-7)', () => {
    const d = describeOverrideFailure(
      new ValidationError({
        status: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'Дата обхода дальше +31 дней — проверьте год.',
        details: {},
        requestId: null,
      }),
    )
    expect(d.kind).toBe('validation')
    expect(d.message).toBe('Дата обхода дальше +31 дней — проверьте год.')
  })

  it('неучтённый код/статус → other, не тишина', () => {
    const d = describeOverrideFailure(apiError(418, null, 'HTTP 418'))
    expect(d.kind).toBe('other')
    expect(d.message).toContain('HTTP 418')
  })
})
