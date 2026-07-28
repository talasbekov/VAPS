// Story 10.8a — контракт скачивания «моя копия». Окружение node (дефолт
// vite.config): функции чистые (кроме saveBlob, DOM-only, тестируется отдельно
// в интеграционном тесте панели, не здесь).
import { describe, expect, it } from 'vitest'

import { ApiError, NetworkError } from '../../shared/api/errors'
import type { ApiErrorInit } from '../../shared/api/errors'
import { describeExportFailure, exportFileName } from './submissionExport'

function init(over: Partial<ApiErrorInit> = {}): ApiErrorInit {
  return {
    status: 403,
    errorCode: 'PERMISSION_DENIED',
    message: 'PERMISSION_DENIED',
    details: {},
    requestId: 'req-10-8a',
    ...over,
  }
}

describe('exportFileName — фолбэк-имя файла', () => {
  it('детерминированная строка на паре примеров', () => {
    expect(exportFileName('2026-07-19', 1)).toBe('сдача_2026-07-19_v1.xlsx')
    expect(exportFileName('2026-01-01', 3)).toBe('сдача_2026-01-01_v3.xlsx')
  })
})

describe('describeExportFailure — карта отказов (AC-4)', () => {
  it('network → пусто (тост)', () => {
    expect(describeExportFailure(new NetworkError('Network request failed'))).toBe('')
  })

  it('5xx → пусто (тост)', () => {
    expect(describeExportFailure(new ApiError(init({ status: 500 })))).toBe('')
  })

  it('401 → пусто (глушится providers.tsx)', () => {
    expect(describeExportFailure(new ApiError(init({ status: 401 })))).toBe('')
  })

  it('403 → фикс-текст про daily_report.mark_update', () => {
    expect(describeExportFailure(new ApiError(init({ status: 403 })))).toContain(
      'daily_report.mark_update',
    )
  })

  it('404 → «Версия сдачи не найдена.»', () => {
    expect(describeExportFailure(new ApiError(init({ status: 404 })))).toBe(
      'Версия сдачи не найдена.',
    )
  })

  it('422 → текст конверта буквально', () => {
    const message = 'Снапшот сдачи имеет неподдерживаемую версию схемы.'
    expect(
      describeExportFailure(new ApiError(init({ status: 422, message }))),
    ).toBe(message)
  })

  it('прочее → generic-фолбэк с текстом конверта', () => {
    const message = 'Что-то пошло не так'
    expect(
      describeExportFailure(new ApiError(init({ status: 418, message }))),
    ).toBe(`Не удалось скачать файл: ${message}`)
  })
})
