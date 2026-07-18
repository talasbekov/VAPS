// Story 10.2 — мапперы отказа bulk. Окружение node (дефолт vite.config):
// функции чистые, DOM не нужен.
import { describe, expect, it } from 'vitest'

import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from '../../shared/api/errors'
import type { ApiErrorInit } from '../../shared/api/errors'
import {
  describeBulkFailure,
  parseBulkRowErrors,
  parseValidationDetails,
  PERMISSION_MESSAGE,
} from './bulkErrors'

function init(over: Partial<ApiErrorInit> = {}): ApiErrorInit {
  return {
    status: 409,
    errorCode: 'STATUS_OVERLAP_WARNING',
    message: 'Массовое обновление отклонено: см. detail.rows.',
    details: {},
    requestId: 'req-10-2',
    ...over,
  }
}

// Форма — из raise-сайта bulk_status_service.py:219-238 (не из словаря кодов)
const ROWS_DETAILS = {
  rows: [
    {
      index: 0,
      employee_id: 'emp-0',
      code: 'STATUS_OVERLAP_WARNING',
      http_status: 409,
      message: 'Статус пересекает soft-статус сотрудника.',
    },
    {
      index: 2,
      employee_id: 'emp-2',
      code: 'OVERLAPPING_HARD_STATUS',
      http_status: 422,
      message: 'Статус конфликтует с hard-статусом сотрудника.',
    },
  ],
}

describe('parseBulkRowErrors', () => {
  it('details.rows[] → BulkRowError[] c camelCase-полями и сохранённым порядком', () => {
    const error = new ConflictError(init({ details: ROWS_DETAILS }))
    expect(parseBulkRowErrors(error)).toEqual([
      {
        index: 0,
        employeeId: 'emp-0',
        code: 'STATUS_OVERLAP_WARNING',
        httpStatus: 409,
        message: 'Статус пересекает soft-статус сотрудника.',
      },
      {
        index: 2,
        employeeId: 'emp-2',
        code: 'OVERLAPPING_HARD_STATUS',
        httpStatus: 422,
        message: 'Статус конфликтует с hard-статусом сотрудника.',
      },
    ])
  })

  it.each([
    ['details.rows — строка', { rows: 'x' }],
    ['details.rows — числа', { rows: [1, 2] }],
    ['details.rows — null-элементы', { rows: [null, undefined] }],
    ['details без rows', { conflicts: [{ employee_id: 'emp-0' }] }],
    ['details пуст', {}],
  ])('мусор не роняет и не выдумывает строки: %s', (_label, details) => {
    const error = new BusinessRuleError(init({ status: 422, details }))
    expect(parseBulkRowErrors(error)).toEqual([])
  })

  it('строка без несущих полей отбрасывается, соседняя валидная остаётся', () => {
    const error = new ConflictError(
      init({
        details: {
          rows: [
            { employee_id: 'emp-0', message: 'нет index' },
            { index: 1, message: 'нет employee_id' },
            { index: 2, employee_id: 'emp-2' },
            {
              index: 3,
              employee_id: 'emp-3',
              message: 'Уволен на дату статуса.',
            },
          ],
        },
      }),
    )
    // code/http_status необязательны — падают в нейтральный дефолт
    expect(parseBulkRowErrors(error)).toEqual([
      {
        index: 3,
        employeeId: 'emp-3',
        code: '',
        httpStatus: 0,
        message: 'Уволен на дату статуса.',
      },
    ])
  })

  it('не-ошибки (null/строка/NetworkError без details) → пусто, без исключения', () => {
    expect(parseBulkRowErrors(null)).toEqual([])
    expect(parseBulkRowErrors('boom')).toEqual([])
    expect(parseBulkRowErrors(new NetworkError('Сетевой сбой'))).toEqual([])
  })
})

describe('describeBulkFailure', () => {
  it('409 с построчными причинами → канал rows, текст конверта', () => {
    const error = new ConflictError(init({ details: ROWS_DETAILS }))
    expect(describeBulkFailure(error)).toEqual({
      kind: 'rows',
      message: 'Массовое обновление отклонено: см. detail.rows.',
    })
  })

  it('422 hard → тот же канал rows (панель экрана, НЕ ConflictDialog)', () => {
    const error = new BusinessRuleError(
      init({
        status: 422,
        errorCode: 'OVERLAPPING_HARD_STATUS',
        details: ROWS_DETAILS,
      }),
    )
    expect(describeBulkFailure(error).kind).toBe('rows')
  })

  it('403 → permission с указанием требуемого права', () => {
    const error = new ApiError(
      init({ status: 403, errorCode: 'PERMISSION_DENIED', message: 'Недостаточно прав.' }),
    )
    expect(describeBulkFailure(error)).toEqual({
      kind: 'permission',
      message: PERMISSION_MESSAGE,
    })
    expect(PERMISSION_MESSAGE).toContain('status.manage')
  })

  it('400 → validation', () => {
    const error = new ValidationError(
      init({
        status: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'Проверьте заполнение формы.',
      }),
    )
    expect(describeBulkFailure(error)).toEqual({
      kind: 'validation',
      message: 'Проверьте заполнение формы.',
    })
  })

  it.each([
    ['5xx (тост уже показан)', new ServerError(init({ status: 500 }))],
    ['обрыв сети (тост уже показан)', new NetworkError('Сетевой сбой: POST')],
    ['401 (цепь logout уже увела)', new ApiError(init({ status: 401 }))],
  ])('%s → silent: экран НЕ дублирует чужой канал', (_label, error) => {
    expect(describeBulkFailure(error)).toEqual({ kind: 'silent', message: '' })
  })

  it('неучтённый статус не проваливается в молчание — инлайн-панель', () => {
    const error = new ApiError(init({ status: 404, errorCode: null, message: 'HTTP 404' }))
    expect(describeBulkFailure(error).kind).toBe('rows')
  })
})

describe('parseValidationDetails', () => {
  it('DRF-details по полям → плоские строки', () => {
    const error = new ValidationError(
      init({
        status: 400,
        details: {
          rows: ['Не более 1000 строк.', 'Дубликат сотрудника.'],
          business_date: 'Обязательное поле.',
        },
      }),
    )
    expect(parseValidationDetails(error)).toEqual([
      'rows: Не более 1000 строк.',
      'rows: Дубликат сотрудника.',
      'business_date: Обязательное поле.',
    ])
  })

  it('нечитаемые значения пропускаются молча', () => {
    const error = new ValidationError(
      init({ status: 400, details: { rows: [{ nested: true }], count: 3 } }),
    )
    expect(parseValidationDetails(error)).toEqual([])
  })
})
